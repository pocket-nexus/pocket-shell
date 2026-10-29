// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/home/pages.tsx — the Settings pages: the root list (with the
// Dual Screen switch), Wi-Fi, Mac, Applets, General, About and Time Zone. Each page is section data over the
// live system state; the grouped table draws it and the navigation stack
// scrolls, focuses and pushes it.

import { createSignal, onMount, type Accessor } from "solid-js";
import { View } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import type { WifiNetwork } from "@pocketjs/framework/wifi";
import { offsetText, TIME_ZONES } from "./clock.ts";
import { displayApi } from "./display.ts";
import { LINK_PAIRING, LINK_STATE, sizeText, type HomeApp, type HomeSystem } from "./system.ts";
import { appTile } from "./app-icon.ts";
import type { LayerContext, NavStack, PageSpec } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W } from "../ui/screen.ts";
import { tableContent, type Cell, type CellIcon, type Section } from "../ui/table.tsx";
import type { Press } from "../ui/touch.ts";

export const HOME_VERSION = "0.1.0";

export const ICONS = {
  wifi: { art: "wifi" },
  mac: { art: "mac" },
  apps: { art: "apps" },
  general: { art: "settings" },
} satisfies Record<string, CellIcon>;

export interface PageEnv {
  sys: HomeSystem;
  press: Press;
  keys: Accessor<boolean>;
  /** Confirm a destructive action in an alert. */
  confirm(title: string, message: string, action: string, run: () => void): void;
}

/** One line for the Wi-Fi row and the status bar. */
export function wifiSummary(sys: HomeSystem): string {
  const wifi = sys.wifi();
  if (!wifi) return "Unavailable";
  if (wifi.state === "off") return "Off";
  if (wifi.state === "connecting") return "Connecting...";
  if (wifi.state === "connected") return wifi.ssid || "Connected";
  return "Not Connected";
}

/** One line for the Mac row. */
export function linkSummary(sys: HomeSystem): string {
  const link = sys.link();
  if (!sys.hasLink) return "Unavailable";
  if (link.state === LINK_STATE.linked) return link.companion?.name ?? "Linked";
  if (link.state === LINK_STATE.connecting) return "Connecting...";
  if (link.state === LINK_STATE.searching) return "Searching...";
  return "Not Paired";
}

function table(env: PageEnv, layer: LayerContext, sections: Accessor<Section[]>) {
  return tableContent({ sections, width: SCREEN_W, press: env.press, focus: layer.focus, keys: env.keys });
}

const DUAL_SCREEN_FOOTER =
  "On, Claude lives on the top screen. Off, the console uses one screen and Claude waits behind the notch at the top.";

function rootPage(env: PageEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { sys } = env;
  const display = displayApi();
  const [mode, setMode] = createSignal(display?.displayMode() ?? "dual");
  const toggleDisplay = () => {
    if (!display) return;
    const next = mode() === "dual" ? "single" : "dual";
    display.setDisplayMode(next);
    setMode(display.displayMode());
  };
  return {
    title: () => "Settings",
    content: table(env, layer, () => [
      {
        cells: [
          { id: "settings.wifi", label: "Wi-Fi", value: wifiSummary(sys), icon: ICONS.wifi, accessory: "chevron", run: () => stack.push("wifi") },
          { id: "settings.mac", label: "Mac", value: linkSummary(sys), icon: ICONS.mac, accessory: "chevron", run: () => stack.push("mac") },
        ],
      },
      {
        cells: [
          { id: "settings.apps", label: "Applets", value: String(sys.table().apps.length), icon: ICONS.apps, accessory: "chevron", run: () => stack.push("apps") },
        ],
      },
      ...(display
        ? [
            {
              cells: [{ id: "settings.dual", label: "Dual Screen", accessory: "switch" as const, on: mode() === "dual", run: toggleDisplay }],
              footer: DUAL_SCREEN_FOOTER,
            },
          ]
        : []),
      {
        cells: [
          { id: "settings.general", label: "General", icon: ICONS.general, accessory: "chevron", run: () => stack.push("general") },
        ],
      },
    ]),
  };
}

const ADD_NETWORK =
  "The console joins only its three saved connections. To add one, open System Settings > Internet Settings > Connection Settings from the HOME Menu.";

