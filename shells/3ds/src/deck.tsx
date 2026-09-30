// SPDX-License-Identifier: GPL-3.0-or-later
// src/deck.tsx — the touch screen. Omarchy's SUPER key is a
// key; here it is a surface. The deck always shows the workspace strip, a
// live minimap of the top screen, and the dock, and it re-labels itself the
// moment a shoulder goes down: the minimap gives way to the chord map for
// the held layer, which is Omarchy's SUPER+K menu appearing exactly when the
// modifier that needs it is pressed. Every row of that map is also a tap
// target, and the L/R pills latch a layer for one action, so a stylus can
// complete any chord on its own.
//
// The dock is Omarchy's bar moved under the thumb: the menu first, then the
// apps, then the shell's switches, all drawn as 16 px monochrome glyphs
// (src/gen-icons.ts). Nothing else frames the minimap, so it is drawn at 0.7
// of the top screen, large enough to hit a window with a stylus.
//
// Minimap touch: tap focuses, hold arms the close bar (release on it to
// close — a resistive panel and a coin-flip × are how shells get killed),
// drag a window onto another to swap or onto a workspace tab to move it,
// drag the gap between two windows to resize the split, and in the
// scrolling layout drag the background to pan the strip.

import { createMemo, createSignal, For, Index, Show } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";
import { createGesture } from "@pocketjs/framework/gesture";
import { onFrame } from "@pocketjs/framework/lifecycle";
import {
  BUTTON_GLYPH,
  chordFor,
  dpadLabel,
  FACE_ORDER,
  labelFor,
  LAYER_HINT,
  LAYER_TITLE,
  padLabel,
  type ActionId,
  type Layer,
} from "./chords.ts";
import type { IconName, IconTone } from "./gen-icons.ts";
import { icon } from "./icons.ts";
import { Keyboard, keyboardHit, createKeyPress } from "./keyboard.tsx";
import { isTextApp, MENU, samePlacement, type AppId, type MenuItem, type ShellStore } from "./store.ts";
import { BTN } from "@pocketjs/framework/input";
import { BAR_H, WORKSPACES, type LayoutKind, type Rect } from "./wm.ts";

const STRIP_H = 22;
const PILL_W = 26;
const TABS_X = 30;
const TAB_W = 40;
const LAYOUT_X = 238;
const LAYOUT_W = 48;
const R_PILL_X = 294;

const BODY_TOP = STRIP_H;
const BODY_BOTTOM = 204;

const S = 0.7;
const MAP_X = 20;
const MAP_Y = 28;
const MAP_W = 400 * S;
const MAP_H = 240 * S;
const MAP_RECT: Rect = { x: MAP_X, y: MAP_Y, w: MAP_W, h: MAP_H };
const HINT_Y = 184;
const CLOSE_BAR_H = 40;
const CLOSE_BAR_Y = BODY_BOTTOM - CLOSE_BAR_H;
const CLOSE_HOLD_SECONDS = 0.4;

const DOCK_Y = BODY_BOTTOM;
const DOCK_CELL = 36;
type DockAct = "menu" | AppId | "kbd" | "keys" | "wall" | "bar";
interface DockItem {
  act: DockAct;
  icon: IconName;
  x: number;
  label: string;
}
/** The menu, the three apps, then the switches, flush right. */
const DOCK: readonly DockItem[] = [
  { act: "menu", icon: "menu", x: 2, label: "menu" },
  { act: "term", icon: "term", x: 44, label: "terminal" },
  { act: "notes", icon: "notes", x: 80, label: "notes" },
  { act: "top", icon: "top", x: 116, label: "top" },
  { act: "kbd", icon: "kbd", x: 174, label: "keyboard" },
  { act: "keys", icon: "keys", x: 210, label: "keys" },
  { act: "wall", icon: "wall", x: 246, label: "wallpaper" },
  { act: "bar", icon: "bar", x: 282, label: "bar" },
];
const dockAt = (x: number): DockItem | null => DOCK.find((d) => x >= d.x && x < d.x + DOCK_CELL) ?? null;
const isApp = (act: DockAct): act is AppId => act === "term" || act === "notes" || act === "top";

