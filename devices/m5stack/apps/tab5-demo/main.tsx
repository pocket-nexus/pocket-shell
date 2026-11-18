// Tab5 Demo: the M5Tab5-UserDemo factory firmware's launcher on PocketJS.
// The factory block diagram is the background picture (art/bg_*.png, half
// of its 1280x720); live values, switch states and plug arrows are
// drawn over it where the factory firmware draws them, and the picture's
// tiles open the tool windows. The picture is the auxiliary surface of the
// tab5-home profile (640x360).
import { createMemo, createSignal, Match, Show, Switch } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { AuxiliarySurface, View } from "@pocketjs/framework/components";
import { setBrightness, setSwitch, setVolume } from "@pocketjs/framework/device";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { mount } from "@pocketjs/framework/solid";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import { Driver } from "./protocol";
import { click, down, melody, up } from "./sound";
import { device, dismissToast, notify, refreshDevice, sensors, startStore, toast } from "./store";
import { Background, Hit, Img, Toast, Txt, X, Y, pad2, type Frame } from "./ui";
import {
  AccessPointWindow, CameraWindow, CardWindow, GpioWindows, HeadphoneWindow, MicWindow, MusicWindow,
  PowerWindow, RtcWindow, ScanWindow, SerialWindow, StationWindow, type PowerAction,
} from "./windows";

type Tool = "rtc" | "camera" | "mic" | "headphone" | "music" | "card" | "scan" | "gpio" | "serial" |
  "ap" | "station" | PowerAction;

/** The factory buttons each window grows from (centre offset and size at
 *  1280x720). `station` is the Wi-Fi label at the top left, which the
 *  factory picture draws without a function. */
const BUTTONS: Record<Tool, Frame> = {
  rtc: { x: 422, y: -228, w: 103, h: 95 },
  camera: { x: 598, y: 10, w: 83, h: 97 },
  mic: { x: -154, y: -311, w: 103, h: 95 },
  headphone: { x: -310, y: 301, w: 100, h: 100 },
  music: { x: 225, y: 279, w: 100, h: 100 },
  card: { x: -46, y: 300, w: 100, h: 100 },
  scan: { x: -505, y: 229, w: 100, h: 100 },
  gpio: { x: 413, y: -115, w: 100, h: 100 },
  serial: { x: 497, y: 5, w: 100, h: 100 },
  ap: { x: -309, y: -187, w: 60, h: 60 },
  station: { x: -535, y: -348, w: 110, h: 30 },
  off: { x: 562, y: -319, w: 146, h: 70 },
  touch: { x: 562, y: -245, w: 146, h: 70 },
  shake: { x: 562, y: -172, w: 146, h: 70 },
  timer: { x: 562, y: -98, w: 146, h: 70 },
};

/** The five switches: factory position, pictures and toasts. */
const SWITCHES = [
  { id: "charge", x: 285, y: -73, on: "art/sw_chg_on.png", off: "art/sw_chg_off.png", enabled: "Battery charging enabled", disabled: "Battery charging disabled" },
  { id: "quick-charge", x: 285, y: -181, on: "art/sw_qc_on.png", off: "art/sw_qc_off.png", enabled: "QC charging enabled", disabled: "QC charging disabled" },
  { id: "ext-5v", x: -107, y: 64, on: "art/sw_on.png", off: "art/sw_off.png", enabled: "EXT 5V enabled", disabled: "EXT 5V disabled" },
  { id: "usb-5v", x: -202, y: -27, on: "art/sw_on.png", off: "art/sw_off.png", enabled: "USB-A 5V enabled", disabled: "USB-A 5V disabled" },
  { id: "antenna", x: -383, y: -191, on: "art/sw_rf_h.png", off: "art/sw_rf_l.png", enabled: "Switched to external antenna", disabled: "Switched to internal antenna" },
] as const;

/** The plug arrows at the left edge. */
const PORTS = [{ id: "usb-a", y: -175 }, { id: "usb-c", y: 0 }, { id: "headphone", y: 151 }] as const;

function PowerMonitor() {
  const s = sensors;
  const ready = createMemo(() => s().power === Driver.ready);
  const volts = createMemo(() => ready() ? `${s().volts.toFixed(2)}V` : "..");
  const amps = createMemo(() => ready() ? `${s().amps.toFixed(2)}A` : "..");
  const charging = createMemo(() => ready() && s().amps >= 0);
  const temperature = createMemo(() => device()?.temperature != null ? `${Math.round(device()!.temperature!)}` : "..");
  return <>
    <Txt x={419} y={12.5} w={80} align="right" text={volts()} color="#333333" />
    <Txt x={419} y={28.5} w={80} align="right" text={amps()} color="#333333" />
    <Img src="art/chg_arrow_up.png" x={X(286) - 5} y={Y(-281) - 5} w={10} h={10} show={charging()} />
    <Img src="art/chg_arrow_down.png" x={X(216) - 5} y={Y(-264) - 5} w={10} h={10} show={charging()} />
    <Txt x={X(-25)} y={Y(82)} w={40} align="center" text={temperature()} size="2xs" color="#535353" />
  </>;
}

