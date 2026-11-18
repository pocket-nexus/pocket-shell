// Unit Swap: plug ENV III, RFID 2 or Ultrasonic I2C into Port A, one at a
// time, and the worker finds the unit, loads its driver and starts
// sampling; this UI draws what the worker publishes. The picture is the
// auxiliary surface of the tab5-home host (640x360).
import { createMemo, createSignal, For, Index, Match, Show, Switch, type JSX } from "solid-js";
import { AuxiliarySurface, Text, View } from "@pocketjs/framework/components";
import { deviceStatus, setSwitch } from "@pocketjs/framework/device";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { mount } from "@pocketjs/framework/solid";
import { worker } from "@pocketjs/framework/worker/channels";
import {
  COMMAND_BYTES, CardType, Command, DataState, Event, Kind, KNOWN_ADDRESSES, Phase, UNITS, WriteState,
  decodeEvent, decodeHistory, decodeState, emptyState, hex2, unitName,
  type EventRecord, type HistoryPoint, type State,
} from "./protocol";
import { CARD_NAMES, describeBlock } from "./units/decode";

/** Every printable ASCII character and the degree sign, so the baked glyphs
 *  cover every label and card text. */
export const GLYPHS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~°";

const C = {
  bg: "#0d1117", panel: "#161d27", raised: "#232e3c", line: "#2d3a4a",
  text: "#e6edf3", muted: "#8b98a8", faint: "#56657a", warn: "#f85149",
};
const ACCENT: Record<number, string> = { [Kind.none]: "#56657a", [Kind.env3]: "#3fb27f", [Kind.rfid2]: "#d29922", [Kind.sonic]: "#4c8dff" };

// ---- drawing helpers ---------------------------------------------------------

type Size = "xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "4xl" | "5xl";
const LINE: Record<Size, number> = { xs: 15, sm: 18, base: 20, lg: 22, xl: 24, "2xl": 29, "4xl": 43, "5xl": 64 };

/** Text classes are looked up verbatim, so each one is a whole literal; a
 *  class not written here bakes no font slot. The large sizes and `base`
 *  come in one weight each. */
function textClass(size: Size, bold: boolean): string {
  switch (size) {
    case "xs": return bold ? "absolute text-xs font-bold" : "absolute text-xs";
    case "sm": return bold ? "absolute text-sm font-bold" : "absolute text-sm";
    case "lg": return bold ? "absolute text-lg font-bold" : "absolute text-lg";
    case "xl": return bold ? "absolute text-xl font-bold" : "absolute text-xl";
    case "2xl": return "absolute text-2xl font-bold";
    case "4xl": return "absolute text-4xl font-bold";
    case "5xl": return "absolute text-5xl font-bold";
    default: return "absolute text-base";
  }
}

/** One line of text; `x` is its left edge, or its right edge with
 *  align "right". `y` is the top of the line box. */
function T(props: { x: number; y: number; text: string; size?: Size; color?: string; bold?: boolean; w?: number; align?: "left" | "right" }) {
  const width = () => props.w ?? 380;
  return <Text class={textClass(props.size ?? "sm", props.bold ?? false)} style={{
    insetL: props.align === "right" ? props.x - width() : props.x, insetT: props.y, width: width(),
    textColor: props.color ?? C.text, textAlign: props.align === "right" ? 2 : 0,
  }}>{props.text}</Text>;
}

function Box(props: { x: number; y: number; w: number; h: number; color: string; radius?: number; children?: JSX.Element }) {
  return <View class="absolute" style={{ insetL: props.x, insetT: props.y, width: props.w, height: props.h, bgColor: props.color, radius: props.radius ?? 0 }}>
    {props.children}
  </View>;
}

function Button(props: { x: number; y: number; w: number; h: number; label: string; color?: string; onPress: () => void }) {
  return <View focusable onPress={props.onPress} class="absolute flex-col items-center justify-center active:opacity-70"
    style={{ insetL: props.x, insetT: props.y, width: props.w, height: props.h, bgColor: props.color ?? C.raised, radius: 6 }}>
    <Text class="text-sm font-bold" style={{ textColor: C.text }}>{props.label}</Text>
  </View>;
}

