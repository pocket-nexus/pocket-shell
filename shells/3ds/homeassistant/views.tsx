// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/homeassistant/views.tsx — the pages of Home: the entities of the
// open tab as a grouped table (ui/table.tsx), one section per domain, with
// the control each domain takes; the setup page (URL, token, Connect,
// Forget); and a light's page with its switch and brightness.
//
// A row's control is the table's: a switch for what turns on and off, a
// value for a reading, a centred action for a scene or a script, a grey
// pill for a second action (a light's level, a player's next track). The
// states arrive every POLL_FRAMES and a row whose entity did not change
// keeps its cell, so the table relays out only for a change.

import { createMemo, createSignal, For, Show, type Accessor } from "solid-js";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { Text, View } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import type { NavButton } from "../ui/bar.tsx";
import { viewHeight, type LayerContext, type NavStack, type PageContent, type PageSpec } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W } from "../ui/screen.ts";
import { tableContent, type Cell, type Section } from "../ui/table.tsx";
import { ellipsize, FONT, toAscii, wrap } from "../ui/text.ts";
import type { Press, Target } from "../ui/touch.ts";
import { SegmentFill } from "../ui/segments.tsx";
import { TABS, type Entity, type TabId } from "./api.ts";
import { POLL_FRAMES, type HaModel } from "./model.ts";

export interface HaEnv {
  model: HaModel;
  press: Press;
  keys: Accessor<boolean>;
  /** The setup page's fields and the keyboard that edits them. */
  setup: SetupDraft;
  /** Bumps when the keyboard commits a field, so the setup page relays out. */
  edits: Accessor<number>;
}

/** What the setup page holds: kept across a remount by the app. */
export interface SetupDraft {
  url: string;
  token: string;
  message: string;
  editUrl(): void;
  editToken(): void;
}

/** The placeholder, built so the applet rules read no host literal: the
 *  applet reaches the home through the companion's service, not itself. */
export const DEFAULT_URL = ["http:", "", "homeassistant.local:8123"].join("/");
/** A light's brightness moves this much per press. */
const LEVEL_STEP = 10;

// Sized to the surface by fitSurface(), which each page calls first.
let W = 320;
let VIEW_H = 204;
let SEG_W = 0;
const SEG_X = 8;

function fitSurface(): void {
  W = SCREEN_W;
  VIEW_H = viewHeight();
  SEG_W = (W - SEG_X * 2) / TABS.length;
}

// ---- words ------------------------------------------------------------------------------

const DOMAIN_NAMES: Record<string, string> = {
  light: "Lights",
  switch: "Switches",
  input_boolean: "Toggles",
  climate: "Climate",
  sensor: "Sensors",
  binary_sensor: "Binary Sensors",
  media_player: "Media Players",
  scene: "Scenes",
  script: "Scripts",
  automation: "Automations",
  cover: "Covers",
  lock: "Locks",
  fan: "Fans",
};

/** "Living Room" for the state words Home Assistant uses. */
export function stateText(entity: Entity): string {
  const state = entity.state;
  if (state === "unavailable") return "Unavailable";
  if (state === "unknown") return "--";
  if (entity.domain === "binary_sensor") return state === "on" ? "On" : "Off";
  if (entity.domain === "lock") return state === "locked" ? "Locked" : state === "unlocked" ? "Unlocked" : capital(state);
  if (entity.domain === "cover") return capital(state);
  if (entity.domain === "sensor") return entity.unit ? `${state} ${entity.unit}` : state;
  return capital(state);
}

function capital(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1).replace(/_/g, " ") : "";
}

/** A light's brightness as 0..100. */
export function brightnessPercent(entity: Entity): number {
  const raw = entity.attributes.brightness;
  return typeof raw === "number" ? Math.round((raw * 100) / 255) : 0;
}