function Rtc() {
  const s = sensors;
  const time = createMemo(() => s().year ? `${s().hour}:${pad2(s().minute)}:${pad2(s().second)}` : "..");
  const date = createMemo(() => s().year ? `${s().year}/${s().month}/${s().day}` : "..");
  return <>
    <Txt x={X(335)} y={Y(-249)} w={110} align="center" text={time()} color="#d86037" bold />
    <Txt x={X(335)} y={Y(-223)} w={110} align="center" text={date()} size="2xs" color="#d86037" />
  </>;
}

function Imu() {
  const s = sensors;
  const g = (axis: number) => s().accel[axis]! / 9.80665;
  const clamp = (value: number) => Math.max(-50, Math.min(50, value));
  // The factory axes: X is the sensor's y, Y its -x, Z its -z.
  const dx = createMemo(() => Math.round(clamp(g(1) * 50) / 2));
  const dy = createMemo(() => Math.round(clamp(-g(0) * 50) / 2));
  const size = createMemo(() => {
    const dps = Math.max(...s().gyro.map(v => Math.abs(v * 180 / Math.PI)));
    const score = Math.max(dps / 10, Math.abs(g(0)), Math.abs(g(1)), Math.abs(g(2))) * 10;
    const full = score <= 10 ? 22 : score >= 20 ? 58 : 22 + (score - 10) * 36 / 10;
    return Math.round(full / 2);
  });
  const ready = createMemo(() => s().imu === Driver.ready);
  const label = (name: string, value: () => number) => createMemo(() => ready() ? `${name}:${value().toFixed(1)}` : "..");
  const ax = label("X", () => g(1)), ay = label("Y", () => -g(0)), az = label("Z", () => -g(2));
  return <>
    <View class="absolute" style={{ insetL: X(371) + dx() - size() / 2, insetT: Y(198) + dy() - size() / 2,
      width: size(), height: size(), radius: size() / 2, bgColor: "#ff589d" }} />
    <Txt x={509.5} y={256.5} w={60} text={ax()} size="2xs" color="#606060" />
    <Txt x={475.5} y={289} w={60} text={ay()} size="2xs" color="#606060" />
    <Txt x={509.5} y={302.5} w={60} text={az()} size="2xs" color="#606060" />
  </>;
}

function Backlight() {
  const brightness = () => device()?.display.brightness ?? 0;
  const change = (delta: number) => {
    const next = Math.max(20, Math.min(100, brightness() + delta));
    if (next === brightness()) { melody([delta > 0 ? 96 : 76], 60); return; }
    setBrightness(next);
    refreshDevice();
    delta > 0 ? up() : down();
  };
  return <>
    <Txt x={X(595)} y={Y(107)} w={60} align="center" text={`${brightness()}`} size="lg" bold />
    <Txt x={636.5} y={217} w={150} align="right" text={`LCD IC: ${device()?.display.panel || "unknown"}`} size="2xs" color="#55866d" />
    <Hit x={X(505)} y={Y(176)} w={40.5} h={42.5} onPress={() => change(20)} />
    <Hit x={X(599)} y={Y(176)} w={40.5} h={42.5} onPress={() => change(-20)} />
  </>;
}

function Speaker() {
  const volume = () => device()?.volume ?? 0;
  const change = (delta: number) => {
    const next = Math.max(0, Math.min(100, volume() + delta));
    if (next === volume()) { if (delta > 0) melody([96], 60); return; }
    setVolume(next);
    refreshDevice();
    delta > 0 ? up() : down();
  };
  return <>
    <Txt x={X(606)} y={Y(247)} w={60} align="center" text={`${volume()}`} bold />
    <Hit x={X(505)} y={Y(314)} w={40.5} h={42.5} onPress={() => change(20)} />
    <Hit x={X(599)} y={Y(314)} w={40.5} h={42.5} onPress={() => change(-20)} />
  </>;
}

function Switches(props: { openAccessPoint: () => void }) {
  const on = (id: string) => device()?.switches.find(item => item.id === id)?.on ?? false;
  const connected = (id: string) => device()?.ports.find(port => port.id === id)?.connected ?? false;
  const toggle = (item: (typeof SWITCHES)[number]) => {
    const next = !on(item.id);
    if (!setSwitch(item.id, next)) { notify(device()?.error || "The switch did not change"); return; }
    refreshDevice();
    notify(next ? item.enabled : item.disabled);
    click();
    // Switching the antenna shows how to reach the access point, as the
    // factory firmware does.
    if (item.id === "antenna") props.openAccessPoint();
  };
  return <>
    {SWITCHES.map(item => <>
      <Img src={on(item.id) ? item.on : item.off} x={X(item.x) - 18.5} y={Y(item.y) - 10.5} w={37} h={21} />
      <Hit x={X(item.x)} y={Y(item.y)} w={65} h={37.5} onPress={() => toggle(item)} />
    </>)}
    {PORTS.map(port => <Img src="art/arrow_state_on.png" x={X(-627) - 4.5} y={Y(port.y) - 6.5} w={9} h={13} show={connected(port.id)} />)}
  </>;
}

