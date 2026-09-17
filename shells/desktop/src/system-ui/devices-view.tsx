// SPDX-License-Identifier: GPL-3.0-only
// Explorer client: navigation tree, details list and selection inspector.
// Paint and input share DEVICE_LAYOUT; discovery stays in the headless model.
import { For } from "solid-js";
import { Image, View } from "@pocketjs/framework/components";
import { UiText } from "./chrome.tsx";
import type { DesktopTheme } from "./theme.ts";
import { DEVICE_LAYOUT as L, DEVICE_PLACES, deviceClass, deviceClassName, type DevicesData } from "./devices.ts";

export function DevicesView(props: { data: DevicesData; theme: DesktopTheme; active: boolean }) {
  const d = props.data;
  const nameWidth = d.nameWidth;
  const listHeight = () => d.viewport().h - L.toolbar - L.header - L.status - L.details;
  const thumbHeight = () => Math.max(20, listHeight() * d.capacity() / Math.max(1, d.filtered().length));
  const text = (value: string, muted = false, bold = false) =>
    <UiText theme={props.theme} t={value} bold={bold} cls={muted ? props.theme.mutedText : "text-[#20252b]"} />;
  return <View class="relative flex-1 bg-[#ffffff] overflow-hidden">
    <View class={props.theme.devices.toolbar}>
      <View class="absolute left-[8] top-[7] w-[28] h-[24]">
        <View class={props.theme.folderToolButton(d.history().at > 0, false)} style={{ width: 28, height: 24 }}>
          <Image class="w-[16] h-[16]" src={props.theme.icon("back", 16)} />
        </View>
      </View>
      <View class="absolute left-[40] top-[7] w-[28] h-[24]">
        <View class={props.theme.folderToolButton(d.history().at < d.history().items.length - 1, false)} style={{ width: 28, height: 24 }}>
          <Image class="w-[16] h-[16]" src={props.theme.icon("forward", 16)} />
        </View>
      </View>
      <View class="absolute left-[82] right-[98] top-[7] h-[24] flex-row items-center gap-[6] overflow-hidden">
        <Image class="w-[16] h-[16]" src={props.theme.icon(d.place() === "all" ? "devices" : d.place() as "handheld" | "media-player", 16)} />
        {text(d.label())}
      </View>
      <View class="absolute right-[8] top-[7] w-[78] h-[24]">
        <View class={props.theme.dialogButton(false, false)} style={{ width: 78, height: 24 }}>{text("Refresh")}</View>
      </View>
    </View>
    <View class={props.theme.devices.sidebar}>
      <For each={d.expanded() ? DEVICE_PLACES : DEVICE_PLACES.slice(0, 1)}>{(place, i) =>
        <View class={props.theme.devices.treeRow(d.place() === place.id, props.active)} style={{ insetT: L.treeTop + i() * L.treeRow }}>
          <View class={i() === 0 ? "flex-row items-center gap-[5] pl-[4] overflow-hidden" : "flex-row items-center gap-[5] pl-[24] overflow-hidden"}>
            {i() === 0 ? <UiText theme={props.theme} cls={d.place() === place.id && props.active ? props.theme.devices.selectedText : props.theme.folderSideText(false, props.active)} t={d.expanded() ? "-" : "+"} /> : null}
            <Image class="w-[16] h-[16]" src={props.theme.icon(place.icon, 16)} />
            <UiText theme={props.theme} cls={d.place() === place.id && props.active ? props.theme.devices.selectedText : props.theme.folderSideText(false, props.active)} t={i() === 0 ? "Devices" : place.label} />
          </View>
        </View>
      }</For>
    </View>
    <View class={props.theme.devices.header}>
      <View class="h-[24] flex-row items-center pl-[8]" style={{ width: nameWidth() }}>{text(d.descending() ? "Name v" : "Name ^")}</View>
      <View class="flex-1 h-[24] flex-row items-center pl-[8]">{text("Connection")}</View>
    </View>
    <View class="absolute left-[168] right-[12] top-[62] bottom-[116] overflow-hidden">
      <For each={d.visible()}>{(device, i) =>
        <View class={props.theme.devices.listRow(d.selected() === device.id, i() % 2 === 1)} style={{ insetT: i() * L.row }}>
          <View class="h-[32] flex-row items-center gap-[7] px-[8] overflow-hidden" style={{ width: nameWidth() }}>
            <Image class="w-[16] h-[16]" src={props.theme.icon(deviceClass(device), 16)} />
            <UiText theme={props.theme} t={device.name} cls={d.selected() === device.id ? props.theme.devices.selectedText : "text-[#20252b]"} />
          </View>
          <View class="flex-1 h-[32] flex-row items-center pl-[8] overflow-hidden">
            <UiText theme={props.theme} t={device.connection} cls={d.selected() === device.id ? props.theme.devices.selectedText : props.theme.mutedText} />
          </View>
        </View>
      }</For>
      {d.filtered().length === 0 ? <View class="absolute inset-0 flex-col justify-center items-center gap-[8]">
        {text(!d.received() ? "Looking for connected devices..." : "No supported devices connected", true)}
        {text("Connect a device using USB.", true)}
      </View> : null}
    </View>
    {d.filtered().length > d.capacity() ? <View class="absolute right-0 top-[62] bottom-[116] w-[12] bg-[#efefef]">
      <View class="absolute left-[3] w-[6] rounded-[3] bg-[#a0a0a0]" style={{ height: thumbHeight(), insetT: (listHeight() - thumbHeight()) * d.offset() / (d.filtered().length - d.capacity()) }} />
    </View> : null}
    <View class={props.theme.devices.details}>
      <Image class="absolute left-[12] top-[18] w-[32] h-[32]" src={props.theme.icon(d.current() ? deviceClass(d.current()!) : "devices", 32)} />
      <View class="absolute left-[56] right-[12] top-[10] flex-col gap-[7] overflow-hidden">
        {text(d.current()?.name ?? d.label(), false, true)}
        {text(d.current() ? `${deviceClassName(d.current()!)} / ${d.current()!.connection}` : `${d.filtered().length} connected devices`, true)}
        {text(d.current()?.serial ? `Serial: ${d.current()!.serial}` : d.current() ? "USB connected" : "Select a device to view its properties.", true)}
      </View>
    </View>
    <View class={props.theme.devices.status}>{text(d.status(), true)}</View>
  </View>;
}