function wifiPage(env: PageEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { sys } = env;
  if (sys.canJoin) return joinableWifiPage(env, stack, layer);
  return {
    title: () => "Wi-Fi",
    content: table(env, layer, () => {
      const wifi = sys.wifi();
      if (!wifi) {
        return [{ cells: [{ id: "wifi.none", label: "Wi-Fi", value: "Unavailable", tone: "muted" }], footer: "This console does not let applets read its wireless settings." }];
      }
      const on = wifi.state !== "off";
      const sections: Section[] = [
        {
          cells: [{ id: "wifi.toggle", label: "Wi-Fi", accessory: "switch", on, run: () => sys.setWifi(sys.wifi()?.state === "off") }],
          footer: on ? undefined : "Pocket Link, applet downloads and the web need Wi-Fi.",
        },
      ];
      if (!on) return sections;
      sections.push({
        header: "Saved Networks",
        cells: wifi.saved.map((saved) => {
          const active = saved.ssid !== "" && wifi.ssid === saved.ssid;
          const label = saved.ssid || `Connection ${saved.slot + 1}`;
          return {
            id: `wifi.slot.${saved.slot}`,
            label,
            detail: saved.ssid ? undefined : "Not set up",
            tone: saved.ssid ? undefined : ("muted" as const),
            accessory: active && wifi.state === "connecting" ? ("spinner" as const) : active ? ("check" as const) : undefined,
            on: active,
            run: saved.ssid ? () => sys.connect(saved.slot) : undefined,
          };
        }),
        footer: wifi.error ? `${wifi.error}. ${ADD_NETWORK}` : ADD_NETWORK,
      });
      if (wifi.state === "connected") {
        sections.push({
          header: "Connection",
          cells: [
            { id: "wifi.network", label: "Network", value: wifi.ssid, accessory: "bars", level: wifi.strength },
            { id: "wifi.address", label: "IP Address", value: wifi.address || "None" },
          ],
        });
      }
      return sections;
    }),
  };
}

/** Wi-Fi on a console whose launcher is its settings: the networks a scan
 *  finds (one tap joins, asking for the password when the network has one),
 *  the saved ones with Forget, and the connection. */
function joinableWifiPage(env: PageEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { sys } = env;
  onMount(() => sys.scan());
  const choose = (network: WifiNetwork) => {
    const wifi = sys.wifi();
    const slot = wifi?.saved.find((saved) => saved.ssid === network.ssid)?.slot;
    if (slot !== undefined) sys.connect(slot);
    else if (network.secure) stack.push(`wifi.join:${network.ssid}`);
    else sys.join(network.ssid, "");
  };
  return {
    title: () => "Wi-Fi",
    right: () => ({ id: "wifi.scan", label: "Scan", kind: "plain", run: () => sys.scan() }),
    content: table(env, layer, () => {
      const wifi = sys.wifi();
      if (!wifi) return [];
      const on = wifi.state !== "off";
      const sections: Section[] = [
        {
          cells: [{ id: "wifi.toggle", label: "Wi-Fi", accessory: "switch", on, run: () => sys.setWifi(sys.wifi()?.state === "off") }],
          footer: on ? undefined : "Pocket Link, applet downloads and the web need Wi-Fi.",
        },
      ];
      if (!on) return sections;
      const networks: Cell[] = (wifi.networks ?? []).map((network, index) => {
        const current = wifi.ssid === network.ssid;
        return {
          id: `wifi.net.${index}`,
          label: network.ssid,
          detail: network.secure ? "Secured" : "Open",
          accessory: current && wifi.state === "connecting" ? ("spinner" as const) : current ? ("check" as const) : ("bars" as const),
          on: current,
          level: network.strength,
          run: () => choose(network),
        };
      });
      if (wifi.scanning && networks.length === 0) {
        networks.push({ id: "wifi.scanning", label: "Looking for networks...", accessory: "spinner", tone: "muted" });
      }
      sections.push({
        header: "Choose a Network...",
        cells: networks.length > 0 ? networks : [{ id: "wifi.empty", label: "No networks found", tone: "muted" }],
        footer: wifi.error || undefined,
      });
      const saved = wifi.saved.filter((entry) => entry.ssid !== "");
      if (saved.length > 0) {
        sections.push({
          header: "Saved Networks",
          cells: saved.map((entry) => ({
            id: `wifi.saved.${entry.slot}`,
            label: entry.ssid,
            run: () => sys.connect(entry.slot),
            button: { id: `wifi.forget.${entry.slot}`, label: "Forget", tone: "red" as const, run: () => sys.forgetNetwork(entry.slot) },
          })),
        });
      }
      if (wifi.state === "connected") {
        sections.push({
          header: "Connection",
          cells: [{ id: "wifi.address", label: "IP Address", value: wifi.address || "None" }],
        });
      }
      return sections;
    }),
  };
}