/** Each menu row's glyph, keyed by its app or action. */
const MENU_ICON: Record<string, IconName> = {
  term: "term",
  notes: "notes",
  top: "top",
  keys: "keys",
  wallpaper: "wall",
  bar: "bar",
  about: "menu",
};
const menuIcon = (item: MenuItem): IconName => MENU_ICON[item.kind === "app" ? item.app : item.action];
const MENU_X = 36;
const MENU_W = 248;
const MENU_Y = BODY_TOP + 6;
const MENU_ROWS_Y = MENU_Y + 24;
const MENU_ROW_H = 20;

const CHORD_TITLE_Y = BODY_TOP + 6;
const CHORD_ROWS_Y = BODY_TOP + 24;
const CHORD_ROW_H = 24;
const CHORD_COL_SPLIT = 160;
const CHORD_LAYERS: readonly Layer[] = ["super", "shift", "ws"];

const within = (x: number, y: number, r: Rect): boolean =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const toStage = (x: number, y: number) => ({ x: (x - MAP_X) / S, y: (y - MAP_Y) / S });

type BodyMode = "launcher" | "chords" | "keyboard" | "map";

/** A touch target's transient pressed look.
 *
 *  A physical button reports its own press; a painted one has to say so, and
 *  on a resistive panel with no hover there is nothing else to tell you the
 *  panel heard you. Every target here therefore darkens or inverts while the
 *  finger is on it, and holds that for a few frames after release so a quick
 *  tap is still visible. Ids are `kind:key` strings so one signal covers the
 *  strip, the dock, the chord rows and the menu. */
function createPressTracker(): {
  is: (id: string) => boolean;
  down: (id: string | null) => void;
  release: () => void;
} {
  const [pressed, setPressed] = createSignal<string | null>(null);
  let linger = 0;
  onFrame(() => {
    if (linger > 0 && --linger === 0) setPressed(null);
  });
  return {
    is: (id) => pressed() === id,
    down: (id) => {
      linger = 0;
      setPressed(id);
    },
    release: () => {
      if (pressed() !== null) linger = PRESS_LINGER_FRAMES;
    },
  };
}

const PRESS_LINGER_FRAMES = 5;

/** A shoulder keycap on the strip. Its held look is a second layer faded in
 *  by opacity, a paint-only prop: a shoulder press restyles nothing, so it
 *  never relayouts the deck. */
function Pill(props: { x: number; label: string; held: boolean; pressed: boolean }) {
  return (
    <View class="absolute top-[3] w-[24] h-[16]" style={{ insetL: props.x }}>
      <View
        class={props.pressed ? "absolute inset-0 bg-[#292e42] border border-[#414868] items-center justify-center" : "absolute inset-0 bg-[#1a1b26] border border-[#292e42] items-center justify-center"}
      >
        <Text class="text-xs text-[#565f89] font-bold">{props.label}</Text>
      </View>
      <View class="absolute inset-0 bg-[#7aa2f7] items-center justify-center" style={{ opacity: props.held ? 1 : 0 }}>
        <Text class="text-xs text-[#1a1b26] font-bold">{props.label}</Text>
      </View>
    </View>
  );
}