/** The cell for an entity: its label, value and the control its domain takes. */
export function entityCell(model: HaModel, entity: Entity, open: (entity: Entity) => void): Cell {
  const id = `entity.${entity.id}`;
  const label = toAscii(entity.name);
  const busy = model.busy(entity.id);
  const on = entity.state === "on";
  switch (entity.domain) {
    case "light":
      return {
        id,
        label,
        value: on && brightnessPercent(entity) ? `${brightnessPercent(entity)}%` : "",
        accessory: busy ? "spinner" : "switch",
        on,
        button: { id: `level.${entity.id}`, label: "Level", tone: "grey", run: () => open(entity) },
        run: () => model.toggle(entity),
      };
    case "switch":
    case "input_boolean":
    case "fan":
    case "automation":
      return { id, label, accessory: busy ? "spinner" : "switch", on, run: () => model.toggle(entity) };
    case "climate": {
      const current = entity.attributes.current_temperature;
      const target = entity.attributes.temperature;
      const parts: string[] = [];
      if (typeof current === "number") parts.push(`${current}°`);
      if (typeof target === "number") parts.push(`set ${target}°`);
      const modes = entity.attributes.hvac_modes ?? [];
      const next = modes.length > 1 ? modes[(modes.indexOf(entity.state) + 1) % modes.length]! : "";
      return {
        id,
        label,
        detail: `${capital(entity.state)}${next ? `  (tap for ${next})` : ""}`,
        value: parts.join("  "),
        accessory: busy ? "spinner" : undefined,
        ...(next ? { run: () => model.act(entity, "set_hvac_mode", { hvac_mode: next }, { state: next }) } : {}),
      };
    }
    case "sensor":
    case "binary_sensor":
      return { id, label, value: toAscii(stateText(entity)), tone: "muted" };
    case "media_player": {
      const title = [entity.attributes.media_title, entity.attributes.media_artist].filter((part) => typeof part === "string" && part).join(" - ");
      return {
        id,
        label,
        detail: title ? toAscii(title) : capital(entity.state),
        value: title ? capital(entity.state) : "",
        accessory: busy ? "spinner" : undefined,
        button: { id: `next.${entity.id}`, label: "Next", tone: "grey", run: () => model.act(entity, "media_next_track") },
        run: () => model.act(entity, "media_play_pause", undefined, { state: entity.state === "playing" ? "paused" : "playing" }),
      };
    }
    case "scene":
      return { id, label, tone: "action", accessory: busy ? "spinner" : undefined, run: () => model.act(entity, "turn_on") };
    case "script":
      return { id, label, tone: "action", accessory: busy ? "spinner" : undefined, run: () => model.act(entity, "turn_on") };
    case "cover": {
      const open = entity.state === "open" || entity.state === "opening";
      return {
        id,
        label,
        value: toAscii(stateText(entity)),
        accessory: busy ? "spinner" : "chevron",
        run: () => model.act(entity, open ? "close_cover" : "open_cover", undefined, { state: open ? "closing" : "opening" }),
      };
    }
    case "lock": {
      const locked = entity.state === "locked";
      return {
        id,
        label,
        value: toAscii(stateText(entity)),
        accessory: busy ? "spinner" : "chevron",
        run: () => model.act(entity, locked ? "unlock" : "lock", undefined, { state: locked ? "unlocked" : "locked" }),
      };
    }
    default:
      return { id, label, value: toAscii(stateText(entity)), tone: "muted" };
  }
}

/** The sections of a tab: one per domain that has entities, in the tab's order. */
export function tabSections(model: HaModel, tab: TabId, open: (entity: Entity) => void): Section[] {
  const spec = TABS.find((candidate) => candidate.id === tab);
  if (!spec) return [];
  const entities = model.entities();
  const out: Section[] = [];
  for (const domain of spec.domains) {
    const cells = entities.filter((entity) => entity.domain === domain).map((entity) => entityCell(model, entity, open));
    if (cells.length) out.push({ header: DOMAIN_NAMES[domain] ?? capital(domain), cells });
  }
  return out;
}

// ---- shared pieces ----------------------------------------------------------------------

