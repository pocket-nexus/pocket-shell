// The tool windows, at the factory firmware's positions and sizes (its
// 1280x720 frames, halved) and in its colours. Each window owns what it
// starts and stops it on close.
import { createMemo, createSignal, For, Index, onCleanup, Show } from "solid-js";
import { Image, View } from "@pocketjs/framework/components";
import { openAudioInput, type AudioInputSource } from "@pocketjs/framework/audio";
import { closeCamera, openCamera, pollQrCode } from "@pocketjs/framework/camera";
import {
  listDirectory, powerOff, releasePin, setBrightness, setPin, setSwitch, type DeviceDirectory,
} from "@pocketjs/framework/device";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { registerTexture } from "@pocketjs/framework/renderer";
import { connectSavedNetwork, joinNetwork, scanNetworks, startAccessPoint, stopAccessPoint } from "@pocketjs/framework/wifi";
import {
  Bus, Command, RtcSetting, SEND_PAYLOAD, ScanState, SerialKind, Wake, ascii, asciiBytes, encodeClock,
  type ClockFields,
} from "./protocol";
import { click, down, startMusic, startPlayer, up, type Player } from "./sound";
import { device, notify, onSerial, refreshDevice, scan, send, sensors, wifi } from "./store";
import { Box, Btn, Hit, Img, Txt, Window, pad2, type Frame } from "./ui";

/** The centre of a factory offset inside a window, on this surface. */
const cx = (frame: Frame, x: number) => frame.w / 4 + x / 2;
const cy = (frame: Frame, y: number) => frame.h / 4 + y / 2;

interface Opened { from: Frame; onClose: () => void }

/** A waveform where the factory LVGL charts draw the microphones: one bar
 *  per peak. The factory charts scroll; these sweep (sweep()), so an update
 *  changes two bars instead of moving all of them. */
function Wave(props: { x: number; y: number; w: number; h: number; peaks: number[]; color?: string; bg?: string }) {
  const width = () => props.w / props.peaks.length;
  return <Box x={props.x} y={props.y} w={props.w} h={props.h} color={props.bg ?? "#383838"} radius={3}>
    <Index each={props.peaks}>{(peak, index) => {
      const height = () => Math.max(1, Math.round(peak() * (props.h - 4)));
      return <View class="absolute" style={{ insetL: index * width(), insetT: (props.h - height()) / 2,
        width: Math.max(1, width() - 1), height: height(), bgColor: props.color ?? "#40ffa1" }} />;
    }}</Index>
  </Box>;
}

/** Write `value` at the sweep position and clear the bar ahead of it. */
function sweep(peaks: number[], position: number, value: number): number[] {
  const next = peaks.slice();
  next[position % peaks.length] = value;
  next[(position + 1) % peaks.length] = 0;
  return next;
}

// ---- RTC setting -----------------------------------------------------------------

