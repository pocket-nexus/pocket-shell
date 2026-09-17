// SPDX-License-Identifier: GPL-3.0-only
// Compact My Computer content; category names only choose the icon artwork.
import { For } from "solid-js";
import { Image, View } from "@pocketjs/framework/components";
import { UiText } from "./chrome.tsx";
import type { DesktopTheme } from "./theme.ts";
import { DEVICE_LAYOUT as L, deviceClass, type DevicesData } from "./devices.ts";

export function DevicesView(props: { data: DevicesData; theme: DesktopTheme; active: boolean }) {
  const d = props.data;
  const listHeight = () => d.viewport().h - d.contentTop() - L.status;
  const thumbHeight = () => Math.max(20, listHeight() * d.capacity() / Math.max(1, d.filtered().length));
  const text = (value: string, muted = false) => <UiText theme={props.theme} t={value} cls={muted ? props.theme.mutedText : "text-[#20252b]"} />;
  const button = (title: string, pressed: boolean) => <View class={props.theme.devices.button(pressed)}>
    {props.theme.toolFace(true, true, pressed) ? <Image class="absolute inset-0 w-[64] h-[22]" src={props.theme.toolFace(true, true, pressed)} /> : null}
    {text(title)}
  </View>;
  return <View class="relative flex-1 bg-[#ffffff] overflow-hidden">
    <View class={props.theme.devices.toolbar}>
      <View class="absolute left-[6] top-[4]">{button("Refresh", false)}</View>
      <View class="absolute right-[72] top-[4]">{button("Icons", d.mode() === "icons")}</View>
      <View class="absolute right-[6] top-[4]">{button("List", d.mode() === "list")}</View>
    </View>
    {d.mode() === "list" ? <View class={props.theme.devices.header}>
      <View class="h-[20] flex-row items-center pl-[6]" style={{ width: d.nameWidth() }}>{text(d.descending() ? "Name v" : "Name ^")}</View>
      <View class="flex-1 h-[20] flex-row items-center pl-[6]">{text("Connection")}</View>
    </View> : null}
    <View class="absolute left-0 right-[12] bottom-[20] overflow-hidden" style={{ insetT: d.contentTop() }}>
      <For each={d.visible()}>{(device, i) => <>{d.mode() === "list"
        ? <View class={props.theme.devices.listRow(d.selected() === device.id, i() % 2 === 1)} style={{ insetT: i() * L.row }}>
            <View class="h-[22] flex-row items-center gap-[6] px-[6] overflow-hidden" style={{ width: d.nameWidth() }}>
              <Image class="w-[16] h-[16]" src={props.theme.icon(deviceClass(device), 16)} />
              <UiText theme={props.theme} t={device.name} cls={d.selected() === device.id ? props.theme.devices.selectedText : "text-[#20252b]"} />
            </View>
            <View class="flex-1 h-[22] flex-row items-center pl-[6] overflow-hidden">
              <UiText theme={props.theme} t={device.connection} cls={d.selected() === device.id ? props.theme.devices.selectedText : props.theme.mutedText} />
            </View>
          </View>
        : <View class="absolute w-[112] h-[76] flex-col items-center pt-[6] gap-[5] overflow-hidden" style={{ insetL: L.pad + (i() % d.columns()) * L.cellW, insetT: Math.floor(i() / d.columns()) * L.cellH }}>
            <Image class="w-[32] h-[32]" src={props.theme.icon(deviceClass(device), 32, d.selected() === device.id)} />
            <View class={props.theme.devices.iconLabel(d.selected() === device.id)}>
              <UiText theme={props.theme} t={device.name} cls={d.selected() === device.id ? props.theme.devices.selectedText : "text-[#20252b]"} />
            </View>
          </View>
      }</>}</For>
      {d.filtered().length === 0 ? <View class="absolute left-[12] top-[12] right-[12] flex-col gap-[8]">
        {text(!d.received() ? "Looking for connected devices..." : "No supported devices connected", true)}
        {text("Connect a device using USB.", true)}
      </View> : null}
    </View>
    {d.maxOffset() > 0 ? <View class="absolute right-0 bottom-[20] w-[12] bg-[#efefef]" style={{ insetT: d.contentTop() }}>
      <View class="absolute left-[3] w-[6] rounded-[3] bg-[#a0a0a0]" style={{ height: thumbHeight(), insetT: (listHeight() - thumbHeight()) * d.offset() / d.maxOffset() }} />
    </View> : null}
    <View class={props.theme.devices.status}>{text(d.current()
      ? `${d.current()!.name} / ${d.current()!.connection}${d.current()!.serial ? ` / ${d.current()!.serial}` : ""}` : d.status(), true)}</View>
  </View>;
}