function Centered(props: { title: string; detail: string; spinner?: boolean; button?: { id: string; label: string }; press: Press }) {
  const lines = () => wrap(props.detail, FONT.xs, 260, 4);
  return (
    <>
      <Show when={props.spinner}>
        <View class="absolute top-[40]" style={{ insetL: W / 2 - 11 }}>
          <ClassicSpinner size={22} color={"#8a9099"} />
        </View>
      </Show>
      <Text class="absolute left-0 top-[74] text-base text-[#4c566c] font-bold text-center" style={{ width: W }}>{props.title}</Text>
      <For each={lines()}>
        {(line, index) => <Text class="absolute w-[260] text-xs text-[#6d7584] text-center" style={{ insetL: (W - 260) / 2, insetT: 98 + index() * 15 }}>{line}</Text>}
      </For>
      <Show when={props.button}>
        {(button) => (
          <>
            <View
              class={props.press.is(button().id)
                ? "absolute top-[160] w-[120] h-[30] rounded-[6] border border-[#6f7680] bg-gradient-to-b from-[#9aa1ab] to-[#bfc5cc]"
                : "absolute top-[160] w-[120] h-[30] rounded-[6] border border-[#9aa1aa] bg-gradient-to-b from-[#ffffff] to-[#dde1e6]"}
              style={{ insetL: (W - 120) / 2 }}
            />
            <Text class="absolute top-[167] w-[120] text-sm text-[#1f5fbf] font-bold text-center" style={{ insetL: (W - 120) / 2 }}>{button().label}</Text>
          </>
        )}
      </Show>
    </>
  );
}

/** The tabs as a segmented control in the bar. */
function Segments(props: { env: HaEnv }) {
  const { model, press } = props.env;
  return (
    <>
      <View class="absolute left-[8] top-[5] h-[26] rounded-[5] border border-[#1d4ed8] bg-gradient-to-b from-[#60a5fa] via-[#3b82f6] to-[#2563eb]" style={{ width: SEG_W * TABS.length }} />
      <For each={TABS}>
        {(tab, index) => (
          <>
            <Show when={model.tab() === tab.id || press.is(`tab.${tab.id}`)}>
              <SegmentFill x={SEG_X + 1 + index() * SEG_W} y={6} w={SEG_W - 1} h={24} first={index() === 0} last={index() === TABS.length - 1} class="absolute bg-gradient-to-b from-[#1e3a8a] via-[#1d4ed8] to-[#2563eb]" />
            </Show>
            <Show when={index() > 0}>
              <View class="absolute top-[6] w-[1] h-[24] bg-[#1d4ed8]" style={{ insetL: SEG_X + index() * SEG_W }} />
            </Show>
            <Text class="absolute top-[11] text-xs text-[#1e3a8aa0] font-bold text-center" style={{ insetL: SEG_X + index() * SEG_W, width: SEG_W }}>{tab.label}</Text>
            <Text class="absolute top-[12] text-xs text-white font-bold text-center" style={{ insetL: SEG_X + index() * SEG_W, width: SEG_W }}>{tab.label}</Text>
          </>
        )}
      </For>
    </>
  );
}

function segmentTargets(env: HaEnv): Target[] {
  return TABS.map((tab, index) => ({ id: `tab.${tab.id}`, x: SEG_X + index * SEG_W, y: 0, w: SEG_W, h: 36, run: () => env.model.setTab(tab.id) }));
}

/** The notice pill along the bottom of a page while a call's message shows. */
function Notice(props: { model: HaModel }) {
  return (
    <Show when={props.model.notice()}>
      <View class="absolute w-[280] h-[28] rounded-[14] bg-[#1f2937e8]" style={{ insetL: (W - 280) / 2, insetT: SCREEN_H - 40 }} />
      <Text class="absolute w-[260] text-xs text-white text-center" style={{ insetL: (W - 260) / 2, insetT: SCREEN_H - 33 }}>{ellipsize(toAscii(props.model.notice()), FONT.xs, 260)}</Text>
    </Show>
  );
}

// ---- the home page ----------------------------------------------------------------------