/** The password for a network a scan found: typed on the on-screen
 *  keyboard, joined with its return key; its hide key goes back. */
export function wifiJoinPage(env: PageEnv, ssid: string, stack: NavStack, layer: LayerContext): PageSpec {
  const { sys } = env;
  const [password, setPassword] = createSignal("");
  const join = (text: string) => {
    if (!text) return;
    sys.join(ssid, text);
    stack.pop();
  };
  const osk = createOsk({ value: password, setValue: setPassword, onCommit: join, onClose: () => stack.pop(), maxLength: 63, closeOnCommit: false });
  onMount(() => osk.open());
  const keyboardTop = SCREEN_H - oskHeight("auxiliary", "light");
  return {
    title: () => ssid,
    inset: SCREEN_H - keyboardTop,
    content: table(env, layer, () => [
      {
        header: `Enter the password for "${ssid}"`,
        cells: [{ id: "wifi.join.password", label: "Password", value: password() ? "*".repeat(password().length) : "" }],
        footer: "The return key joins; the keyboard's hide key goes back.",
      },
    ]),
    fixed: () => (
      <View class="absolute left-0" style={{ insetT: keyboardTop, width: SCREEN_W, height: SCREEN_H - keyboardTop }}>
        <Osk osk={osk} surface="auxiliary" theme="light" />
      </View>
    ),
  };
}

function macPage(env: PageEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { sys } = env;
  return {
    title: () => "Mac",
    content: table(env, layer, () => {
      if (!sys.hasLink) {
        return [{ cells: [{ id: "mac.none", label: "Pocket Link", value: "Unavailable", tone: "muted" }], footer: "This console's runtime has no Pocket Link." }];
      }
      const link = sys.link();
      const companion = link.companion;
      const status =
        link.state === LINK_STATE.linked ? "Linked"
        : link.state === LINK_STATE.connecting ? "Connecting"
        : link.state === LINK_STATE.searching ? "Searching"
        : "Not Paired";
      const footer =
        link.state === LINK_STATE.linked && companion
          ? `Linked to ${companion.name}${companion.address ? ` at ${companion.address}` : ""}. Applets and web requests come through this Mac.`
          : link.state === LINK_STATE.searching
            ? "Looking for a paired Mac on this network. Open Pocket Companion on the Mac."
            : "Pair a Mac to install applets from it and to reach the web through it.";
      const sections: Section[] = [
        {
          cells: [{
            id: "mac.status",
            label: "Status",
            value: status,
            accessory: link.state === LINK_STATE.searching || link.state === LINK_STATE.connecting ? "spinner" : undefined,
          }],
          footer: link.error && link.state !== LINK_STATE.linked ? `${footer} Last error: ${link.error}.` : footer,
        },
      ];
      if (link.paired.length) {
        sections.push({
          header: "Paired Macs",
          cells: link.paired.map((mac) => ({
            id: `mac.paired.${mac.id}`,
            label: mac.name,
            detail: mac.address ? `${mac.address}:${mac.port}` : "Not seen on this network yet",
            accessory: companion?.id === mac.id ? ("check" as const) : undefined,
            on: companion?.id === mac.id,
            button: {
              id: `mac.forget.${mac.id}`,
              label: "Forget",
              tone: "red" as const,
              run: () => env.confirm(`Forget "${mac.name}"?`, "This console will need to scan its code again to link.", "Forget", () => sys.forget(mac.id)),
            },
          })),
        });
      }
      sections.push({
        cells: [{ id: "mac.pair", label: link.paired.length ? "Pair Another Mac..." : "Pair a Mac...", tone: "action", run: () => stack.push("scan") }],
        footer: "On your Mac, open Pocket Companion and choose Pair a Console... to show a code. Then hold the outer camera up to it.",
      });
      return sections;
    }),
  };
}

