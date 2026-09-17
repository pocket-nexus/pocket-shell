// SPDX-License-Identifier: GPL-3.0-only
// Devices paints a window client using the desktop theme. Input and discovery
// are supplied by the headless model; this view never mounts a second shell.
import { For } from "solid-js";
import { View } from "@pocketjs/framework/components";
import { UiText } from "./chrome.tsx";
import type { DesktopTheme } from "./theme.ts";
import { DEVICE_LAYOUT as L, type ConnectedDevice, type DevicesData } from "./devices.ts";

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

export function DevicesView(props: { data: DevicesData; theme: DesktopTheme }) {
  const { current, devices, visible, selected, expanded, received, status } = props.data;
  const T = (text: { text: string; muted?: boolean; bold?: boolean }) =>
    <UiText theme={props.theme} t={text.text} bold={text.bold} cls={text.muted ? props.theme.mutedText : "text-[#20252b]"} />;
  return <View class="relative flex-1 bg-[#ffffff] overflow-hidden">
    <View class={props.theme.devices.toolbar}>
      <T text="Overview" bold />
    </View>
    <View class="absolute top-[14] right-[14] w-[88] h-[28]">
      <View class={props.theme.dialogButton(false, false)} style={{ width: 88, height: 28 }}>
      <T text="Refresh" />
      </View>
    </View>
    <View class={props.theme.devices.sidebar}>
      <View class="absolute left-[16] top-0 h-[44] flex-row items-center gap-[10]">
        <T text={expanded() ? "v" : ">"} />
        <T text="Devices" bold />
        <T text={String(devices().length)} muted />
      </View>
      {expanded() ? <For each={visible()}>{(device, i) =>
        <View class={props.theme.devices.row(selected() === device.id)}
          style={{ insetT: L.section + i() * L.row }}>
          <DeviceGlyph kind={device.kind} />
          <UiText t={device.name} theme={props.theme} cls={selected() === device.id ? props.theme.selectionText : "text-[#20252b]"} />
        </View>
      }</For> : null}
    </View>
    <View class={props.theme.devices.border} />
    <View class="absolute left-[244] top-[82] right-[28] flex-col gap-[12]">
      <T text={current()?.name ?? "Connected devices"} bold />
      <T text={current() ? "Connected to this Mac" : "Supported PocketJS hardware"} muted />
    </View>
    {current() ? <View class="absolute left-[244] top-[144] right-[28] flex-col gap-[12]">
      <View class="h-[48] justify-center pl-[24]"><DeviceGlyph kind={current()!.kind} large /></View>
      <T text={`Connection: ${current()!.connection}`} />
      <T text={current()!.kind === "psp" ? "Sony PlayStation Portable" : "Apple iPod touch (4th generation)"} />
      <T text="USB connected" />
      <T text={current()!.serial ? "Serial number" : "USB device detected on this Mac"} muted />
      <T text={current()!.serial ?? ""} muted />
    </View> : <>
      <For each={visible()}>{(device, i) => <View class="absolute left-[244] right-[28] h-[66] bg-[#f6f7f9] rounded-[5] flex-row items-center px-[16] gap-[16]"
        style={{ insetT: L.cardTop + i() * L.cardRow }}>
        <DeviceGlyph kind={device.kind} />
        <View class="flex-col gap-[7]"><T text={device.name} bold /><T text={device.connection} muted /></View>
      </View>}</For>
      {devices().length === 0 ? <View class="absolute left-[244] top-[160] right-[28] flex-col gap-[14]">
        <T text={!received() ? "Looking for connected devices..." : "No supported devices connected"} />
        <T text="Connect a PSP or iPod touch 4." muted />
      </View> : null}
    </>}
    <View class={props.theme.devices.status}>
      <T text={status()} muted />
    </View>
  </View>;
}