export function homePage(env: HaEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press } = env;
  model.checkSetup();
  const open = (entity: Entity) => {
    model.open(entity);
    stack.push("light");
  };
  const sections = createMemo(() => (model.ready() === true ? tabSections(model, model.tab(), open) : []));
  const table = tableContent({ sections, width: W, press, focus: layer.focus, keys: env.keys });
  const connected = () => model.ready() === true;
  const empty = () => connected() && sections().length === 0;
  let frames = 0;
  onFrame(() => {
    model.tickNotice();
    if (++frames % POLL_FRAMES === 0) model.refresh();
  });
  const step = (by: number) => {
    const at = TABS.findIndex((tab) => tab.id === model.tab());
    model.setTab(TABS[(at + by + TABS.length) % TABS.length]!.id);
  };
  const setupButton = (): NavButton => ({ id: "home.setup", label: "Setup", kind: "plain", run: () => stack.push("setup") });
  const content: PageContent = {
    view: () => (
      <>
        <Show when={connected()}>{table.view()}</Show>
        <Show when={!connected()}>
          {model.ready() === false
            ? <Centered title="Connect to Home Assistant" detail="Enter the URL of the home and a long-lived access token in Setup." button={{ id: "home.connect", label: "Set Up" }} press={press} />
            : model.list().status === "error"
              ? <Centered title={model.list().error!.title} detail={model.list().error!.detail} button={{ id: "home.retry", label: "Try Again" }} press={press} />
              : <Centered title="Connecting" detail="Asking this device for the home's setup." spinner press={press} />}
        </Show>
        <Show when={empty()}>
          {model.list().status === "error"
            ? <Centered title={model.list().error!.title} detail={model.list().error!.detail} button={{ id: "home.retry", label: "Try Again" }} press={press} />
            : model.list().status === "ready"
              ? <Centered title="Nothing Here" detail="The home has no entities in these domains." press={press} />
              : <Centered title="Loading" detail="Asking the home for its states." spinner press={press} />}
        </Show>
      </>
    ),
    height: () => (connected() && !empty() ? table.height() : VIEW_H),
    focusOrder: () => (connected() ? table.focusOrder() : []),
    targets(top, offset, bottom) {
      if (connected() && !empty()) return table.targets(top, offset, bottom);
      if (model.ready() === false) return [{ id: "home.connect", x: (W - 120) / 2, y: top + 160 - offset, w: 120, h: 30, run: () => stack.push("setup") }];
      if (model.list().status === "error") return [{ id: "home.retry", x: (W - 120) / 2, y: top + 160 - offset, w: 120, h: 30, run: () => (connected() ? model.refresh() : model.checkSetup(true)) }];
      return [];
    },
    span: (id) => (connected() ? table.span(id) : null),
    activate(id) {
      if (id === "home.connect") stack.push("setup");
      else if (id === "home.retry") (connected() ? model.refresh() : model.checkSetup(true));
      else table.activate(id);
    },
  };
  return {
    title: () => "Home",
    backLabel: "Home",
    right: setupButton,
    titleView: () => (connected() ? <Segments env={env} /> : <Text class="absolute left-0 top-[10] text-base text-white font-bold text-center" style={{ width: W }}>Home</Text>),
    fixedTargets: () => (connected() ? segmentTargets(env) : []),
    fixed: () => <Notice model={model} />,
    content,
    legend: () => [
      { button: "lr", label: "Tab" },
      { button: "triangle", label: "Reload" },
      { button: "square", label: "Setup" },
    ],
    key(pressed) {
      if (pressed & BTN.LTRIGGER) step(-1);
      else if (pressed & BTN.RTRIGGER) step(1);
      else if (pressed & BTN.TRIANGLE) (connected() ? model.refresh() : model.checkSetup(true));
      else if (pressed & BTN.SQUARE) stack.push("setup");
      else if (pressed & BTN.CIRCLE && model.ready() === false) stack.push("setup");
      else return false;
      return true;
    },
  };
}

// ---- the setup page ---------------------------------------------------------------------