function appsPage(env: PageEnv, _stack: NavStack, layer: LayerContext): PageSpec {
  const { sys } = env;
  const remove = (app: HomeApp) =>
    env.confirm(`Delete "${app.title}"?`, "Deleting this applet also deletes its data.", "Delete", () => sys.remove(app));
  return {
    title: () => "Applets",
    content: table(env, layer, () => {
      const apps = sys.table().apps;
      if (apps.length === 0) {
        return [{ cells: [{ id: "apps.none", label: "No Applets Installed", tone: "muted" }], footer: "Install applets from a paired Mac with the Mac icon on the Home screen." }];
      }
      const total = apps.reduce((sum, app) => sum + app.bytes, 0);
      return [
        {
          header: "Installed",
          cells: apps.map((app) => ({
            id: `apps.${app.id}`,
            label: app.title,
            detail: `${app.version ? `Version ${app.version}  ` : ""}${sizeText(app.bytes)}`,
            tile: appTile(app.id, app),
            button: { id: `apps.delete.${app.id}`, label: "Delete", tone: "red" as const, run: () => remove(app) },
            run: () => remove(app),
          })),
          footer: `${apps.length} ${apps.length === 1 ? "applet uses" : "applets use"} ${sizeText(total)} on the SD card.`,
        },
      ];
    }),
  };
}

function generalPage(env: PageEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { sys } = env;
  return {
    title: () => "General",
    content: table(env, layer, () => [
      {
        cells: [
          { id: "general.about", label: "About", accessory: "chevron", run: () => stack.push("about") },
          { id: "general.timezone", label: "Time Zone", value: offsetText(sys.offset()), accessory: "chevron", run: () => stack.push("timezone") },
        ],
      },
    ]),
  };
}

/** The runtime the console reports: "3ds-dev, host ABI 11". */
export function runtimeText(): string {
  const ops = getOps() as unknown as { __host?: unknown; __hostAbi?: unknown };
  const host = typeof ops.__host === "string" ? ops.__host : "";
  const abi = typeof ops.__hostAbi === "number" ? ops.__hostAbi : null;
  if (!host) return "PocketJS";
  return abi === null ? host : `${host}, ABI ${abi}`;
}

/** The console's model when the link does not name it: the 3DS, or the
 *  runtime's target id. */
function consoleModel(): string {
  const host = (getOps() as unknown as { __host?: unknown }).__host;
  return typeof host !== "string" || host.startsWith("3ds") ? "Nintendo 3DS" : host;
}

function aboutPage(env: PageEnv, _stack: NavStack, layer: LayerContext): PageSpec {
  const { sys } = env;
  return {
    title: () => "About",
    content: table(env, layer, () => {
      const link = sys.link();
      const wifi = sys.wifi();
      const device = link.device;
      return [
        {
          cells: [
            { id: "about.name", label: "Name", value: device.name || consoleModel() },
            { id: "about.model", label: "Model", value: device.model || consoleModel() },
            { id: "about.id", label: "Console ID", value: device.id || "Unknown" },
          ],
        },
        {
          cells: [
            { id: "about.wifi", label: "Wi-Fi", value: wifiSummary(sys) },
            { id: "about.ip", label: "IP Address", value: wifi?.address || device.address || "None" },
            { id: "about.mac", label: "Mac", value: linkSummary(sys) },
          ],
        },
        {
          cells: [
            { id: "about.apps", label: "Applets", value: String(sys.table().apps.length) },
            { id: "about.home", label: "Home", value: HOME_VERSION },
            { id: "about.runtime", label: "Runtime", value: runtimeText() },
          ],
        },
      ];
    }),
  };
}

function timezonePage(env: PageEnv, _stack: NavStack, layer: LayerContext): PageSpec {
  const { sys } = env;
  const content = table(env, layer, () => sys.macClock() ? [
      {
        cells: [{ id: `tz.${sys.offset()}`, label: offsetText(sys.offset()), value: "From the Mac", accessory: "check" as const, on: true }],
        footer: "Home shows the paired Mac's time and time zone. The console's own clock is not used.",
      },
    ] : [
      {
        header: "Offset from UTC",
        cells: TIME_ZONES.map((zone) => ({
          id: `tz.${zone.offset}`,
          label: offsetText(zone.offset),
          value: zone.place,
          accessory: "check" as const,
          on: sys.offset() === zone.offset,
          run: () => sys.setOffset(zone.offset),
        })),
        footer: "No Mac has linked since the console started, so Home shows the console's clock. Pair a Mac to take its time.",
      },
    ]);
  // Open on the zone in use.
  onMount(() => {
    const span = content.span(`tz.${sys.offset()}`);
    if (span) layer.reveal(span[0] - 72, span[1] + 72);
  });
  return { title: () => "Time Zone", backLabel: "Time Zone", content };
}

export const SETTINGS_PAGES: Record<string, (env: PageEnv, stack: NavStack, layer: LayerContext) => PageSpec> = {
  settings: rootPage,
  wifi: wifiPage,
  mac: macPage,
  apps: appsPage,
  general: generalPage,
  about: aboutPage,
  timezone: timezonePage,
};

export { LINK_PAIRING };