const addressList = (addresses: readonly number[]) => addresses.map(address => `0x${hex2(address)}`).join(" ");
const uidText = (uid: Uint8Array) => Array.from(uid, hex2).join(" ");
const clock = (millis: number) => {
  const seconds = Math.floor(millis / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

function eventText(record: EventRecord): string {
  const name = unitName(record.kind);
  switch (record.event) {
    case Event.attached: return `${name} attached`;
    case Event.removed: return `${name} removed`;
    case Event.unknown: return `unknown ${addressList(Array.from(record.payload))}`;
    case Event.card: return `card ${Array.from(record.payload, hex2).join("")}`;
    case Event.cardGone: return "card left the reader";
    case Event.busFault: return `bus fault: ${record.detail} answer`;
    case Event.written: return record.detail ? "card written" : "card write failed";
    case Event.rejected: return `not ${name}: id check failed`;
    default: return `event ${record.event}`;
  }
}

// ---- unit panels -------------------------------------------------------------

/** Panel origin; every panel draws inside 416 x 300 from here. */
const PX = 12, PY = 48, PW = 416, PH = 300;

function Heading(props: { kind: number; detail: string }) {
  return <>
    <Box x={PX + 16} y={PY + 18} w={10} h={10} radius={5} color={ACCENT[props.kind]!} />
    <T x={PX + 34} y={PY + 12} text={unitName(props.kind)} size="lg" bold />
    <T x={PX + PW - 16} y={PY + 15} text={props.detail} size="xs" color={C.muted} align="right" w={250} />
  </>;
}

function Chart(props: { points: HistoryPoint[] }) {
  const x0 = PX + 16, y0 = PY + 196, w = PW - 32, h = 84, bar = 6;
  const values = createMemo(() => props.points.flatMap(point => point.celsius === undefined ? [] : [point.celsius]));
  const low = createMemo(() => values().length ? Math.min(...values()) - 0.5 : 0);
  const high = createMemo(() => values().length ? Math.max(...values()) + 0.5 : 1);
  const height = (celsius: number) => Math.max(2, Math.round((celsius - low()) / (high() - low()) * h));
  return <>
    <Box x={x0} y={y0} w={w} h={h} color={C.bg} radius={4} />
    {/* Index keeps one bar per slot and updates it in place when the
        history moves on. */}
    <Index each={props.points}>{(point, index) =>
      <Show when={point().celsius !== undefined} fallback={
        <Box x={x0 + w - (props.points.length - index) * bar} y={y0 + h - 2} w={bar - 1} h={2} color={C.line} />}>
        <Box x={x0 + w - (props.points.length - index) * bar} y={y0 + h - height(point().celsius!)}
          w={bar - 1} h={height(point().celsius!)} color={ACCENT[Kind.env3]!} />
      </Show>}
    </Index>
    <T x={x0 + 4} y={y0 + 2} text={values().length ? `${high().toFixed(1)}°` : "no readings yet"} size="xs" color={C.muted} />
    <T x={x0 + 4} y={y0 + h - 17} text={values().length ? `${low().toFixed(1)}°` : ""} size="xs" color={C.muted} />
    <T x={x0} y={y0 + h + 2} text="Temperature, one point every 5 s. Grey: no ENV III on the port." size="xs" color={C.faint} />
  </>;
}

function EnvPanel(props: { state: State; history: HistoryPoint[] }) {
  const env = () => props.state.env!;
  return <>
    <Heading kind={Kind.env3} detail="0x44 SHT30 / 0x70 QMP6988" />
    <T x={PX + 150} y={PY + 46} text={env().celsius.toFixed(1)} size="5xl" bold align="right" w={140} />
    <T x={PX + 154} y={PY + 56} text="°C" size="xl" color={C.muted} />
    <T x={PX + 320} y={PY + 56} text={env().humidity.toFixed(1)} size="4xl" bold align="right" w={130} />
    <T x={PX + 324} y={PY + 70} text="% RH" size="base" color={C.muted} />
    <T x={PX + 16} y={PY + 120} text={`Pressure   ${(env().pascals / 100).toFixed(1)} hPa`} size="base" />
    <T x={PX + 16} y={PY + 144} text={`Dew point  ${env().dewPoint.toFixed(1)} °C`} size="base" />
    <T x={PX + 230} y={PY + 120} text={`Altitude  ${env().altitude.toFixed(0)} m`} size="base" />
    <T x={PX + 230} y={PY + 144} text={`QMP6988  ${env().qmpCelsius.toFixed(1)} °C`} size="base" color={C.muted} />
    <T x={PX + 16} y={PY + 170} text={`${env().samples} samples, 2 per second`} size="xs" color={C.faint} />
    <Chart points={props.history} />
  </>;
}

const SCALE_MM = 2000;

function SonicPanel(props: { state: State; send: (command: number) => void }) {
  const sonic = () => props.state.sonic!;
  const gx = PX + 16, gw = PW - 32, gy = PY + 150;
  const at = (mm: number) => Math.round(Math.min(mm, SCALE_MM) / SCALE_MM * gw);
  return <>
    <Heading kind={Kind.sonic} detail="0x57 RCWL-9620" />
    <T x={PX + 230} y={PY + 50} text={(sonic().millimetres / 10).toFixed(1)} size="5xl" bold align="right" w={210} />
    <T x={PX + 236} y={PY + 72} text="cm" size="xl" color={C.muted} />
    <Box x={gx} y={gy} w={gw} h={22} color={C.bg} radius={4} />
    <Box x={gx} y={gy} w={Math.max(2, at(sonic().millimetres))} h={22} color={ACCENT[Kind.sonic]!} radius={4} />
    <Box x={gx + at(sonic().min)} y={gy - 6} w={2} h={34} color={C.muted} />
    <Box x={gx + at(sonic().max)} y={gy - 6} w={2} h={34} color={C.muted} />
    <For each={[0, 50, 100, 150, 200]}>{cm =>
      <T x={cm === 200 ? gx + gw : gx + at(cm * 10)} y={gy + 28} text={`${cm} cm`} size="xs" color={C.faint} w={50}
        align={cm === 200 ? "right" : "left"} />}
    </For>
    <T x={PX + 16} y={PY + 214} text={`min ${(sonic().min / 10).toFixed(1)} cm   max ${(sonic().max / 10).toFixed(1)} cm   last echo ${sonic().raw.toFixed(0)} mm`} size="sm" />
    <T x={PX + 16} y={PY + 236} text={`${sonic().samples} echoes, median of 5, ${sonic().outOfRange} out of range`} size="xs" color={C.faint} />
    <Button x={PX + PW - 156} y={PY + PH - 44} w={140} h={32} label="Reset min / max" onPress={() => props.send(Command.resetRange)} />
  </>;
}

const DATA_TEXT: Record<number, string> = {
  [DataState.none]: "", [DataState.authFailed]: "Block 4: key A FFFFFFFFFFFF rejected",
  [DataState.failed]: "Block 4: read failed", [DataState.unsupported]: "No data block read for this card type",
};
const WRITE_TEXT: Record<number, string> = {
  [WriteState.idle]: "", [WriteState.pending]: "Writing: hold the card on the reader",
  [WriteState.written]: "Written and read back", [WriteState.failed]: "Write failed", [WriteState.noCard]: "No card on the reader",
};

function RfidPanel(props: { state: State; send: (command: number) => void }) {
  const rfid = () => props.state.rfid!;
  const seen = () => rfid().cardType !== CardType.none;
  return <>
    <Heading kind={Kind.rfid2} detail={`0x28 WS1850S, VersionReg 0x${hex2(rfid().version)}`} />
    <Show when={seen()} fallback={<>
      <T x={PX + 16} y={PY + 80} text="Tap a card on the reader" size="2xl" bold />
      <T x={PX + 16} y={PY + 116} text="ISO 14443A: MIFARE Classic, Ultralight, NTAG" size="sm" color={C.muted} />
    </>}>
      <T x={PX + 16} y={PY + 48} text={rfid().present ? "On the reader" : "Last card"} size="sm" color={rfid().present ? ACCENT[Kind.rfid2]! : C.muted} />
      <T x={PX + 16} y={PY + 68} text={uidText(rfid().uid)} size="4xl" bold color={rfid().present ? C.text : C.muted} />
      <T x={PX + 16} y={PY + 120} text={CARD_NAMES[rfid().cardType] ?? "Unknown card"} size="lg" />
      <T x={PX + 16} y={PY + 146} text={`ATQA 0x${rfid().atqa.toString(16).padStart(4, "0")}   SAK 0x${hex2(rfid().sak)}   UID ${rfid().uid.length} bytes`} size="sm" color={C.muted} />
      <T x={PX + 16} y={PY + 172} text={rfid().dataState === DataState.read ? `Block 4: ${describeBlock(rfid().data)}` : DATA_TEXT[rfid().dataState] ?? ""} size="sm" w={390} />
    </Show>
    <T x={PX + 16} y={PY + 214} text={`${rfid().cards} cards seen, ${rfid().polls} WUPA polls`} size="xs" color={C.faint} />
    <T x={PX + 16} y={PY + PH - 36} text={WRITE_TEXT[rfid().writeState] ?? ""} size="sm" color={rfid().writeState === WriteState.failed ? C.warn : C.muted} w={240} />
    <Button x={PX + PW - 156} y={PY + PH - 44} w={140} h={32} label="Write name" color={ACCENT[Kind.rfid2]!} onPress={() => props.send(Command.writeCard)} />
  </>;
}

function WaitingPanel(props: { state: State; ext5v: boolean }) {
  return <>
    <T x={PX + 16} y={PY + 16} text="Plug a unit into Port A" size="2xl" bold />
    <T x={PX + 16} y={PY + 50} text={`The worker probes ${addressList(KNOWN_ADDRESSES)} every 250 ms`} size="sm" color={C.muted} />
    <For each={UNITS}>{(unit, index) => <>
      <Box x={PX + 16} y={PY + 86 + index() * 56} w={4} h={44} color={ACCENT[unit.kind]!} />
      <T x={PX + 30} y={PY + 86 + index() * 56} text={unit.name} size="lg" bold />
      <T x={PX + PW - 16} y={PY + 89 + index() * 56} text={addressList(unit.addresses)} size="sm" color={C.muted} align="right" w={120} />
      <T x={PX + 30} y={PY + 110 + index() * 56} text={unit.measures} size="xs" color={C.muted} />
    </>}</For>
    <Show when={!props.ext5v}>
      <T x={PX + 16} y={PY + PH - 30} text="EXT 5V is off: Port A has no supply" size="sm" color={C.warn} />
    </Show>
  </>;
}

// ---- app ---------------------------------------------------------------------

mount(() => {
  const stateChannel = worker.channel("state"), historyChannel = worker.channel("history");
  const eventChannel = worker.channel("events"), commandChannel = worker.channel("commands");
  const [state, setState] = createSignal<State>(emptyState());
  const [history, setHistory] = createSignal<HistoryPoint[]>([]);
  const [events, setEvents] = createSignal<{ time: string; text: string; kind: number }[]>([]);
  const [rate, setRate] = createSignal(0);
  const ext5vOn = () => deviceStatus()?.switches.find(item => item.id === "ext-5v")?.on ?? false;
  const [ext5v, setExt5v] = createSignal(ext5vOn());
  // Port A's units take their supply from EXT 5V.
  if (!ext5v()) { setSwitch("ext-5v", true); setExt5v(ext5vOn()); }

  const send = (command: number) => {
    const record = new Uint8Array(COMMAND_BYTES);
    record[0] = command;
    commandChannel.publish(record);
  };
  let frame = 0, lastRequests = 0, restoreAt = 0, pending: Uint8Array | undefined;
  let sequence = -1, historyBytes: Uint8Array = new Uint8Array(0);
  onFrame(() => {
    ++frame;
    // A snapshot's mirror holds its last record, so observe() returns it
    // every frame: decode only a new sequence or new bytes.
    for (const record of stateChannel.observe()) {
      const bytes = record.copy();
      const next = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
      if (next !== sequence) { sequence = next; pending = bytes; }
    }
    // The panels redraw at most ten times a second.
    if (pending && frame % 3 === 0) { setState(decodeState(pending)); pending = undefined; }
    for (const record of historyChannel.observe()) {
      const bytes = record.copy();
      if (bytes.length !== historyBytes.length || bytes.some((byte, index) => byte !== historyBytes[index])) {
        historyBytes = bytes;
        setHistory(decodeHistory(bytes));
      }
    }
    const added: { time: string; text: string; kind: number }[] = [];
    for (const record of eventChannel.observe()) {
      const event = decodeEvent(record.copy());
      added.unshift({ time: clock(event.millis), text: eventText(event), kind: event.kind });
    }
    if (added.length) setEvents([...added, ...events()].slice(0, 8));
    if (frame % 30 === 0) {
      const requests = state().requests;
      setRate(Math.max(0, requests - lastRequests));
      lastRequests = requests;
    }
    if (restoreAt && frame >= restoreAt) { restoreAt = 0; setSwitch("ext-5v", true); }
    if (frame % 15 === 0) setExt5v(ext5vOn());
  });
  const toggle5v = () => { setSwitch("ext-5v", !ext5v()); setExt5v(ext5vOn()); };
  const powerCycle = () => { setSwitch("ext-5v", false); setExt5v(false); restoreAt = frame + 15; };
  const phaseText = () => ["waiting", "identifying", "running", "unknown device", "bus fault"][state().phase] ?? "?";

  return <AuxiliarySurface>
    <View class="w-full h-full" style={{ bgColor: C.bg }}>
      <T x={16} y={10} text="Unit Swap" size="xl" bold />
      <T x={130} y={14} text="one Port A, units found and driven by the worker" size="sm" color={C.muted} />
      <Button x={520} y={8} w={108} h={30} label={ext5v() ? "EXT 5V on" : "EXT 5V off"} color={ext5v() ? "#1f6f4a" : C.raised} onPress={toggle5v} />

      <Box x={PX} y={PY} w={PW} h={PH} color={C.panel} radius={8} />
      <Box x={PX} y={PY} w={PW} h={3} color={ACCENT[state().kind]!} />
      <Switch fallback={<WaitingPanel state={state()} ext5v={ext5v()} />}>
        <Match when={state().phase === Phase.running && state().kind === Kind.env3 && state().env}>
          <EnvPanel state={state()} history={history()} />
        </Match>
        <Match when={state().phase === Phase.running && state().kind === Kind.sonic && state().sonic}>
          <SonicPanel state={state()} send={send} />
        </Match>
        <Match when={state().phase === Phase.running && state().kind === Kind.rfid2 && state().rfid}>
          <RfidPanel state={state()} send={send} />
        </Match>
        <Match when={state().phase === Phase.identifying || state().phase === Phase.running}>
          <T x={PX + 16} y={PY + 100} text={`Identifying ${unitName(state().kind)}`} size="2xl" bold />
          <T x={PX + 16} y={PY + 136} text={`${addressList(state().addresses)} answered; reading its identity registers`} size="sm" color={C.muted} />
        </Match>
        <Match when={state().phase === Phase.unknown}>
          <T x={PX + 16} y={PY + 80} text="Unknown device" size="2xl" bold />
          <T x={PX + 16} y={PY + 116} text={`Answering: ${addressList(state().addresses)}`} size="base" />
          <T x={PX + 16} y={PY + 146} text="No catalogued unit matches these addresses and" size="sm" color={C.muted} />
          <T x={PX + 16} y={PY + 166} text="identity registers. A driver goes in units/ and UNITS." size="sm" color={C.muted} />
        </Match>
        <Match when={state().phase === Phase.busFault}>
          <T x={PX + 16} y={PY + 80} text="Port A bus fault" size="2xl" bold color={C.warn} />
          <T x={PX + 16} y={PY + 116} text={`${state().addresses.length} addresses answer: SDA is held low.`} size="base" />
          <T x={PX + 16} y={PY + 140} text="Reseat the unit or cut its supply for half a second." size="sm" color={C.muted} />
          <Button x={PX + 16} y={PY + 180} w={190} h={34} label="Power-cycle Port A" color={C.warn} onPress={powerCycle} />
        </Match>
      </Switch>

      <Box x={440} y={PY} w={188} h={PH} color={C.panel} radius={8} />
      <T x={452} y={PY + 10} text="WORKER" size="xs" bold color={C.muted} />
      <T x={452} y={PY + 28} text={`state      ${phaseText()}`} size="xs" />
      <T x={452} y={PY + 44} text={`requests   ${rate()}/s, ${state().requests} total`} size="xs" />
      <T x={452} y={PY + 60} text={`failed     ${state().failures}`} size="xs" />
      <T x={452} y={PY + 76} text={`probe      ${state().scanMs} ms a round`} size="xs" />
      <T x={452} y={PY + 92} text={`detect     ${state().detectMs ? `${state().detectMs} ms to data` : "-"}`} size="xs" />
      <T x={452} y={PY + 108} text={`attaches   ${state().attaches}`} size="xs" />
      <T x={452} y={PY + 128} text="PORT A" size="xs" bold color={C.muted} />
      <T x={452} y={PY + 144} text={state().addresses.length ? addressList(state().addresses.slice(0, 6)) : "no answer"} size="xs" w={170} />
      <T x={452} y={PY + 164} text="EVENTS" size="xs" bold color={C.muted} />
      <For each={events()}>{(event, index) => <>
        <T x={452} y={PY + 180 + index() * 15} text={event.time} size="xs" color={C.faint} w={40} />
        <T x={490} y={PY + 180 + index() * 15} text={event.text} size="xs" color={ACCENT[event.kind] ?? C.text} w={136} />
      </>}</For>
    </View>
  </AuxiliarySurface>;
});