const RTC_FRAME: Frame = { x: 214, y: 85, w: 800, h: 480 };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthDays(year: number, month: number): number {
  return [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

/** The factory window holds a calendar and three rollers; here the rollers
 *  step with their left and right halves. Times are UTC. */
export function RtcWindow(props: Opened) {
  const now = sensors();
  const network = new Date();
  const [draft, setDraft] = createSignal<ClockFields>(now.rtcValid && now.year > 0
    ? { year: now.year, month: now.month, day: now.day, hour: now.hour, minute: now.minute, second: now.second }
    : network.getUTCFullYear() >= 2025
      ? { year: network.getUTCFullYear(), month: network.getUTCMonth() + 1, day: network.getUTCDate(),
        hour: network.getUTCHours(), minute: network.getUTCMinutes(), second: network.getUTCSeconds() }
      : { year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0 });
  const [request, setRequest] = createSignal(0);
  const set = (fields: Partial<ClockFields>) => {
    const next = { ...draft(), ...fields };
    next.day = Math.min(next.day, monthDays(next.year, next.month));
    setDraft(next);
  };
  const month = (delta: number) => {
    let m = draft().month + delta, y = draft().year;
    if (m < 1) { m = 12; y = Math.max(2000, y - 1); }
    if (m > 12) { m = 1; y = Math.min(2099, y + 1); }
    set({ year: y, month: m });
    delta > 0 ? up() : down();
  };
  /* Sunday-first weeks of the shown month. */
  const cells = createMemo(() => {
    const d = draft();
    const first = new Date(Date.UTC(d.year, d.month - 1, 1)).getUTCDay();
    return Array.from({ length: 42 }, (_, i) => i - first + 1).map(day => day >= 1 && day <= monthDays(d.year, d.month) ? day : 0);
  });
  const apply = () => {
    const d = draft();
    setRequest(send(Command.setRtc, (view, bytes) => encodeClock(view, bytes, d)));
    notify(`Set RTC time to ${d.year}/${d.month}/${d.day} ${d.hour}:${pad2(d.minute)}:${pad2(d.second)}`);
    click();
  };
  onFrame(() => {
    const s = sensors();
    if (request() && s.rtcSequence === request() && s.rtcSetting !== RtcSetting.busy) {
      notify(s.rtcSetting === RtcSetting.succeeded ? "RTC time verified" : "RTC time not confirmed");
      setRequest(0);
    }
  });
  const rollers: { key: "hour" | "minute" | "second"; x: number; max: number }[] = [
    { key: "hour", x: -290, max: 23 }, { key: "minute", x: -110, max: 59 }, { key: "second", x: 70, max: 59 },
  ];
  return <Window frame={RTC_FRAME} from={props.from} title="RTC Setting" onClose={props.onClose}>
    <Hit x={74} y={44} w={30} h={22} onPress={() => month(-1)} />
    <Txt x={74} y={44} w={30} align="center" text="<" color="#d8d8d8" bold />
    <Txt x={200} y={44} w={200} align="center" text={`${MONTHS[draft().month - 1]} ${draft().year}`} color="#d8d8d8" bold />
    <Hit x={326} y={44} w={30} h={22} onPress={() => month(1)} />
    <Txt x={326} y={44} w={30} align="center" text=">" color="#d8d8d8" bold />
    <For each={["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]}>{(name, column) =>
      <Txt x={80 + column() * 40} y={62} w={40} align="center" text={name} size="2xs" color="#8a8a8a" />}
    </For>
    <For each={cells()}>{(day, index) => {
      const x = 80 + (index() % 7) * 40, y = 79 + Math.floor(index() / 7) * 18;
      return <Show when={day > 0}>
        <Show when={day === draft().day}>
          <Box x={x - 9} y={y - 8} w={18} h={16} radius={8} color="#d86037" />
        </Show>
        <Txt x={x} y={y} w={40} align="center" text={`${day}`} size="2xs" color="#e8e8e8" />
        <Hit x={x} y={y} w={38} h={17} onPress={() => { set({ day }); click(); }} />
      </Show>;
    }}</For>
    <For each={rollers}>{roller => {
      const x = cx(RTC_FRAME, roller.x), y = cy(RTC_FRAME, 185);
      const step = (delta: number) => {
        const value = draft()[roller.key] + delta;
        set({ [roller.key]: value > roller.max ? 0 : value < 0 ? roller.max : value });
        delta > 0 ? up() : down();
      };
      return <>
        <Box x={x - 37.5} y={y - 11} w={75} h={22} radius={6} color="#3a3a3a" />
        <Txt x={x} y={y} w={40} align="center" text={pad2(draft()[roller.key])} size="sm" bold />
        <Txt x={x - 30} y={y} w={12} align="center" text="<" size="2xs" color="#8a8a8a" />
        <Txt x={x + 30} y={y} w={12} align="center" text=">" size="2xs" color="#8a8a8a" />
        <Hit x={x - 19} y={y} w={37} h={22} onPress={() => step(-1)} />
        <Hit x={x + 19} y={y} w={37} h={22} onPress={() => step(1)} />
      </>;
    }}</For>
    <Txt x={cx(RTC_FRAME, -200)} y={cy(RTC_FRAME, 185)} w={10} align="center" text=":" size="sm" bold />
    <Txt x={cx(RTC_FRAME, -20)} y={cy(RTC_FRAME, 185)} w={10} align="center" text=":" size="sm" bold />
    <Btn x={cx(RTC_FRAME, 270)} y={cy(RTC_FRAME, 185)} w={80} h={24} radius={8} label="Apply" color="#d86037" onPress={apply} />
  </Window>;
}

// ---- camera --------------------------------------------------------------------------

const CAMERA_FRAME: Frame = { x: 141, y: 0, w: 800, h: 480 };

/** The SC202CS preview (320x240 in a 512x256 texture), fitted to the
 *  window's 380x220 canvas; a press shows it over the whole screen. */
export function CameraWindow(props: Opened) {
  const [key, setKey] = createSignal("");
  const [full, setFull] = createSignal(false);
  const handle = openCamera();
  if (handle >= 0) {
    const name = `tab5-demo.camera.${handle}`;
    registerTexture(name, handle);
    setKey(name);
  }
  onCleanup(closeCamera);
  onFrame(() => {
    const text = pollQrCode();
    if (text) { notify(`QR: ${text.slice(0, 40)}`); click(); }
  });
  const preview = (w: number, h: number) => {
    const scale = Math.min(w / 320, h / 240);
    const pw = Math.round(320 * scale), ph = Math.round(240 * scale);
    return <View class="absolute overflow-hidden" style={{ insetL: (w - pw) / 2, insetT: (h - ph) / 2, width: pw, height: ph }}>
      <Image class="absolute left-0 top-0" src={key()} style={{ width: Math.round(512 * scale), height: Math.round(256 * scale) }} />
    </View>;
  };
  return <Show when={!full()} fallback={
    <View focusable onPress={() => setFull(false)} class="absolute" style={{ insetL: 0, insetT: 0, width: 640, height: 360, bgColor: "#000000" }}>
      {preview(640, 360)}
    </View>}>
    <Window frame={CAMERA_FRAME} from={props.from} onClose={props.onClose}>
      <Show when={key()} fallback={<Txt x={200} y={108} w={380} align="center" text="Camera not available." color="#d8d8d8" />}>
        <View focusable onPress={() => setFull(true)} class="absolute" style={{ insetL: 10, insetT: 10, width: 380, height: 220, bgColor: "#000000" }}>
          {preview(380, 220)}
        </View>
      </Show>
    </Window>
  </Show>;
}

// ---- microphones, headset, music -----------------------------------------------------

const MIC_FRAME: Frame = { x: -215, y: -217, w: 670, h: 171 };
const HEADPHONE_FRAME: Frame = { x: -289, y: 130, w: 403, h: 208 };
const MUSIC_FRAME: Frame = { x: 236, y: 116, w: 413, h: 204 };
const BARS = 24;
const RATE = 22050;
const RECORD_SECONDS = 3;
type Phase = "live" | "recording" | "playing";

/** Peaks of one or two channels every other frame, a 3 s recording and its
 *  playback: the factory "REC 3S" test. */
function useRecorder(source: AudioInputSource, channels: number) {
  const [left, setLeft] = createSignal<number[]>(new Array(BARS).fill(0));
  const [right, setRight] = createSignal<number[]>(new Array(BARS).fill(0));
  const [phase, setPhase] = createSignal<Phase>("live");
  const input = openAudioInput(source, RATE, channels);
  const scratch = new Int16Array(4096 * channels);
  const recording = new Int16Array(RATE * RECORD_SECONDS * channels);
  let recorded = 0, frame = 0, peakL = 0, peakR = 0;
  let player: Player | undefined;
  onCleanup(() => { input?.close(); player?.stop(); });
  onFrame(() => {
    player?.pump();
    if (!input) return;
    for (let frames = input.read(scratch); frames > 0; frames = input.read(scratch)) {
      // Every fourth frame is enough for a peak; a sample costs a few
      // microseconds of the frame in QuickJS.
      for (let i = 0; i < frames; i += 4) {
        const l = scratch[i * channels]!, r = scratch[i * channels + channels - 1]!;
        if (l > peakL) peakL = l; else if (-l > peakL) peakL = -l;
        if (r > peakR) peakR = r; else if (-r > peakR) peakR = -r;
      }
      if (phase() !== "recording") continue;
      const take = Math.min(frames, recording.length / channels - recorded);
      recording.set(scratch.subarray(0, take * channels), recorded * channels);
      recorded += take;
      if (recorded * channels >= recording.length) {
        setPhase("playing");
        player = startPlayer(RATE, channels, recorded, (into, offset, count) =>
          into.set(recording.subarray(offset * channels, (offset + count) * channels)), () => setPhase("live"));
        if (!player) setPhase("live");
      }
    }
    if (++frame % 2) return;
    setLeft(sweep(left(), frame / 2, Math.min(1, peakL / 8192)));
    if (channels === 2) setRight(sweep(right(), frame / 2, Math.min(1, peakR / 8192)));
    peakL = peakR = 0;
  });
  const record = () => {
    if (phase() !== "live" || !input) return;
    recorded = 0;
    setPhase("recording");
    click();
  };
  return { left, right, phase, record };
}

function RecButton(props: { x: number; y: number; phase: Phase; onPress: () => void }) {
  return <Btn x={props.x} y={props.y} w={36} h={36} radius={18} size="2xs" onPress={props.onPress}
    label={props.phase === "recording" ? "REC" : props.phase === "playing" ? "PLAY" : "REC\n3S"}
    color={props.phase === "recording" ? "#e17822" : props.phase === "playing" ? "#32cc72" : "#d04848"} textColor="#f4f3f3" />;
}

export function MicWindow(props: Opened) {
  const mic = useRecorder("microphones", 2);
  const f = MIC_FRAME;
  return <Window frame={f} from={props.from} onClose={props.onClose}>
    <Wave x={cx(f, -189) - 60.75} y={cy(f, 0) - 30} w={121.5} h={60} peaks={mic.left()} />
    <Wave x={cx(f, 80) - 60.75} y={cy(f, 0) - 30} w={121.5} h={60} peaks={mic.right()} />
    <RecButton x={cx(f, 267)} y={cy(f, 0)} phase={mic.phase()} onPress={mic.record} />
  </Window>;
}

export function HeadphoneWindow(props: Opened) {
  const mic = useRecorder("headset", 1);
  const f = HEADPHONE_FRAME;
  const plugged = () => device()?.ports.find(port => port.id === "headphone")?.connected ?? false;
  return <Window frame={f} from={props.from} onClose={props.onClose}>
    <Wave x={cx(f, -55) - 60.75} y={cy(f, -26) - 30} w={121.5} h={60} peaks={mic.left()} />
    <RecButton x={cx(f, 134)} y={cy(f, -26)} phase={mic.phase()} onPress={mic.record} />
    <Txt x={cx(f, 0)} y={cy(f, 70)} w={190} align="center" text={plugged() ? "Headphone Connected" : "Headphone Disconnected"}
      color={plugged() ? "#2fc57b" : "#d04848"} />
  </Window>;
}

export function MusicWindow(props: Opened) {
  const f = MUSIC_FRAME;
  const [peaks, setPeaks] = createSignal<number[]>(new Array(BARS).fill(0));
  const [playing, setPlaying] = createSignal(false);
  const loopback = openAudioInput("loopback", RATE, 1);
  const scratch = new Int16Array(4096);
  let player: Player | undefined, frame = 0, peak = 0;
  onCleanup(() => { player?.stop(); loopback?.close(); });
  onFrame(() => {
    player?.pump();
    if (!loopback) return;
    for (let frames = loopback.read(scratch); frames > 0; frames = loopback.read(scratch))
      for (let i = 0; i < frames; i += 4) {
        const v = scratch[i]!;
        if (v > peak) peak = v; else if (-v > peak) peak = -v;
      }
    if (++frame % 2) return;
    setPeaks(sweep(peaks(), frame / 2, Math.min(1, peak / 8192)));
    peak = 0;
  });
  const toggle = () => {
    if (player?.playing()) { player.stop(); player = undefined; setPlaying(false); return; }
    player = startMusic(() => setPlaying(false));
    setPlaying(!!player);
    if (!player) notify("The speaker did not open");
  };
  return <Window frame={f} from={props.from} onClose={props.onClose}>
    <Box x={cx(f, -60) - 60.75} y={cy(f, 0) - 38.25} w={121.5} h={76.5} radius={6} color="#5a5a5a" />
    <Wave x={cx(f, -60) - 60.75} y={cy(f, -17) - 30} w={121.5} h={60} peaks={peaks()} />
    <Txt x={cx(f, -60)} y={cy(f, 59)} w={121.5} align="center" text="Speaker Output Capture" size="2xs" color="#d6d6d6" />
    <Btn x={cx(f, 135)} y={cy(f, 0)} w={44} h={44} radius={22} size="2xs" label={playing() ? "STOP" : "PLAY\nMUSIC"}
      color="#31d584" textColor="#0b4d2c" onPress={toggle} />
  </Window>;
}

// ---- card --------------------------------------------------------------------------------

const CARD_FRAME: Frame = { x: -40, y: 43, w: 566, h: 411 };
const CARD_ROWS = 7;

export function CardWindow(props: Opened) {
  const f = CARD_FRAME;
  const [path, setPath] = createSignal("/");
  const [listing, setListing] = createSignal<DeviceDirectory | null>(listDirectory("/"));
  const [first, setFirst] = createSignal(0);
  const go = (next: string) => {
    setPath(next);
    setListing(listDirectory(next));
    setFirst(0);
    click();
  };
  const parent = () => path().replace(/\/[^/]*$/, "") || "/";
  const entries = () => listing()?.entries ?? [];
  const rows = () => entries().slice(first(), first() + CARD_ROWS);
  const panel = { x: cx(f, 0) - 133.75, y: cy(f, 18) - 86.25, w: 267.5, h: 172.5 };
  return <Window frame={f} from={props.from} title="SD-Card File Scan" onClose={props.onClose}>
    <Show when={device()?.card.mounted} fallback={
      <Txt x={cx(f, 0)} y={cy(f, -24)} w={260} align="center" text={"SD Card not mounted.\n\nPlease insert SD Card and reboot."} color="#fd4444" />}>
      <Box x={panel.x} y={panel.y} w={panel.w} h={panel.h} radius={6} color="#393939">
        <Show when={path() !== "/"}>
          <Hit x={panel.w / 2} y={11} w={panel.w - 8} h={20} onPress={() => go(parent())} />
          <Txt x={10} y={11} text={`.. (${path()})`} color="#fdbe1a" w={240} />
        </Show>
        <For each={rows()}>{(entry, index) => {
          const y = (path() !== "/" ? 32 : 11) + index() * 21;
          return <>
            <Show when={entry.directory} fallback={<Box x={10} y={y - 5} w={7} h={10} radius={1} color="#43d2ff" />}>
              <Box x={8} y={y - 4} w={11} h={8} radius={1} color="#fdbe1a" />
              <Box x={8} y={y - 6} w={5} h={3} radius={1} color="#fdbe1a" />
            </Show>
            <Txt x={26} y={y} w={180} text={entry.name} color={entry.directory ? "#fdbe1a" : "#43d2ff"} />
            <Show when={entry.directory}><Hit x={panel.w / 2} y={y} w={panel.w - 8} h={20} onPress={() => go(`${path() === "/" ? "" : path()}/${entry.name}`)} /></Show>
          </>;
        }}</For>
        <Show when={entries().length === 0}><Txt x={panel.w / 2} y={60} w={240} align="center" text="No files found on SD Card." color="#d8d8d8" /></Show>
        <Show when={entries().length > CARD_ROWS}>
          <Btn x={panel.w - 48} y={panel.h - 14} w={30} h={20} label="<" disabled={first() === 0}
            onPress={() => { setFirst(Math.max(0, first() - CARD_ROWS)); click(); }} />
          <Btn x={panel.w - 16} y={panel.h - 14} w={30} h={20} label=">" disabled={first() + CARD_ROWS >= entries().length}
            onPress={() => { setFirst(first() + CARD_ROWS); click(); }} />
        </Show>
      </Box>
    </Show>
  </Window>;
}

// ---- I2C scan ------------------------------------------------------------------------------

const SCAN_FRAME: Frame = { x: -356, y: -12, w: 512, h: 356 };

/** The factory chart: a 16x8 grid of addresses, the answering ones written
 *  into their cells, rescanned every two seconds while open. Port A without
 *  EXT 5V is not scanned (its pull-ups have no supply). */
export function ScanWindow(props: Opened) {
  const f = SCAN_FRAME;
  const [bus, setBus] = createSignal<number>(Bus.sys);
  const ext5v = () => device()?.switches.find(item => item.id === "ext-5v")?.on ?? false;
  let frame = 0, sent = -60;
  const run = () => {
    if (bus() === Bus.porta && !ext5v()) return;
    if (scan().state === ScanState.scanning) return;
    send(Command.scan, (_, bytes) => { bytes[8] = bus(); });
    sent = frame;
  };
  run();
  onFrame(() => { if (++frame - sent >= 60) run(); });
  const choose = (next: number) => { setBus(next); click(); sent = frame - 60; };
  const result = () => scan().bus === bus() ? scan().addresses : [];
  return <Window frame={f} from={props.from} bg="#1a1a1a" onClose={props.onClose}>
    <Img src={bus() === Bus.sys ? "art/internal_i2c_dev_chart.png" : "art/porta_i2c_dev_chart.png"} x={3} y={5.5} w={250} h={167} />
    <Hit x={cx(f, -100)} y={cy(f, -132)} w={61} h={26} onPress={() => choose(Bus.porta)} />
    <Hit x={cx(f, 100)} y={cy(f, -132)} w={61} h={26} onPress={() => choose(Bus.sys)} />
    <Show when={bus() === Bus.porta}>
      <Img src="art/porta_i2c_ext5v_on.png" x={cx(f, -212) - 15.5} y={cy(f, -133) - 13.5} w={31} h={27} show={ext5v()} />
      <Hit x={cx(f, -212)} y={cy(f, -133)} w={31} h={27} onPress={() => {
        const next = !ext5v();
        setSwitch("ext-5v", next);
        refreshDevice();
        notify(next ? "EXT 5V enabled" : "EXT 5V disabled");
        click();
      }} />
    </Show>
    <For each={result()}>{address =>
      <Txt x={39 + (address & 15) * 13.5} y={68 + (address >> 4) * 13.5} w={14} align="center"
        text={address.toString(16).padStart(2, "0").toUpperCase()} size="2xs" color="#352b2a" />}
    </For>
  </Window>;
}

// ---- header pins ---------------------------------------------------------------------------

const EXT_FRAME: Frame = { x: -438, y: 68, w: 273, h: 380 };
const MBUS_FRAME: Frame = { x: 183, y: -15, w: 520, h: 547 };

function PinRow(props: { x: number; y: number; w: number; h: number; pin: number; high: boolean; onToggle: () => void }) {
  return <Box x={props.x} y={props.y} w={props.w} h={props.h} radius={9} color="#383838">
    <Txt x={props.w / 2 - 33.5} y={props.h / 2} w={50} align="center" text={`G${props.pin}`} size="sm" bold />
    <Btn x={props.w / 2 + 23.5} y={props.h / 2} w={57} h={props.h - 8} radius={8} label={props.high ? "HIGH" : "LOW"}
      color={props.high ? "#dd380d" : "#58b358"} onPress={props.onToggle} />
  </Box>;
}

/** Ext.Port1 and the M-Bus side by side, every pin a LOW/HIGH toggle; the
 *  pins drive low while the windows are open and are released on close.
 *  Ext.Port1's G0 and G1 carry the keyboard's bus and are not listed. */
export function GpioWindows(props: Opened) {
  const pins = device()?.pins ?? [];
  const ext = pins.slice(0, 4), mbus = pins.slice(4);
  const [levels, setLevels] = createSignal<Record<number, boolean>>({});
  for (const pin of pins) setPin(pin, 0);
  onCleanup(() => { for (const pin of pins) releasePin(pin); });
  const toggle = (pin: number) => {
    const next = !levels()[pin];
    if (!setPin(pin, next)) { notify(device()?.error || `G${pin} did not change`); return; }
    setLevels({ ...levels(), [pin]: next });
    next ? up() : down();
  };
  return <>
    <Window frame={MBUS_FRAME} from={props.from} title="MBUS" bgClose={false} onClose={props.onClose}>
      <For each={mbus}>{(pin, index) =>
        <PinRow x={index() < 9 ? 135 : 10} y={27.5 + 27 * (index() % 9)} w={115} h={24} pin={pin}
          high={!!levels()[pin]} onToggle={() => toggle(pin)} />}
      </For>
    </Window>
    <Window frame={EXT_FRAME} from={props.from} title="Ext.Port1" onClose={props.onClose}>
      <For each={ext}>{(pin, index) =>
        <PinRow x={10.75} y={27.5 + 40.5 * index()} w={115} h={31} pin={pin} high={!!levels()[pin]} onToggle={() => toggle(pin)} />}
      </For>
    </Window>
  </>;
}

// ---- RS485 ---------------------------------------------------------------------------------

const SERIAL_FRAME: Frame = { x: 60, y: 0, w: 643, h: 435 };

export function SerialWindow(props: Opened) {
  const f = SERIAL_FRAME;
  const [lines, setLines] = createSignal<string[]>([]);
  let partial = "";
  const push = (line: string) => setLines([...lines(), line].slice(-12));
  onSerial((kind, data) => {
    if (kind === SerialKind.failed) notify("The RS485 port did not accept that");
    else if (kind === SerialKind.sent) push(`<<< ${ascii(data).trim()}`);
    else if (kind === SerialKind.received) {
      partial += ascii(data);
      const parts = partial.split(/\r?\n/);
      partial = parts.pop() ?? "";
      for (const part of parts) push(part);
      if (partial.length > 48) { push(partial); partial = ""; }
    }
  });
  send(Command.serialOpen);
  onCleanup(() => { onSerial(undefined); send(Command.serialClose); });
  const hello = () => {
    const bytes = asciiBytes("Hello M5Stack!\r\n").subarray(0, SEND_PAYLOAD);
    send(Command.serialSend, (_, record) => { record[8] = bytes.length; record.set(bytes, 9); });
    click();
  };
  return <Window frame={f} from={props.from} onClose={props.onClose}>
    <Box x={cx(f, 0) - 150} y={cy(f, -33) - 83.25} w={300} h={166.5} radius={6} color="#383838">
      <For each={lines()}>{(line, index) =>
        <Txt x={8} y={10 + index() * 13} w={284} text={line} size="2xs" color={line.startsWith("<<<") ? "#ffb38a" : "#e8e8e8"} />}
      </For>
    </Box>
    <Txt x={23} y={cy(f, 172)} w={120} text={"Port: RS485\nBaud: 115200"} size="2xs" color="#dedede" />
    <Btn x={cx(f, 128)} y={cy(f, 174)} w={157} h={24} radius={8} label={'Send "Hello M5Stack!"'} color="#616161" textColor="#e7e7e7" onPress={hello} />
  </Window>;
}

// ---- Wi-Fi ---------------------------------------------------------------------------------

const AP_FRAME: Frame = { x: 34, y: -70, w: 602, h: 332 };
const AP_SSID = "M5Tab5-PocketJS";

/** The factory card that tells a phone how to reach the access point; the
 *  factory firmware starts it at boot, this demo with the button. */
export function AccessPointWindow(props: Opened) {
  const f = AP_FRAME;
  const ap = () => wifi()?.accessPoint;
  const external = () => device()?.switches.find(item => item.id === "antenna")?.on ?? false;
  const toggle = () => {
    const ok = ap()?.on ? stopAccessPoint() : startAccessPoint(AP_SSID);
    if (!ok) notify(wifi()?.error || "The radio refused");
    click();
  };
  return <Window frame={f} from={props.from} bg="#483333" closeDot bgClose={false} onClose={props.onClose}>
    <Txt x={16} y={cy(f, -80)} text="Connect to:" />
    <Box x={cx(f, 87) - 94.75} y={cy(f, -80) - 12.75} w={189.5} h={25.5} radius={11} color="#725151" />
    <Txt x={cx(f, 87)} y={cy(f, -80)} w={189.5} align="center" text={AP_SSID} />
    <Txt x={16} y={cy(f, 0)} text="And open url:" />
    <Box x={cx(f, 105) - 84} y={cy(f, 0) - 12.75} w={168} h={25.5} radius={11} color="#725151" />
    <Txt x={cx(f, 105)} y={cy(f, 0)} w={168} align="center" text={`http://${ap()?.address || "192.168.4.1"}`} />
    <Box x={cx(f, 0) - 136.75} y={cy(f, 96) - 19.25} w={273.5} h={38.5} radius={11} color="#5a4141" />
    <Txt x={24} y={cy(f, 96)} w={180} size="2xs"
      text={external() ? "Using external antenna\nplease make sure it's connected." : "Using internal antenna."} />
    <Btn x={cx(f, 196)} y={cy(f, 96)} w={78} h={24} radius={11} size="2xs" color={ap()?.on ? "#725151" : "#b14948"}
      label={ap()?.on ? `On, ${ap()!.stations} sta` : "Start AP"} onPress={toggle} />
  </Window>;
}

const STATION_FRAME: Frame = { x: -200, y: -40, w: 700, h: 520 };

/** The radio as a station: state, a scan, open and saved networks. Opened
 *  from the Wi-Fi label at the top left. */
export function StationWindow(props: Opened) {
  const f = STATION_FRAME;
  const status = wifi;
  const line = () => {
    const s = status();
    if (!s) return "No radio";
    return `${s.state}${s.ssid ? `  ${s.ssid}` : ""}${s.address ? `  ${s.address}` : ""}`;
  };
  return <Window frame={f} from={props.from} title="Wi-Fi" closeDot onClose={props.onClose}>
    <Txt x={14} y={40} w={250} text={line()} size="2xs" color="#d8d8d8" />
    <Btn x={300} y={40} w={70} h={22} radius={8} label={status()?.scanning ? "Scanning" : "Scan"} onPress={() => { scanNetworks(); click(); }} />
    <For each={(status()?.networks ?? []).slice(0, 7)}>{(network, index) => {
      const y = 70 + index() * 26;
      const join = () => {
        const saved = status()?.saved.find(slot => slot.ssid === network.ssid);
        const ok = saved ? connectSavedNetwork(saved.slot) : !network.secure && joinNetwork(network.ssid, "");
        notify(ok ? `Joining ${network.ssid}` : network.secure ? "Join secured networks in Pocket Shell" : "The radio refused");
      };
      return <>
        <Box x={12} y={y - 11} w={326} h={22} radius={6} color="#383838" />
        <Txt x={20} y={y} w={220} text={network.ssid} size="2xs" color="#e8e8e8" />
        <Txt x={330} y={y} w={90} align="right" text={`${"|".repeat(network.strength)}${network.secure ? " lock" : ""}`} size="2xs" color="#8a8a8a" />
        <Hit x={175} y={y} w={326} h={22} onPress={join} />
      </>;
    }}</For>
    <Show when={status()?.error}><Txt x={14} y={250} w={320} text={status()?.error ?? ""} size="2xs" color="#f59e0b" /></Show>
  </Window>;
}

// ---- power ---------------------------------------------------------------------------------

export type PowerAction = "off" | "touch" | "shake" | "timer";

const POWER: Record<PowerAction, {
  frame: Frame; bg: string; border: string; header: string; message: string; confirm: string; color: string;
}> = {
  off: { frame: { x: 123, y: -200, w: 703, h: 291 }, bg: "#b14948", border: "#783a39", header: "Your device will shut down.",
    message: "", confirm: "Shut Down", color: "#e65a57" },
  touch: { frame: { x: 123, y: -200, w: 703, h: 291 }, bg: "#6b6d48", border: "#54553d", header: "Your device will enter sleepmode.",
    message: "Touch the screen to wake it up.", confirm: "Sleep", color: "#979a60" },
  shake: { frame: { x: 123, y: -163, w: 703, h: 291 }, bg: "#b18f6c", border: "#896b4d", header: "Your device will shut down.",
    message: "Please place it still before confirming.\nShake the device to wake it up.", confirm: "Sleep", color: "#d5aa7e" },
  timer: { frame: { x: 123, y: -116, w: 703, h: 291 }, bg: "#637991", border: "#435a73", header: "Your device will shut down.",
    message: "It will automatically wake up in 10 seconds.", confirm: "Sleep", color: "#709dce" },
};

export function PowerWindow(props: Opened & { action: PowerAction }) {
  const p = POWER[props.action], f = p.frame;
  const [countdown, setCountdown] = createSignal(15);
  const [phase, setPhase] = createSignal<"confirm" | "arming" | "asleep" | "failed">("confirm");
  const [request, setRequest] = createSignal(0);
  let frames = 0, brightness = 100;
  const shutDown = () => {
    if (powerOff()) return;
    setPhase("failed");
    if (props.action === "timer" || props.action === "shake") send(Command.disarmWake);
  };
  const confirm = () => {
    click();
    if (props.action === "off") { shutDown(); return; }
    if (props.action === "touch") {
      brightness = device()?.display.brightness || 100;
      setBrightness(0);
      setPhase("asleep");
      return;
    }
    setPhase("arming");
    setRequest(send(props.action === "timer" ? Command.armRtcWake : Command.armMotionWake));
  };
  onFrame(() => {
    if (props.action === "off" && phase() === "confirm" && ++frames % 30 === 0) {
      setCountdown(countdown() - 1);
      if (countdown() < 0) shutDown();
    }
    const s = sensors();
    if (phase() === "arming" && request() && s.wakeSequence === request()) {
      if (s.wake === Wake.rtc || s.wake === Wake.motion) shutDown();
      else { setPhase("failed"); notify("The wake-up did not arm"); }
    }
  });
  const wake = () => {
    setBrightness(brightness);
    refreshDevice();
    props.onClose();
  };
  const message = () => phase() === "failed" ? "The Tab5 did not power off."
    : phase() === "arming" ? "Arming the wake-up..."
    : props.action === "off" ? `Shut down automatically in ${Math.max(0, countdown())} seconds.` : p.message;
  return <Show when={phase() !== "asleep"} fallback={
    <View class="absolute" focusable onPress={wake} style={{ insetL: 0, insetT: 0, width: 640, height: 360, bgColor: "#000000" }} />}>
    <Window frame={f} from={props.from} bg={p.bg} border={p.border} onClose={props.onClose}>
      <Txt x={25} y={cy(f, -92)} w={320} text={p.header} size="lg" bold />
      <Txt x={25} y={cy(f, -21)} w={320} text={message()} />
      <Btn x={cx(f, -24)} y={cy(f, 78)} w={91.5} h={29} radius={9} label="Cancel" color={p.border} onPress={props.onClose} />
      <Btn x={cx(f, 207)} y={cy(f, 78)} w={91.5} h={29} radius={9} label={p.confirm} color={p.color} onPress={confirm}
        disabled={phase() !== "confirm"} />
    </Window>
  </Show>;
}
