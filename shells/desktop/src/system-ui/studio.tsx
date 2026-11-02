// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/studio.tsx — the programs this desktop gains on Pocket Studio's
// computer: Agent Check, Studio Settings and My Games. They exist only when the
// host serves the "pocket-studio" companion (svc.ts), and every value they show
// or change belongs to that host. Geometry follows programs.tsx: a table of
// rectangles in content pixels that the render and the hit test both read.
import { For } from "solid-js";
import { Image, View } from "@pocketjs/framework/components";
import { createState, type State } from "./reactivity.ts";
import type { CursorKind } from "./svc.ts";
import { DialogButton } from "./programs.tsx";
import { UiText } from "./chrome.tsx";
import { THEMES, type DesktopTheme, type ThemeId } from "./theme.ts";

export interface StudioStatus {
  settings: {
    provider: string;
    model: string;
    codexModel: string;
    claudeModel: string;
    customModel: string;
    effort: string;
    proxy: string;
    proxyOn: boolean;
    drift: boolean;
    sound: boolean;
    theme: ThemeId;
  };
  games: number;
  system: { version: string; memory: string; storage: string; battery: string };
  check: {
    running: boolean;
    items: { name: string; state: "wait" | "run" | "ok" | "bad"; detail: string }[];
  };
  /** The settings page for a phone: its address, and its QR code as rows of 0 and 1. */
  phone: { url: string; rows: string[] };
}

export const EMPTY_STATUS: StudioStatus = {
  settings: { provider: "codex", model: "", codexModel: "", claudeModel: "", customModel: "", effort: "medium", proxy: "", proxyOn: false, drift: true, sound: true, theme: "xp" },
  games: 0,
  system: { version: "", memory: "", storage: "", battery: "" },
  check: { running: false, items: [] },
  phone: { url: "", rows: [] },
};

export interface StudioGame {
  id: string;
  title: string;
}