/** The factory boot animation: "Tab" rises in, "5" slides to its side,
 *  a chord plays, then the launcher shows. */
function Startup(props: { done: () => void }) {
  let frame = 0, tab: NodeMirror | undefined, five: NodeMirror | undefined, root: NodeMirror | undefined;
  onFrame(() => {
    ++frame;
    if (frame === 12 && tab) {
      animate(tab, "translateY", 0, { dur: 600, easing: "out" });
      animate(tab, "opacity", 1, { dur: 600, easing: "linear" });
    }
    if (frame === 32 && five) animate(five, "translateX", 0, { dur: 400, easing: "out" });
    if (frame === 40) melody([72, 76, 79, 84], 90);
    if (frame === 72 && root) animate(root, "opacity", 0, { dur: 250, easing: "linear" });
    if (frame === 80) props.done();
  });
  return <View ref={(node: NodeMirror) => { root = node; }} class="absolute"
    style={{ insetL: 0, insetT: 0, width: 640, height: 360, bgColor: "#ffffff" }}>
    <View ref={(node: NodeMirror) => { tab = node; jump(node, "translateY", 238); jump(node, "opacity", 0); }}
      class="absolute" style={{ insetL: 252, insetT: 154.5, width: 90, height: 40 }}>
      <Img src="art/logo_tab.png" x={0} y={0} w={90} h={40} />
    </View>
    <View ref={(node: NodeMirror) => { five = node; jump(node, "translateX", 309); }}
      class="absolute" style={{ insetL: 346, insetT: 154, width: 30, height: 40 }}>
      <Img src="art/logo_5.png" x={0} y={0} w={30} h={40} />
    </View>
    <Txt x={610} y={340} w={60} align="center" text="V0.1" size="2xs" color="#cccccc" />
  </View>;
}

mount(() => {
  startStore();
  const [tool, setTool] = createSignal<Tool>();
  const [booting, setBooting] = createSignal(true);
  const open = (next: Tool) => { click(); setTool(next); };
  const close = () => { click(); setTool(undefined); };
  const is = (name: Tool) => tool() === name;
  const power = () => { const name = tool(); return name === "off" || name === "touch" || name === "shake" || name === "timer" ? name : undefined; };
  return <AuxiliarySurface>
    <View class="w-full h-full" style={{ bgColor: "#f2f2f2" }}>
      <Background />
      <PowerMonitor />
      <Rtc />
      <Imu />
      <Backlight />
      <Speaker />
      <Switches openAccessPoint={() => setTool("ap")} />
      {(Object.keys(BUTTONS) as Tool[]).map(name => {
        const b = BUTTONS[name];
        return <Hit x={X(b.x)} y={Y(b.y)} w={b.w / 2} h={b.h / 2} radius={10} onPress={() => open(name)} />;
      })}
      <Switch>
        <Match when={is("rtc")}><RtcWindow from={BUTTONS.rtc} onClose={close} /></Match>
        <Match when={is("camera")}><CameraWindow from={BUTTONS.camera} onClose={close} /></Match>
        <Match when={is("mic")}><MicWindow from={BUTTONS.mic} onClose={close} /></Match>
        <Match when={is("headphone")}><HeadphoneWindow from={BUTTONS.headphone} onClose={close} /></Match>
        <Match when={is("music")}><MusicWindow from={BUTTONS.music} onClose={close} /></Match>
        <Match when={is("card")}><CardWindow from={BUTTONS.card} onClose={close} /></Match>
        <Match when={is("scan")}><ScanWindow from={BUTTONS.scan} onClose={close} /></Match>
        <Match when={is("gpio")}><GpioWindows from={BUTTONS.gpio} onClose={close} /></Match>
        <Match when={is("serial")}><SerialWindow from={BUTTONS.serial} onClose={close} /></Match>
        <Match when={is("ap")}><AccessPointWindow from={BUTTONS.ap} onClose={close} /></Match>
        <Match when={is("station")}><StationWindow from={BUTTONS.station} onClose={close} /></Match>
        <Match when={power()} keyed>{action =>
          <PowerWindow action={action} from={BUTTONS[action]} onClose={close} />}
        </Match>
      </Switch>
      <Toast text={toast()} onDismiss={dismissToast} />
      <Show when={booting()}><Startup done={() => setBooting(false)} /></Show>
    </View>
  </AuxiliarySurface>;
});