export function Deck(props: { store: ShellStore }) {
  const store = props.store;
  const keyPress = createKeyPress();
  const press = createPressTracker();

  const bodyMode = (): BodyMode => {
    if (store.launcherOpen()) return "launcher";
    if (store.layer() !== "plain") return "chords";
    if (store.kbVisible()) return "keyboard";
    return "map";
  };
  // While the chord map, menu or keyboard covers it, the minimap keeps what
  // it last showed instead of relaying out under them on every change.
  const frozen = <T,>(read: () => T) => createMemo<T | undefined>((last) => (bodyMode() === "map" || last === undefined ? read() : last)) as () => T;
  const mapOrder = frozen(() => store.order());
  const mapPlacements = frozen(() => store.placements());
  const mapFocus = frozen(() => store.focusedId());
  const lHeld = () => store.layer() === "super" || store.layer() === "ws";
  const rHeld = () => store.layer() === "shift" || store.layer() === "ws";

  // ---- touch ---------------------------------------------------------------

  let pending: { id: number } | null = null;
  let splitHandle: ReturnType<typeof store.wm.splitAt> = null;
  let columnHandle: ReturnType<typeof store.wm.columnEdgeAt> = null;
  let panning = false;

  const menuRowAt = (x: number, y: number): number | null => {
    if (x < MENU_X || x >= MENU_X + MENU_W) return null;
    const row = Math.floor((y - MENU_ROWS_Y) / MENU_ROW_H);
    return row >= 0 && row < MENU.length ? row : null;
  };

  /** Which painted target a point is on, for the pressed look. */
  const targetAt = (x: number, y: number): string | null => {
    if (y < STRIP_H) {
      if (x < PILL_W) return "pill:L";
      if (x >= R_PILL_X) return "pill:R";
      if (x >= LAYOUT_X && x < LAYOUT_X + LAYOUT_W) return "badge:layout";
      const tab = tabAt(x);
      return tab === null ? null : `tab:${tab}`;
    }
    if (y >= DOCK_Y) {
      const item = dockAt(x);
      return item ? `dock:${item.act}` : null;
    }
    switch (bodyMode()) {
      case "launcher": {
        const row = menuRowAt(x, y);
        return row === null ? null : `menu:${row}`;
      }
      case "chords": {
        const row = Math.floor((y - CHORD_ROWS_Y) / CHORD_ROW_H);
        if (row < 0 || row > 3) return null;
        return chordActionAt(x, y) === null ? null : `chord:${x < CHORD_COL_SPLIT ? "l" : "r"}${row}`;
      }
      default:
        return null;
    }
  };

  const reset = () => {
    pending = null;
    splitHandle = null;
    columnHandle = null;
    panning = false;
    press.release();
    store.setDrag(null);
    store.setClosing(null);
  };

  const tabAt = (x: number): number | null => {
    if (x < TABS_X || x >= TABS_X + TAB_W * WORKSPACES) return null;
    return 1 + Math.floor((x - TABS_X) / TAB_W);
  };

  const chordActionAt = (x: number, y: number): ActionId | null => {
    const row = Math.floor((y - CHORD_ROWS_Y) / CHORD_ROW_H);
    if (row < 0 || row > 3) return null;
    const layer = store.layer();
    let button: number | null = null;
    if (x < CHORD_COL_SPLIT) {
      if (row === 2) button = BTN.START;
      if (row === 3) button = BTN.SELECT;
    } else {
      button = FACE_ORDER[row];
    }
    if (button === null) return null;
    return chordFor(layer, button)?.action ?? null;
  };

  const tapStrip = (x: number) => {
    if (x < PILL_W) {
      store.setLatchL(!store.latchL());
      return;
    }
    if (x >= R_PILL_X) {
      store.setLatchR(!store.latchR());
      return;
    }
    if (x >= LAYOUT_X && x < LAYOUT_X + LAYOUT_W) {
      store.toggleLayout();
      return;
    }
    const tab = tabAt(x);
    if (tab !== null) store.switchWs(tab);
  };

  const tapDock = (x: number) => {
    const item = dockAt(x);
    if (!item) return;
    switch (item.act) {
      case "menu":
        store.setLauncherIndex(0);
        store.setLauncherOpen(!store.launcherOpen());
        break;
      case "kbd":
        store.toggleKeyboard();
        break;
      case "keys":
        store.run("keys");
        break;
      case "wall":
        store.run("wallpaper");
        break;
      case "bar":
        store.run("bar");
        break;
      default:
        store.open(item.act);
    }
  };

  const tapBody = (x: number, y: number) => {
    switch (bodyMode()) {
      case "launcher": {
        const row = menuRowAt(x, y);
        if (row !== null) store.runMenu(row);
        return;
      }
      case "chords": {
        const action = chordActionAt(x, y);
        if (action) {
          store.run(action);
          store.setLatchL(false);
          store.setLatchR(false);
        }
        return;
      }
      case "keyboard": {
        const hit = keyboardHit(x, y, store.kbLayer());
        if (!hit) return;
        keyPress.press(hit);
        if ("ch" in hit.act) {
          store.typeChar(hit.act.ch);
          if (store.kbLayer() === "upper") store.setKbLayer("lower");
        } else if ("key" in hit.act) {
          store.typeKey(hit.act.key);
        } else if ("layer" in hit.act) {
          store.setKbLayer(hit.act.layer);
        } else {
          store.setKbOpen(false);
        }
        return;
      }
      case "map": {
        if (within(x, y, MAP_RECT)) {
          const id = store.wm.windowAt(toStage(x, y));
          if (id !== null) store.focusWin(id);
        }
      }
    }
  };

  createGesture({
    surface: "auxiliary",
    tapSlop: 6,
    panSlop: 6,
    longPressSeconds: CLOSE_HOLD_SECONDS,
    onDown: (c) => {
      pending = null;
      press.down(targetAt(c.x, c.y));
      if (bodyMode() === "map" && within(c.x, c.y, MAP_RECT)) {
        const id = store.wm.windowAt(toStage(c.x, c.y));
        if (id !== null) pending = { id };
      }
    },
    onTap: (c) => {
      pending = null;
      press.release();
      if (c.y < STRIP_H) tapStrip(c.x);
      else if (c.y >= DOCK_Y) tapDock(c.x);
      else tapBody(c.x, c.y);
    },
    onLongPress: (c) => {
      press.down(null);
      if (pending && bodyMode() === "map") {
        store.setClosing({ id: pending.id, over: false });
      }
      pending = null;
      void c;
    },
    onPanStart: (c) => {
      press.down(null);
      if (store.closing() || bodyMode() !== "map") return;
      const sp = toStage(c.x, c.y);
      if (pending) {
        store.setDrag({ id: pending.id, x: sp.x, y: sp.y, over: null, overWs: null });
        pending = null;
        return;
      }
      if (!within(c.x, c.y, MAP_RECT)) return;
      splitHandle = store.wm.splitAt(sp, 8);
      if (splitHandle) return;
      columnHandle = store.wm.columnEdgeAt(sp, 8);
      if (columnHandle) return;
      panning = store.wm.workspace().layout === "scrolling";
    },
    onPanMove: (c) => {
      const closing = store.closing();
      if (closing) {
        const over = c.y >= CLOSE_BAR_Y && c.y < CLOSE_BAR_Y + CLOSE_BAR_H;
        if (over !== closing.over) store.setClosing({ id: closing.id, over });
        return;
      }
      const drag = store.drag();
      const sp = toStage(c.x, c.y);
      if (drag) {
        const overId = within(c.x, c.y, MAP_RECT) ? store.wm.windowAt(sp) : null;
        store.setDrag({
          id: drag.id,
          x: sp.x,
          y: sp.y,
          over: overId !== null && overId !== drag.id ? overId : null,
          overWs: c.y < STRIP_H ? tabAt(c.x) : null,
        });
        return;
      }
      if (splitHandle) {
        store.wm.dragSplit(splitHandle, sp);
        store.bump();
      } else if (columnHandle) {
        store.wm.dragColumnEdge(columnHandle, sp);
        store.bump();
      } else if (panning) {
        store.wm.scrollBy(-c.fdx / S);
        store.bump();
      }
    },
    onUp: (c) => {
      const closing = store.closing();
      if (closing) {
        if (c.y >= CLOSE_BAR_Y && c.y < CLOSE_BAR_Y + CLOSE_BAR_H) store.close(closing.id);
        reset();
        return;
      }
      const drag = store.drag();
      if (drag) {
        if (drag.overWs !== null && drag.overWs !== store.wm.active) {
          store.wm.moveToWs(drag.id, drag.overWs);
          store.say(`moved to workspace ${drag.overWs}`);
          store.bump();
        } else if (drag.over !== null) {
          store.wm.swap(store.wm.workspace(), drag.id, drag.over);
          store.bump();
        }
      }
      reset();
    },
    onCancel: () => reset(),
  });

  // ---- render ----------------------------------------------------------------

  const closingTitle = () => {
    const c = store.closing();
    return c ? store.windowOf(c.id)?.title ?? "" : "";
  };

  const chordLeft = (layer: Layer, layout: LayoutKind) => {
    const start = chordFor(layer, BTN.START)?.action;
    const select = chordFor(layer, BTN.SELECT)?.action;
    return [
      { badge: "dpad", label: dpadLabel(layer) },
      { badge: "pad", label: padLabel(layer, layout) },
      { badge: "START", label: start ? labelFor(start, layout) : "—" },
      { badge: "SELECT", label: select ? labelFor(select, layout) : "—" },
    ];
  };
  const chordRight = (layer: Layer, layout: LayoutKind) => {
    return FACE_ORDER.map((button) => {
      const chord = chordFor(layer, button);
      return { badge: BUTTON_GLYPH[button], label: chord ? labelFor(chord.action, layout) : "—" };
    });
  };
  const latched = () => store.latchL() || store.latchR();

  /** An app's dock mark: accent under the focused app, dim under one open elsewhere. */
  const runState = (app: AppId): "focused" | "open" | "none" => {
    if (store.focusedApp() === app) return "focused";
    return store.openApps().includes(app) ? "open" : "none";
  };
  const dockOn = (act: DockAct): boolean => {
    switch (act) {
      case "menu":
        return store.launcherOpen();
      case "kbd":
        return store.kbVisible();
      case "keys":
        return store.keysOpen();
      case "bar":
        return store.barVisible();
      default:
        return false;
    }
  };
  const pressedDock = () => DOCK.find((d) => press.is(`dock:${d.act}`)) ?? null;

  return (
    <View debugName="Deck" class="relative w-full h-full bg-[#16161e] overflow-hidden">
      {/* ---- workspace strip ---- */}
      <View debugName="Strip" class="absolute left-0 right-0 top-0 h-[22] bg-[#0e0e14]">
        <Pill x={2} label="L" held={lHeld()} pressed={press.is("pill:L")} />
        <Index each={store.counts()}>
          {(count, i) => (
            <View
              class={
                store.drag()?.overWs === i + 1
                  ? "absolute top-0 h-[22] items-center justify-center bg-[#9ece6a33]"
                  : press.is(`tab:${i + 1}`)
                    ? "absolute top-0 h-[22] items-center justify-center bg-[#24283b]"
                    : "absolute top-0 h-[22] items-center justify-center"
              }
              style={{ insetL: TABS_X + i * TAB_W, width: TAB_W }}
            >
              {/* Omarchy draws the active workspace as a rounded square
                  instead of its number, and empty ones at half strength. */}
              <Show
                when={store.active() === i + 1}
                fallback={<Text class={count() > 0 ? "text-sm text-[#a9b1d6]" : "text-sm text-[#414868]"}>{String(i + 1)}</Text>}
              >
                <View class="w-[10] h-[10] rounded-[2] bg-[#7aa2f7]" />
              </Show>
            </View>
          )}
        </Index>
        <View
          class={press.is("badge:layout") ? "absolute top-0 h-[22] bg-[#24283b]" : "absolute top-0 h-[22]"}
          style={{ insetL: LAYOUT_X, width: LAYOUT_W }}
        >
          <Image
            class="absolute top-[3] w-[16] h-[16]"
            src={icon(store.layoutKind() === "dwindle" ? "dwindle" : "scrolling", "fg")}
            style={{ insetL: (LAYOUT_W - 16) / 2 }}
          />
        </View>
        <Pill x={R_PILL_X} label="R" held={rHeld()} pressed={press.is("pill:R")} />
      </View>

      {/* ---- bodies ----
          The minimap, the three chord maps and the menu stay mounted and laid
          out; only the current one is opaque, and opacity is a prop rather
          than a class, which would restyle and relayout. Mounting a chord map
          took 270 ms of JS on an Old 3DS, and every shoulder press swaps one
          in; display:none would drop its layout and text runs (~25 ms of core
          work per swap); the draw walk culls an opacity-0 subtree. The
          keyboard mounts on demand: kept laid out, its forty keys doubled the
          relayout behind every focus change. */}
      <View debugName="MapBody" class="absolute inset-0" style={{ opacity: bodyMode() === "map" ? 1 : 0 }}>
        <View debugName="Minimap" class="absolute overflow-hidden border border-[#292e42]" style={{ insetL: MAP_X, insetT: MAP_Y, width: MAP_W, height: MAP_H }}>
          <Show when={store.wallpaper() === "road"}>
            <Image class="absolute left-0 top-0" src="wall/road.png" style={{ width: 512 * S, height: 256 * S }} />
          </Show>
          <Show when={store.wallpaper() === "lake"}>
            <Image class="absolute left-0 top-0" src="wall/lake.png" style={{ width: 512 * S, height: 256 * S }} />
          </Show>
          <Show when={store.wallpaper() === "swirl"}>
            <Image class="absolute left-0 top-0" src="wall/swirl.png" style={{ width: 512 * S, height: 256 * S }} />
          </Show>
          <View class="absolute inset-0 bg-[#16161e99]" />
          <Show when={store.barVisible()}>
            <View class="absolute left-0 right-0 top-0 bg-[#1a1b26]" style={{ height: Math.round(BAR_H * S) }} />
          </Show>
          <For each={mapOrder()}>
            {(id) => {
              const p = createMemo(() => mapPlacements().find((placement) => placement.id === id), undefined, { equals: samePlacement });
              const focused = createMemo(() => mapFocus() === id);
              const target = () => store.drag()?.over === id;
              return (
                <Show when={p() && !p()!.hidden}>
                  <View
                    class={
                      target()
                        ? "absolute border border-[#9ece6a] bg-[#9ece6a33] items-center justify-center overflow-hidden"
                        : focused()
                          ? "absolute border border-[#7aa2f7] bg-[#1a1b26e6] items-center justify-center overflow-hidden"
                          : "absolute border border-[#595959] bg-[#1a1b26cc] items-center justify-center overflow-hidden"
                    }
                    style={{
                      insetL: p()!.rect.x * S,
                      insetT: p()!.rect.y * S,
                      width: p()!.rect.w * S,
                      height: p()!.rect.h * S,
                    }}
                  >
                    <Show when={p()!.rect.w * S >= 34 && p()!.rect.h * S >= 14}>
                      <Text class={focused() ? "text-xs text-[#c0caf5]" : "text-xs text-[#565f89]"}>
                        {store.windowOf(id)?.title ?? ""}
                      </Text>
                    </Show>
                  </View>
                </Show>
              );
            }}
          </For>
          <Show when={mapOrder().length === 0}>
            <Text class="absolute left-0 right-0 text-center text-xs text-[#565f89]" style={{ insetT: MAP_H / 2 - 6 }}>
              empty · tap an app below, or hold L
            </Text>
          </Show>
          <Show when={store.drag()}>
            {(d) => (
              <>
                <View class="absolute left-0 right-0 top-0 h-[14] bg-[#16161ecc] items-center justify-center">
                  <Text class="text-xs text-[#a9b1d6]">drop on a window to swap · on a tab to move</Text>
                </View>
                <View
                  class="absolute w-[56] h-[32] border border-[#7aa2f7] bg-[#24283bdd] items-center justify-center"
                  style={{ insetL: d().x * S - 28, insetT: d().y * S - 16 }}
                >
                  <Text class="text-xs text-[#c0caf5]">{store.windowOf(d().id)?.title ?? ""}</Text>
                </View>
              </>
            )}
          </Show>
        </View>
        <Show when={store.closeBarShown()}>
          <View
            debugName="CloseBar"
            class={
              store.closing()?.over
                ? "absolute left-0 right-0 flex-row items-center justify-center gap-[6] bg-[#f7768e]"
                : "absolute left-0 right-0 flex-row items-center justify-center gap-[6] bg-[#3b2230]"
            }
            style={{ insetT: CLOSE_BAR_Y, height: CLOSE_BAR_H }}
            ref={(el) => store.bindCloseBar(el, CLOSE_BAR_H)}
          >
            <Text class={store.closing()?.over ? "text-sm text-[#1a1b26] font-bold" : "text-sm text-[#f7768e] font-bold"}>×</Text>
            <Text class={store.closing()?.over ? "text-xs text-[#1a1b26]" : "text-xs text-[#f7768e]"}>
              {store.closing()?.over ? "release to close" : "slide here to close"}
            </Text>
            <Text class={store.closing()?.over ? "text-xs text-[#1a1b26] font-bold" : "text-xs text-[#a9b1d6]"}>{closingTitle()}</Text>
          </View>
        </Show>
      </View>

      {/* ---- body: chord maps ----
          One per layer, so a shoulder press only swaps which is displayed;
          their labels change with the layout, not with every press. */}
      <For each={CHORD_LAYERS}>
        {(layer) => {
          // A hidden map keeps the layout it last showed; its labels catch
          // up when its shoulder goes down, not on every layout toggle.
          const layout = createMemo<LayoutKind>((last) => (store.layer() === layer || last === undefined ? store.layoutKind() : last));
          return (
      <View
        debugName="ChordMap"
        class="absolute left-0 right-0"
        style={{ insetT: BODY_TOP, height: BODY_BOTTOM - BODY_TOP, opacity: store.layer() === layer && bodyMode() === "chords" ? 1 : 0 }}
      >
          <Text class="absolute left-0 right-0 text-center text-xs text-[#7aa2f7] font-bold" style={{ insetT: CHORD_TITLE_Y - BODY_TOP }}>
            {LAYER_TITLE[layer]}
          </Text>
          <Index each={chordLeft(layer, layout())}>
            {(row, i) => (
              <View
                class={
                  press.is(`chord:l${i}`)
                    ? "absolute left-[8] h-[24] flex-row items-center gap-[6] overflow-hidden bg-[#24283b]"
                    : "absolute left-[8] h-[24] flex-row items-center gap-[6] overflow-hidden"
                }
                style={{ insetT: CHORD_ROWS_Y - BODY_TOP + i * CHORD_ROW_H, width: CHORD_COL_SPLIT - 12 }}
              >
                <Show when={row().badge === "dpad"}>
                  <View class="w-[18] h-[18] bg-[#1a1b26] border border-[#414868] items-center justify-center">
                    <Text class="text-xs text-[#c0caf5] font-bold">+</Text>
                  </View>
                </Show>
                <Show when={row().badge === "pad"}>
                  <View class="w-[18] h-[18] rounded-full bg-[#1a1b26] border border-[#414868] items-center justify-center">
                    <View class="w-[6] h-[6] rounded-full bg-[#c0caf5]" />
                  </View>
                </Show>
                <Show when={row().badge === "START" || row().badge === "SELECT"}>
                  <View class="w-[44] h-[14] bg-[#1a1b26] border border-[#414868] items-center justify-center">
                    <Text class="text-xs text-[#c0caf5] font-bold">{row().badge}</Text>
                  </View>
                </Show>
                <Text class={row().label === "—" ? "text-xs text-[#414868]" : "text-xs text-[#a9b1d6]"}>{row().label}</Text>
              </View>
            )}
          </Index>
          <Index each={chordRight(layer, layout())}>
            {(row, i) => (
              <View
                class={
                  press.is(`chord:r${i}`)
                    ? "absolute h-[24] flex-row items-center gap-[6] overflow-hidden bg-[#24283b]"
                    : "absolute h-[24] flex-row items-center gap-[6] overflow-hidden"
                }
                style={{ insetL: CHORD_COL_SPLIT + 6, insetT: CHORD_ROWS_Y - BODY_TOP + i * CHORD_ROW_H, width: 320 - CHORD_COL_SPLIT - 12 }}
              >
                <View class="w-[18] h-[18] rounded-full bg-[#1a1b26] border border-[#414868] items-center justify-center">
                  <Text class="text-xs text-[#c0caf5] font-bold">{row().badge}</Text>
                </View>
                <Text class={row().label === "—" ? "text-xs text-[#414868]" : "text-xs text-[#a9b1d6]"}>{row().label}</Text>
              </View>
            )}
          </Index>
          <Text class="absolute left-0 right-0 text-center text-xs text-[#565f89]" style={{ insetT: HINT_Y - BODY_TOP }}>
            {latched() ? "tap a row, or press the button · tap L/R again to let go" : LAYER_HINT[layer]}
          </Text>
      </View>
          );
        }}
      </For>

      {/* ---- body: the menu (Omarchy's SUPER + SPACE card) ---- */}
        <View
          debugName="Menu"
          class="absolute bg-[#1a1b26] border border-[#7aa2f7]"
          style={{ insetL: MENU_X, insetT: MENU_Y, width: MENU_W, height: MENU_ROWS_Y - MENU_Y + MENU.length * MENU_ROW_H + 6, opacity: bodyMode() === "launcher" ? 1 : 0 }}
        >
          <Text class="absolute left-[10] top-[5] text-sm text-[#c0caf5] font-bold">Menu</Text>
          <Text class="absolute left-[46] top-[5] text-sm text-[#565f89]">…</Text>
          <Index each={MENU}>
            {(item, i) => {
              const selected = () => press.is(`menu:${i}`) || store.launcherIndex() === i;
              return (
                <View
                  class={selected() ? "absolute left-[2] right-[2] h-[20] bg-[#c0caf514]" : "absolute left-[2] right-[2] h-[20]"}
                  style={{ insetT: MENU_ROWS_Y - MENU_Y - 2 + i * MENU_ROW_H }}
                >
                  <Image class="absolute left-[8] top-[2] w-[16] h-[16]" src={icon(menuIcon(item()), selected() ? "accent" : "fg")} />
                  <Text class={selected() ? "absolute left-[32] top-[3] text-sm text-[#7aa2f7]" : "absolute left-[32] top-[3] text-sm text-[#c0caf5]"}>
                    {item().label}
                  </Text>
                  <Text class="absolute right-[8] top-[4] text-xs text-[#565f89]">{item().blurb}</Text>
                </View>
              );
            }}
          </Index>
        </View>

      {/* ---- body: keyboard ---- */}
      <Show when={bodyMode() === "keyboard"}>
        <Keyboard store={store} pressed={keyPress.pressed} />
      </Show>

      {/* ---- dock ---- */}
      <View debugName="Dock" class="absolute left-0 right-0 bottom-0 h-[36] bg-[#0e0e14]">
        <For each={DOCK}>
          {(item) => {
            const pressed = () => press.is(`dock:${item.act}`);
            const disabled = () => item.act === "kbd" && !isTextApp(store.focusedApp());
            const tone = (): IconTone => (pressed() ? "ink" : dockOn(item.act) ? "accent" : "fg");
            const mark = () => (isApp(item.act) ? runState(item.act) : "none");
            return (
              <View
                class={pressed() ? "absolute top-0 w-[36] h-[36] bg-[#7aa2f7]" : "absolute top-0 w-[36] h-[36]"}
                style={{ insetL: item.x }}
              >
                <Image class="absolute left-[10] top-[8] w-[16] h-[16]" src={icon(item.icon, tone())} style={{ opacity: disabled() ? 0.3 : 1 }} />
                <Show when={mark() !== "none"}>
                  <View
                    class={mark() === "focused" ? "absolute left-[13] top-[29] w-[10] h-[2] bg-[#7aa2f7]" : "absolute left-[16] top-[29] w-[4] h-[2] bg-[#565f89]"}
                  />
                </Show>
              </View>
            );
          }}
        </For>
      </View>
      {/* The pressed cell names itself: the glyphs carry no labels. */}
      <Show when={pressedDock()}>
        {(item) => (
          <View
            class="absolute h-[16] bg-[#1a1b26] border border-[#7aa2f7] items-center justify-center"
            style={{ insetL: Math.max(2, Math.min(320 - 66, item().x + DOCK_CELL / 2 - 32)), insetT: DOCK_Y - 20, width: 64 }}
          >
            <Text class="text-xs text-[#c0caf5]">{item().label}</Text>
          </View>
        )}
      </Show>
    </View>
  );
}

export { BAR_H };