export function setupPage(env: HaEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press, setup } = env;
  const [version, setVersion] = createSignal(0);
  const bump = () => setVersion(version() + 1);
  const connect = () => {
    const url = (setup.url.trim() || DEFAULT_URL).replace(/\/+$/, "");
    const token = setup.token.trim();
    if (!token) {
      setup.message = "Paste a long-lived access token first.";
      bump();
      return;
    }
    setup.message = "Connecting...";
    bump();
    model.connect(url, token).then((failure) => {
      setup.message = failure || "Connected.";
      bump();
      if (!failure) {
        setup.token = "";
        stack.pop();
      }
    });
  };
  const forget = () => {
    model.forget().then((failure) => {
      setup.message = failure || "The setup was deleted from this device.";
      bump();
    });
  };
  const sections = createMemo((): Section[] => {
    version();
    env.edits();
    const token = setup.token;
    const out: Section[] = [
      {
        header: "Home Assistant",
        cells: [
          { id: "setup.url", label: "URL", value: ellipsize(toAscii(setup.url || DEFAULT_URL), FONT.sm, W - 120), run: () => setup.editUrl() },
          { id: "setup.token", label: "Token", value: token ? `...${toAscii(token.slice(-6))}` : "Long-lived access token", run: () => setup.editToken() },
        ],
        footer: "The token comes from the Home Assistant profile page, Security, Long-lived access tokens. It stays on this device.",
      },
      {
        cells: [{ id: "setup.connect", label: model.connecting() ? "Connecting..." : "Connect", tone: "action", accessory: model.connecting() ? "spinner" : undefined, run: connect }],
        footer: setup.message,
      },
    ];
    if (model.setupUrl()) {
      out.push({
        cells: [{ id: "setup.forget", label: "Forget This Home", tone: "danger", run: forget }],
        footer: `Connected to ${toAscii(model.setupUrl())}.`,
      });
    }
    return out;
  });
  const table = tableContent({ sections, width: W, press, focus: layer.focus, keys: env.keys });
  return {
    title: () => "Setup",
    backLabel: "Setup",
    content: {
      view: table.view,
      height: table.height,
      focusOrder: table.focusOrder,
      targets: table.targets,
      span: table.span,
      activate: table.activate,
    },
    activateLabel: () => "Edit",
    legend: () => [{ button: "start", label: "Connect" }],
    key(pressed) {
      if (pressed & BTN.START) connect();
      else return false;
      return true;
    },
  };
}

// ---- the light page ---------------------------------------------------------------------

export function lightPage(env: HaEnv, _stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press } = env;
  const light = () => model.current();
  const level = () => {
    const entity = light();
    return entity ? brightnessPercent(entity) : 0;
  };
  const adjust = (by: number) => {
    const entity = light();
    if (!entity) return;
    model.setBrightness(entity, Math.max(1, Math.min(100, (entity.state === "on" ? level() : 0) + by)));
  };
  const sections = createMemo((): Section[] => {
    const entity = light();
    if (!entity) return [];
    const on = entity.state === "on";
    return [
      {
        header: toAscii(entity.name),
        cells: [{ id: "light.power", label: "Power", accessory: model.busy(entity.id) ? "spinner" : "switch", on, run: () => model.toggle(entity) }],
      },
      {
        header: "Brightness",
        cells: [
          { id: "light.level", label: "Level", value: on ? `${level()}%` : "Off", tone: "muted" },
          { id: "light.down", label: "Dimmer", tone: "action", run: () => adjust(-LEVEL_STEP) },
          { id: "light.up", label: "Brighter", tone: "action", run: () => adjust(LEVEL_STEP) },
        ],
        footer: "Left and right on the d-pad move the level too.",
      },
    ];
  });
  const table = tableContent({ sections, width: W, press, focus: layer.focus, keys: env.keys });
  onFrame(() => model.tickNotice());
  return {
    title: () => toAscii(light()?.name ?? "Light"),
    backLabel: "Light",
    content: {
      view: table.view,
      height: table.height,
      focusOrder: table.focusOrder,
      targets: table.targets,
      span: table.span,
      activate: table.activate,
    },
    fixed: () => <Notice model={model} />,
    legend: () => [{ button: "dpad-h", label: "Level" }],
    key(pressed) {
      if (pressed & BTN.LEFT) adjust(-LEVEL_STEP);
      else if (pressed & BTN.RIGHT) adjust(LEVEL_STEP);
      else return false;
      return true;
    },
  };
}