export const PROVIDERS = [
  { id: "codex", label: "Codex" },
  { id: "claude-code", label: "Claude Code" },
  { id: "custom", label: "Your endpoint" },
] as const;
/** The models each agent offers here. An endpoint the player brings names its own. */
export const MODELS: Record<string, readonly string[]> = {
  codex: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"],
  "claude-code": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"],
  custom: [],
};
export const EFFORTS = ["low", "medium", "high"] as const;
export const SETTINGS_TABS = ["Agent", "Phone", "Room", "Appearance", "System"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export interface StudioWinData {
  kind: "studio-check" | "studio-settings" | "studio-games";
  armed: State<string | null>;
  tab: State<SettingsTab>;
  selected: State<number>;
  scroll: State<number>;
}

export function studioData(kind: StudioWinData["kind"]): StudioWinData {
  return {
    kind,
    armed: createState<string | null>(null),
    tab: createState<SettingsTab>("Agent"),
    selected: createState(-1),
    scroll: createState(0),
  };
}

export const STUDIO_GEO = {
  "studio-check": { w: 440, h: 330 },
  "studio-settings": { w: 470, h: 350 },
  "studio-games": { w: 440, h: 340 },
} as const;

interface Box {
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const within = (box: Box, x: number, y: number) =>
  x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;

/** The two buttons along a dialog's foot, the primary one on the left. */
function footButtons(cw: number, ch: number, primary: string | null): Box[] {
  const y = ch - 10 - 23;
  const close = { tag: "close", x: cw - 10 - 75, y, w: 75, h: 23 };
  return primary ? [{ tag: primary, x: close.x - 6 - 75, y, w: 75, h: 23 }, close] : [close];
}

function Button(props: { box: Box; label: string; armed: boolean; primary?: boolean; theme: DesktopTheme }) {
  return (
    <View class="absolute" style={{ insetL: props.box.x, insetT: props.box.y }}>
      <DialogButton label={props.label} armed={props.armed} primary={props.primary} theme={props.theme} />
    </View>
  );
}

function Heading(props: { icon: "studioAgent" | "studioSettings" | "studioGames"; title: string; line: string; theme: DesktopTheme }) {
  return (
    <View class="flex-row items-center gap-[10] px-[10] h-[46] shrink-0">
      <Image class="w-[32] h-[32]" src={props.theme.icon(props.icon, 32)} />
      <View class="flex-col gap-[1]">
        <UiText theme={props.theme} bold t={props.title} />
        <UiText theme={props.theme} cls={props.theme.mutedText} t={props.line} />
      </View>
    </View>
  );
}

/** A sunken field: a one-pixel line around a face, in the theme's colors. */
function Well(props: { box: Omit<Box, "tag">; theme: DesktopTheme; children?: unknown }) {
  return (
    <View
      class="absolute"
      style={{ bgColor: props.theme.sheet.wellLine, insetL: props.box.x, insetT: props.box.y, width: props.box.w, height: props.box.h }}
    >
      <View
        class="absolute flex-col overflow-hidden"
        style={{ bgColor: props.theme.sheet.well, insetL: 1, insetT: 1, width: props.box.w - 2, height: props.box.h - 2 }}
      >
        {props.children as never}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Agent Check
// ---------------------------------------------------------------------------

const CHECK_ROW = 25;
const CHECK_TOP = 52;

export function checkHit(cw: number, ch: number, x: number, y: number): string | null {
  return footButtons(cw, ch, "run").find((box) => within(box, x, y))?.tag ?? null;
}

export function checkVerdict(check: StudioStatus["check"]): string {
  if (check.running) return "Checking this console...";
  if (check.items.length === 0) return "Not checked since this console started.";
  const bad = check.items.filter((item) => item.state === "bad").length;
  if (bad > 0) return bad === 1 ? "1 problem found." : `${bad} problems found.`;
  return "The agent can make games on this console.";
}

function statusIcon(state: string): string {
  if (state === "ok") return "icons/studio-ok.svg";
  if (state === "bad") return "icons/studio-bad.svg";
  if (state === "run") return "icons/studio-run.svg";
  return "icons/studio-wait.svg";
}

export function StudioCheckView(props: { data: StudioWinData; status: StudioStatus; cw: number; ch: number; theme: DesktopTheme }) {
  const check = () => props.status.check;
  const shown = () =>
    check().items.length > 0
      ? check().items
      : ["Sign-in", "Network", "Model", "Voice", "Microphone", "Storage"].map((name) => ({ name, state: "wait" as const, detail: "" }));
  const done = () => check().items.filter((item) => item.state === "ok" || item.state === "bad").length;
  const buttons = () => footButtons(props.cw, props.ch, "run");
  const rowsH = () => shown().length * CHECK_ROW + 2;
  const barW = () => props.cw - 20;
  return (
    <View class="flex-1 flex-col">
      <Heading icon="studioAgent" title="Agent Check" line="Tests what the coding agent needs on this console." theme={props.theme} />
      <Well box={{ x: 10, y: CHECK_TOP, w: props.cw - 20, h: rowsH() }} theme={props.theme}>
        <For each={shown()}>{(item) => (
          <View class="h-[25] flex-row items-center px-[6] gap-[6] shrink-0">
            <Image class="w-[16] h-[16]" src={statusIcon(item.state)} />
            <View class="w-[84] overflow-hidden">
              <UiText theme={props.theme} bold t={item.name} />
            </View>
            <View class="flex-1 flex-row overflow-hidden">
              <UiText theme={props.theme} cls={item.state === "bad" ? "text-[#c00000]" : props.theme.mutedText} t={item.detail} />
            </View>
          </View>
        )}</For>
      </Well>
      <Well box={{ x: 10, y: CHECK_TOP + rowsH() + 8, w: barW(), h: 16 }} theme={props.theme}>
        <View class="flex-row gap-[2] p-[2]">
          <For each={Array.from({ length: Math.floor((Math.min(done(), shown().length) / shown().length) * Math.floor((barW() - 6) / 10)) })}>
            {() => <View class="w-[8] h-[10]" style={{ bgColor: props.theme.sheet.chunk }} />}
          </For>
        </View>
      </Well>
      <View class="absolute" style={{ insetL: 10, insetT: props.ch - 10 - 19 }}>
        <UiText theme={props.theme} t={checkVerdict(check())} />
      </View>
      <Button box={buttons()[0]!} label={check().running ? "Running" : "Run Check"} armed={props.data.armed() === "run"} primary theme={props.theme} />
      <Button box={buttons()[1]!} label="Close" armed={props.data.armed() === "close"} theme={props.theme} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Studio Settings
// ---------------------------------------------------------------------------

const TAB_W = 76;
const TAB_H = 22;
const TAB_TOP = 6;
const PAGE_X = 8;
const PAGE_Y = TAB_TOP + TAB_H - 1;
const TILE_W = 128;
const TILE_H = 92;

function tabBox(index: number): Box {
  return { tag: `tab:${SETTINGS_TABS[index]}`, x: PAGE_X + index * TAB_W, y: TAB_TOP, w: TAB_W, h: TAB_H };
}

function pageControls(tab: SettingsTab, provider: string): Box[] {
  const top = PAGE_Y + 12;
  if (tab === "Agent") {
    return [
      ...PROVIDERS.map((item, i) => ({ tag: `provider:${item.id}`, x: PAGE_X + 14, y: top + 20 + i * 22, w: 118, h: 20 })),
      ...(MODELS[provider] ?? []).map((value, i) => ({ tag: `model:${value}`, x: PAGE_X + 138, y: top + 20 + i * 22, w: 156, h: 20 })),
      ...EFFORTS.map((value, i) => ({ tag: `effort:${value}`, x: PAGE_X + 306, y: top + 20 + i * 22, w: 110, h: 20 })),
      { tag: "proxyOn", x: PAGE_X + 14, y: top + 112, w: 300, h: 20 },
    ];
  }
  if (tab === "Room") {
    return [
      { tag: "drift", x: PAGE_X + 14, y: top + 20, w: 340, h: 20 },
      { tag: "sound", x: PAGE_X + 14, y: top + 44, w: 340, h: 20 },
    ];
  }
  if (tab === "Appearance") {
    return THEMES.map((theme, i) => ({
      tag: `theme:${theme.id}`,
      x: PAGE_X + 14 + i * (TILE_W + 10),
      y: top + 22,
      w: TILE_W,
      h: TILE_H + 24,
    }));
  }
  return [];
}

export function settingsHit(cw: number, ch: number, tab: SettingsTab, provider: string, x: number, y: number): string | null {
  for (let i = 0; i < SETTINGS_TABS.length; i++) if (within(tabBox(i), x, y)) return tabBox(i).tag;
  return (
    pageControls(tab, provider).find((box) => within(box, x, y))?.tag ??
    footButtons(cw, ch, null).find((box) => within(box, x, y))?.tag ??
    null
  );
}

function Radio(props: { on: boolean; label: string; theme: DesktopTheme }) {
  return (
    <View class="h-[20] flex-row items-center gap-[6]">
      <View class="w-[13] h-[13] rounded-full flex-col justify-center items-center" style={{ bgColor: props.theme.sheet.wellLine }}>
        <View class="w-[11] h-[11] rounded-full flex-col justify-center items-center" style={{ bgColor: props.theme.sheet.well }}>
          {props.on ? <View class="w-[5] h-[5] rounded-full" style={{ bgColor: props.theme.sheet.mark }} /> : null}
        </View>
      </View>
      <UiText theme={props.theme} t={props.label} />
    </View>
  );
}

function Check(props: { on: boolean; label: string; theme: DesktopTheme }) {
  return (
    <View class="h-[20] flex-row items-center gap-[6]">
      <View class="w-[13] h-[13] flex-col justify-center items-center" style={{ bgColor: props.theme.sheet.wellLine }}>
        <View class="w-[11] h-[11] flex-col justify-center items-center" style={{ bgColor: props.theme.sheet.well }}>
          {props.on ? <Image class="w-[11] h-[11]" src="icons/studio-tick.svg" /> : null}
        </View>
      </View>
      <UiText theme={props.theme} t={props.label} />
    </View>
  );
}

function At(props: { box: Omit<Box, "tag" | "w" | "h">; children?: unknown }) {
  return (
    <View class="absolute" style={{ insetL: props.box.x, insetT: props.box.y }}>
      {props.children as never}
    </View>
  );
}

/** A window drawn in a theme's colors, as Display Properties previews it. */
function ThemeTile(props: { theme: DesktopTheme; on: boolean; ui: DesktopTheme }) {
  const preview = props.theme.preview;
  return (
    <View class="flex-col items-center gap-[4]">
      <View class="w-[128] h-[92] p-[2]" style={{ bgColor: props.on ? props.ui.sheet.mark : props.ui.sheet.wellLine }}>
        <View class="flex-1 flex-col overflow-hidden" style={{ bgColor: preview.desk }}>
          <View class="flex-1 p-[9]">
            <View class="w-[78] h-[46] flex-col p-[1]" style={{ bgColor: preview.frame }}>
              <View class="h-[10] shrink-0" style={{ bgColor: preview.caption }} />
              <View class="flex-1" style={{ bgColor: preview.body }} />
            </View>
          </View>
          <View class="h-[11] shrink-0 flex-row" style={{ bgColor: preview.bar }}>
            <View class="w-[24]" style={{ bgColor: preview.start }} />
          </View>
        </View>
      </View>
      <Radio on={props.on} label={props.theme.label} theme={props.ui} />
    </View>
  );
}

const QR_MODULE = 5;
const QR_QUIET = 4;

/** Each row's dark runs as rectangles, so a code costs a few hundred nodes. */
export function qrRuns(rows: readonly string[]): { x: number; y: number; w: number }[] {
  const runs: { x: number; y: number; w: number }[] = [];
  rows.forEach((row, y) => {
    let start = -1;
    for (let x = 0; x <= row.length; x++) {
      const dark = row[x] === "1";
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        runs.push({ x: start, y, w: x - start });
        start = -1;
      }
    }
  });
  return runs;
}

function PhonePage(props: { phone: StudioStatus["phone"]; theme: DesktopTheme }) {
  const left = PAGE_X + 14;
  const top = PAGE_Y + 12;
  const rows = () => props.phone.rows;
  const side = () => (rows().length + QR_QUIET * 2) * QR_MODULE;
  return (
    <View class="absolute inset-0">
      {rows().length === 0 ? (
        <View class="absolute flex-col gap-[6]" style={{ insetL: left, insetT: top, width: 400 }}>
          <UiText theme={props.theme} bold t="This console is not on a network" />
          <UiText theme={props.theme} t="Join Wi-Fi from the console's own settings, then come back here." />
        </View>
      ) : (
        <View class="absolute" style={{ insetL: left, insetT: top, width: side(), height: side(), bgColor: "#ffffff" }}>
          {qrRuns(rows()).map((run) => (
            <View
              class="absolute"
              style={{
                insetL: (run.x + QR_QUIET) * QR_MODULE,
                insetT: (run.y + QR_QUIET) * QR_MODULE,
                width: run.w * QR_MODULE,
                height: QR_MODULE,
                bgColor: "#000000",
              }}
            />
          ))}
        </View>
      )}
      {rows().length > 0 ? (
        <View class="absolute flex-col gap-[6]" style={{ insetL: left + side() + 14, insetT: top, width: 210 }}>
          <UiText theme={props.theme} bold t="Set this up on your phone" />
          <UiText theme={props.theme} t="Scan the code from a phone" />
          <UiText theme={props.theme} t="on the same Wi-Fi." />
          <UiText theme={props.theme} t="Add your endpoint, your" />
          <UiText theme={props.theme} t="key, your token or a proxy." />
          <UiText theme={props.theme} cls={props.theme.mutedText} t={props.phone.url} />
          <UiText theme={props.theme} cls={props.theme.mutedText} t="The page works while this" />
          <UiText theme={props.theme} cls={props.theme.mutedText} t="window is open." />
        </View>
      ) : null}
    </View>
  );
}

function InfoLine(props: { label: string; value: string; theme: DesktopTheme }) {
  return (
    <View class="h-[22] flex-row items-center">
      <View class="w-[90]"><UiText theme={props.theme} bold t={props.label} /></View>
      <UiText theme={props.theme} t={props.value} />
    </View>
  );
}

export function StudioSettingsView(props: { data: StudioWinData; status: StudioStatus; cw: number; ch: number; theme: DesktopTheme }) {
  const sheet = () => props.theme.sheet;
  const settings = () => props.status.settings;
  const tab = () => props.data.tab();
  const provider = () => settings().provider;
  const box = (tag: string) => pageControls(tab(), provider()).find((item) => item.tag === tag)!;
  const chosenModel = () => (provider() === "claude-code" ? settings().claudeModel : settings().codexModel);
  const pageW = () => props.cw - PAGE_X * 2;
  const pageH = () => props.ch - PAGE_Y - 42;
  const top = PAGE_Y + 12;
  const close = () => footButtons(props.cw, props.ch, null)[0]!;
  return (
    <View class="flex-1">
      {/* The page first, so the chosen tab paints over its top line. */}
      <View class="absolute" style={{ bgColor: sheet().line, insetL: PAGE_X, insetT: PAGE_Y, width: pageW(), height: pageH() }}>
        <View class="absolute" style={{ bgColor: sheet().face, insetL: 1, insetT: 1, width: pageW() - 2, height: pageH() - 2 }} />
      </View>
      <For each={[...SETTINGS_TABS]}>{(name, index) => {
        const on = () => tab() === name;
        const b = tabBox(index());
        return (
          <View
            class="absolute"
            style={{ bgColor: sheet().line, insetL: b.x + (on() ? 0 : 1), insetT: b.y + (on() ? 0 : 2), width: b.w - (on() ? 0 : 2), height: b.h - (on() ? -1 : 2) }}
          >
            <View
              class="absolute flex-col items-center justify-center"
              style={{ bgColor: on() ? sheet().face : sheet().tabOff, insetL: 1, insetT: 1, width: b.w - (on() ? 2 : 4), height: b.h - (on() ? 0 : 3) }}
            >
              <UiText theme={props.theme} t={name} />
            </View>
            {on() ? <View class="absolute" style={{ bgColor: sheet().accent, insetL: 0, insetT: 0, width: b.w, height: 3 }} /> : null}
          </View>
        );
      }}</For>

      {tab() === "Agent" ? (
        <View class="absolute inset-0">
          <At box={{ x: PAGE_X + 14, y: top }}><UiText theme={props.theme} bold t="Agent" /></At>
          <For each={[...PROVIDERS]}>{(item) => (
            <At box={box(`provider:${item.id}`)}><Radio on={provider() === item.id} label={item.label} theme={props.theme} /></At>
          )}</For>
          <At box={{ x: PAGE_X + 138, y: top }}><UiText theme={props.theme} bold t="Model" /></At>
          {provider() === "custom" ? (
            <View class="absolute flex-col gap-[2]" style={{ insetL: PAGE_X + 138, insetT: top + 22, width: 160 }}>
              <UiText theme={props.theme} t={settings().customModel || "Not set yet"} />
              <UiText theme={props.theme} cls={props.theme.mutedText} t="Set it on the Phone tab." />
            </View>
          ) : (
            <For each={[...(MODELS[provider()] ?? [])]}>{(value) => (
              <At box={box(`model:${value}`)}><Radio on={chosenModel() === value} label={value} theme={props.theme} /></At>
            )}</For>
          )}
          <At box={{ x: PAGE_X + 306, y: top }}><UiText theme={props.theme} bold t="Effort" /></At>
          <For each={[...EFFORTS]}>{(value) => (
            <At box={box(`effort:${value}`)}><Radio on={settings().effort === value} label={value[0]!.toUpperCase() + value.slice(1)} theme={props.theme} /></At>
          )}</For>
          <At box={{ x: PAGE_X + 14, y: top + 92 }}><UiText theme={props.theme} bold t="Network" /></At>
          <At box={box("proxyOn")}><Check on={settings().proxyOn} label="Reach the model through a proxy" theme={props.theme} /></At>
          <At box={{ x: PAGE_X + 33, y: top + 134 }}><UiText theme={props.theme} cls={props.theme.mutedText} t={settings().proxy || "No proxy saved. Add one on the Phone tab."} /></At>
        </View>
      ) : null}

      {tab() === "Phone" ? (
        <View class="absolute inset-0">
          <PhonePage phone={props.status.phone} theme={props.theme} />
        </View>
      ) : null}

      {tab() === "Room" ? (
        <View class="absolute inset-0">
          <At box={{ x: PAGE_X + 14, y: top }}><UiText theme={props.theme} bold t="Room" /></At>
          <At box={box("drift")}><Check on={settings().drift} label="Slow camera movement while idle" theme={props.theme} /></At>
          <At box={box("sound")}><Check on={settings().sound} label="Sound in the menus and the room" theme={props.theme} /></At>
        </View>
      ) : null}

      {tab() === "Appearance" ? (
        <View class="absolute inset-0">
          <At box={{ x: PAGE_X + 14, y: top }}><UiText theme={props.theme} bold t="Desktop theme" /></At>
          <For each={[...THEMES]}>{(item) => (
            <At box={box(`theme:${item.id}`)}><ThemeTile theme={item} on={settings().theme === item.id} ui={props.theme} /></At>
          )}</For>
        </View>
      ) : null}

      {tab() === "System" ? (
        <View class="absolute flex-col" style={{ insetL: PAGE_X + 14, insetT: top }}>
          <InfoLine label="Studio" value={props.status.system.version} theme={props.theme} />
          <InfoLine label="Games" value={String(props.status.games)} theme={props.theme} />
          <InfoLine label="Memory" value={props.status.system.memory} theme={props.theme} />
          <InfoLine label="Storage" value={props.status.system.storage} theme={props.theme} />
          <InfoLine label="Battery" value={props.status.system.battery} theme={props.theme} />
        </View>
      ) : null}

      <Button box={close()} label="Close" armed={props.data.armed() === "close"} primary theme={props.theme} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// My Games
// ---------------------------------------------------------------------------

const GAME_ROW = 18;
const GAME_TOP = 52;
const GAME_HEAD = 18;
const SCROLL_W = 16;

function gamesWell(cw: number, ch: number) {
  return { x: 10, y: GAME_TOP, w: cw - 20, h: ch - GAME_TOP - 44 };
}

function gamesVisible(cw: number, ch: number): number {
  return Math.max(1, Math.floor((gamesWell(cw, ch).h - 2 - GAME_HEAD) / GAME_ROW));
}

export function clampGamesScroll(value: number, count: number, cw: number, ch: number): number {
  return Math.max(0, Math.min(Math.max(0, count - gamesVisible(cw, ch)) * GAME_ROW, value));
}

function thumb(scroll: number, count: number, cw: number, ch: number) {
  const trackH = gamesWell(cw, ch).h - 2 - GAME_HEAD;
  const visible = gamesVisible(cw, ch);
  if (count <= visible) return { y: 0, h: trackH, trackH };
  const h = Math.max(18, Math.round((trackH * visible) / count));
  const span = (count - visible) * GAME_ROW;
  return { y: Math.round(((trackH - h) * scroll) / span), h, trackH };
}

export function gamesHit(cw: number, ch: number, scroll: number, count: number, x: number, y: number): string | null {
  const button = footButtons(cw, ch, "open").find((box) => within(box, x, y));
  if (button) return button.tag;
  const well = gamesWell(cw, ch);
  const inner = { x: well.x + 1, y: well.y + 1 + GAME_HEAD, w: well.w - 2, h: well.h - 2 - GAME_HEAD };
  if (!within({ tag: "", ...inner }, x, y)) return null;
  if (x >= inner.x + inner.w - SCROLL_W) {
    const bar = thumb(scroll, count, cw, ch);
    const at = y - inner.y;
    if (at < bar.y) return "page:up";
    if (at >= bar.y + bar.h) return "page:down";
    return null;
  }
  const row = Math.floor((y - inner.y) / GAME_ROW) + Math.floor(scroll / GAME_ROW);
  return row < count ? `row:${row}` : null;
}

export const gamesPage = (cw: number, ch: number) => gamesVisible(cw, ch) * GAME_ROW;

export function StudioGamesView(props: { data: StudioWinData; games: StudioGame[]; cw: number; ch: number; theme: DesktopTheme }) {
  const well = () => gamesWell(props.cw, props.ch);
  const first = () => Math.floor(props.data.scroll() / GAME_ROW);
  const rows = () => {
    const start = first();
    return props.games.slice(start, start + gamesVisible(props.cw, props.ch)).map((game, i) => ({ game, index: start + i }));
  };
  const bar = () => thumb(props.data.scroll(), props.games.length, props.cw, props.ch);
  const buttons = () => footButtons(props.cw, props.ch, "open");
  return (
    <View class="flex-1 flex-col">
      <Heading icon="studioGames" title="My Games" line="Open a game to keep working on it in Make." theme={props.theme} />
      <Well box={well()} theme={props.theme}>
        <View class="h-[18] flex-row shrink-0">
          <View class={props.theme.folderHeader("name")}><UiText theme={props.theme} t="Name" /></View>
        </View>
        <View class="flex-1 flex-row overflow-hidden">
          <View class="flex-1 flex-col overflow-hidden">
            <For each={rows()}>{(row) => (
              <View class={props.theme.folderRow(props.data.selected() === row.index, row.index % 2 === 1)}>
                <Image class="w-[16] h-[16] mr-[4]" src={props.theme.icon("studioGames", 16)} />
                <View class="flex-1 flex-row overflow-hidden">
                  <UiText
                    theme={props.theme}
                    cls={props.data.selected() === row.index ? props.theme.selectionText : "text-[#000000]"}
                    t={row.game.title}
                  />
                </View>
              </View>
            )}</For>
            {props.games.length === 0 ? (
              <View class="flex-1 flex-col justify-center items-center">
                <UiText theme={props.theme} cls={props.theme.mutedText} t="No games yet. Make one first." />
              </View>
            ) : null}
          </View>
          <View class="w-[16] h-full shrink-0" style={{ bgColor: props.theme.sheet.tabOff }}>
            <View class="absolute" style={{ bgColor: props.theme.sheet.line, insetL: 0, insetT: bar().y, width: SCROLL_W, height: bar().h }}>
              <View class="absolute" style={{ bgColor: props.theme.sheet.face, insetL: 1, insetT: 1, width: SCROLL_W - 2, height: bar().h - 2 }} />
            </View>
          </View>
        </View>
      </Well>
      <View class="absolute" style={{ insetL: 10, insetT: props.ch - 10 - 19 }}>
        <UiText theme={props.theme} t={`${props.games.length} game(s)`} />
      </View>
      <Button box={buttons()[0]!} label="Open" armed={props.data.armed() === "open"} primary theme={props.theme} />
      <Button box={buttons()[1]!} label="Close" armed={props.data.armed() === "close"} theme={props.theme} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// The pointer. A host with a real mouse draws its own; this one has none.
// ---------------------------------------------------------------------------

const CURSORS: Record<CursorKind, { src: string; x: number; y: number }> = {
  default: { src: "icons/cursor-arrow.svg", x: 1, y: 1 },
  pointer: { src: "icons/cursor-hand.svg", x: 8, y: 1 },
  text: { src: "icons/cursor-text.svg", x: 12, y: 12 },
  move: { src: "icons/cursor-move.svg", x: 12, y: 12 },
  grabbing: { src: "icons/cursor-move.svg", x: 12, y: 12 },
  ew: { src: "icons/cursor-ew.svg", x: 12, y: 12 },
  ns: { src: "icons/cursor-ns.svg", x: 12, y: 12 },
  nwse: { src: "icons/cursor-nwse.svg", x: 12, y: 12 },
  nesw: { src: "icons/cursor-nesw.svg", x: 12, y: 12 },
};

export function StudioPointer(props: { x: number; y: number; kind: CursorKind }) {
  const cursor = () => CURSORS[props.kind];
  return (
    <View class="absolute w-[32] h-[32]" style={{ zIndex: 30000, insetL: 0, insetT: 0, translateX: props.x - cursor().x, translateY: props.y - cursor().y }}>
      <Image class="w-[32] h-[32]" src={cursor().src} />
    </View>
  );
}
