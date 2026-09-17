// SPDX-License-Identifier: GPL-3.0-only
import { For, createSignal } from "solid-js";
import { getOps, mount } from "@pocketjs/framework";
import { View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { virtualNow } from "@pocketjs/framework/clock";
import { UiText } from "./chrome.tsx";
import { nextThemeId, themeById, type ThemeId } from "./theme.ts";
import { DEVICE_LAYOUT as L, deviceSnapshot, type ConnectedDevice } from "./devices.ts";

function DeviceGlyph(props: { kind: ConnectedDevice["kind"]; large?: boolean }) {
  return <View class="relative w-[44] h-[36]" style={{ scaleX: props.large ? 2 : 1, scaleY: props.large ? 2 : 1 }}>
    {props.kind === "psp" ? <>
      <View class="absolute left-0 top-[7] w-[44] h-[23] rounded-[9] bg-[#353b44]" />
      <View class="absolute left-[10] top-[10] w-[24] h-[17] rounded-[2] bg-[#a6c4dc]" />
      <View class="absolute left-[3] top-[16] w-[5] h-[2] bg-[#c9cdd2]" />
      <View class="absolute left-[5] top-[14] w-[2] h-[6] bg-[#c9cdd2]" />
      <View class="absolute left-[37] top-[16] w-[3] h-[3] rounded-[2] bg-[#c9cdd2]" />
    </> : <>
      <View class="absolute left-[12] top-0 w-[21] h-[36] rounded-[5] bg-[#353b44]" />
      <View class="absolute left-[14] top-[5] w-[17] h-[24] bg-[#a6c4dc]" />
      <View class="absolute left-[20] top-[31] w-[5] h-[3] rounded-[2] bg-[#c9cdd2]" />
    </>}
  </View>;
}

function Devices() {
  const ops = getOps();
  const connected = !!ops.svcOpen?.("system-ui");
  const [themeId, setThemeId] = createSignal<ThemeId>("aqua");
  const theme = () => themeById(themeId());
  const [viewport, setViewport] = createSignal({ w: 800, h: 600 });
  const [devices, setDevices] = createSignal<ConnectedDevice[]>([]);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal(true);
  const [status, setStatus] = createSignal("Looking for connected devices...");
  const [offset, setOffset] = createSignal(0);
  const [received, setReceived] = createSignal(false);
  const current = () => devices().find(d => d.id === selected());
  const capacity = () => Math.max(1, Math.floor((viewport().h - L.cardTop - L.status) / L.cardRow));
  const visible = () => devices().slice(offset(), offset() + capacity());
  let lastSnapshot = -1;
  let down = false;
  let pointerX = 0;
  const refresh = () => ops.svcSend?.(JSON.stringify({ t: "devices-refresh" }));
  const cycleTheme = () => setThemeId(nextThemeId(themeId()));
  function click(x: number, y: number) {
    if (y < L.toolbar) {
      if (x >= viewport().w - 104) refresh();
      else if (x >= viewport().w - 218) cycleTheme();
    } else if (x < L.sidebar) {
      if (y < L.toolbar + L.section) setExpanded(!expanded());
      else if (expanded()) {
        const device = visible()[Math.floor((y - L.toolbar - L.section) / L.row)];
        if (device) setSelected(device.id);
      }
    } else if (!current()) {
      const device = visible()[Math.floor((y - L.cardTop) / L.cardRow)];
      if (y >= L.cardTop && device) setSelected(device.id);
    }
  }
  function key(ev: Record<string, unknown>) {
    const k = String(ev.k).toLowerCase();
    if (ev.cmd && k === "r") return refresh();
    if (ev.cmd && ev.sh && k === "t") return cycleTheme();
    if (k === "escape") return setSelected(null);
    if (k === "left") return setExpanded(false);
    if (k === "right") return setExpanded(true);
    if (k !== "up" && k !== "down") return;
    setExpanded(true);
    const index = devices().findIndex(d => d.id === selected());
    const next = Math.min(devices().length - 1, Math.max(0, index + (k === "down" ? 1 : -1)));
    if (devices()[next]) {
      setSelected(devices()[next]!.id);
      if (next < offset()) setOffset(next);
      else if (next >= offset() + capacity()) setOffset(next - capacity() + 1);
    }
  }
  onFrame(() => {
    const batch = connected ? ops.svcPoll?.() : null;
    for (const line of (batch ?? "").split("\n")) {
      if (!line) continue;
      let ev: Record<string, unknown>;
      try { ev = JSON.parse(line); } catch { continue; }
      if (!ev || typeof ev !== "object") continue;
      const snapshot = deviceSnapshot(ev);
      if (snapshot) {
        setReceived(true);
        lastSnapshot = virtualNow();
        if (JSON.stringify(devices()) !== JSON.stringify(snapshot.devices)) setDevices(snapshot.devices);
        if (!snapshot.devices.some(d => d.id === selected())) setSelected(null);
        setOffset(Math.min(offset(), Math.max(0, snapshot.devices.length - capacity())));
        setStatus(snapshot.error ?? `${snapshot.devices.length} ${snapshot.devices.length === 1 ? "device" : "devices"} connected via USB`);
      } else if ((ev.t === "hello" || ev.t === "resize") && typeof ev.w === "number" && typeof ev.h === "number") {
        setViewport({ w: ev.w, h: ev.h });
      } else if (ev.t === "mouse" && ev.b !== 2) {
        pointerX = typeof ev.x === "number" ? ev.x : pointerX;
        if (ev.d && !down && typeof ev.y === "number") click(pointerX, ev.y);
        down = !!ev.d;
      } else if (ev.t === "key") key(ev);
      else if (ev.t === "scroll" && typeof ev.dy === "number") {
        setOffset(Math.min(Math.max(0, devices().length - capacity()), Math.max(0, offset() + Math.sign(ev.dy))));
      }
    }
    if ((lastSnapshot >= 0 && virtualNow() - lastSnapshot > 4) || (lastSnapshot < 0 && virtualNow() > 5)) {
      setReceived(true);
      setDevices([]);
      setSelected(null);
      setStatus("Device discovery is unavailable. Reopen Pocket Shell to reconnect.");
    }
  });
  const T = (props: { text: string; muted?: boolean; bold?: boolean }) =>
    <UiText theme={theme()} t={props.text} bold={props.bold} cls={props.muted ? theme().mutedText : "text-[#20252b]"} />;
  return <View class="absolute inset-0 bg-[#ffffff] overflow-hidden">
    <View class={theme().devices.toolbar}>
      <T text="Pocket Shell" bold />
    </View>
    <View class="absolute top-[14] right-[116] w-[96] h-[28]">
      <View class={theme().dialogButton(false, false)} style={{ width: 96, height: 28 }}>
      <T text={theme().label} />
      </View>
    </View>
    <View class="absolute top-[14] right-[14] w-[88] h-[28]">
      <View class={theme().dialogButton(false, false)} style={{ width: 88, height: 28 }}>
      <T text="Refresh" />
      </View>
    </View>
    <View class={theme().devices.sidebar}>
      <View class="absolute left-[16] top-0 h-[44] flex-row items-center gap-[10]">
        <T text={expanded() ? "v" : ">"} />
        <T text="Devices" bold />
        <T text={String(devices().length)} muted />
      </View>
      {expanded() ? <For each={visible()}>{(device, i) =>
        <View class={theme().devices.row(selected() === device.id)}
          style={{ insetT: L.section + i() * L.row }}>
          <DeviceGlyph kind={device.kind} />
          <UiText t={device.name} theme={theme()} cls={selected() === device.id ? theme().selectionText : "text-[#20252b]"} />
        </View>
      }</For> : null}
    </View>
    <View class={theme().devices.border} />
    <View class="absolute left-[244] top-[82] right-[28] flex-col gap-[12]">
      <T text={current()?.name ?? "Connected devices"} bold />
      <T text={current() ? "Connected to this Mac" : "PocketJS devices connected to this Mac"} muted />
    </View>
    {current() ? <View class="absolute left-[244] top-[152] right-[28] flex-col gap-[22]">
      <View class="h-[60] justify-center pl-[24]"><DeviceGlyph kind={current()!.kind} large /></View>
      <T text={`Connection: ${current()!.connection}`} />
      <T text={`Device: ${current()!.kind === "psp" ? "Sony PlayStation Portable" : "Apple iPod touch (4th generation)"}`} />
      <T text="USB connected" />
      <T text={current()!.serial ? `Serial: ${current()!.serial}` : "USB device detected on this Mac"} muted />
    </View> : <>
      <For each={visible()}>{(device, i) => <View class="absolute left-[244] right-[28] h-[66] bg-[#f6f7f9] rounded-[5] flex-row items-center px-[16] gap-[16]"
        style={{ insetT: L.cardTop + i() * L.cardRow }}>
        <DeviceGlyph kind={device.kind} />
        <View class="flex-col gap-[7]"><T text={device.name} bold /><T text={device.connection} muted /></View>
      </View>}</For>
      {devices().length === 0 ? <View class="absolute left-[244] top-[160] right-[28] flex-col gap-[14]">
        <T text={!received() ? "Looking for connected devices..." : "No supported devices connected"} />
        <T text="Connect a PSP or iPod touch 4 with a USB data cable." muted />
      </View> : null}
    </>}
    <View class={theme().devices.status}>
      <T text={status()} muted />
    </View>
  </View>;
}

mount(() => <Devices />);
