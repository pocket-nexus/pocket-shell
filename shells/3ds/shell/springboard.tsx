// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/shell/springboard.tsx — the Home screen on the touch screen: the
// status bar (carrier, Wi-Fi, time), pages of glossy icons over the
// wallpaper, page dots and the glass dock (Settings, Camera, Photos, Mac).
//
// The pages sit side by side in one row that a drag moves sideways, as on
// SpringBoard: the row follows the finger, resists past the first and last
// page, and on release settles on the page the drag or the flick points to.
// The D-pad pages at the grid's left and right edges.
//
// Where each icon sits comes from layout.ts (pages and dock, kept in Home's
// data). Holding an icon (or Y) starts edit mode: icons wiggle, applets get
// a delete badge, and an icon held and moved is picked up. While it follows
// the stylus the others make room for it, sliding to their new places from
// their old ones; holding it at the left or right edge turns the page (one
// past the last opens a new page), and the dock takes it while it has fewer
// than four icons. START, B, Done or a tap on the wallpaper ends edit mode.
//
// Installed applets come from the launcher's app table. Tapping one zooms
// the screen and asks the host to switch to it; Home boots again after every
// switch, and its board zooms back from where the launch zoom ended. An
// applet the host interrupted, or one that stopped with an error, is
// announced by an iOS 6 banner that slides over the status bar.

import { createEffect, createMemo, createSignal, For, on, Show, type Accessor } from "solid-js";
import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { animate, cancelAnim, jump } from "@pocketjs/framework/animation";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { civilFromEpoch, statusTime } from "./clock.ts";
import {
  appKey,
  canStore,
  COLS,
  DOCK_MAX,
  drop,
  lift,
  loadLayout,
  MAC_KEY,
  PER_PAGE,
  placeOf,
  reconcile,
  saveLayout,
  sameLayout,
  SETTINGS_KEY,
  tidy,
  type HomeLayout,
  type Place,
} from "./layout.ts";
import { ICONS } from "./pages.tsx";
import { type HomeApp, type HomeSystem } from "./system.ts";
import { appTint, StatusBar, Tile, Wallpaper, type TileProps } from "../ui/chrome.tsx";
import { ellipsize, FONT } from "../ui/text.ts";
import type { Press, Target, TargetDrag, TouchPage } from "../ui/touch.ts";

export { COLS, PER_PAGE } from "./layout.ts";
export const ROWS = 2;
const ICON = 46;
const CELL_W = 80;
/** Icon labels span the whole cell in bold 10 px (text-2xs), the size
 *  SpringBoard's labels have at the 3DS's 0.82 scale. */
const LABEL_W = CELL_W;
const ROW_Y = [26, 100];
const BANNER_H = 36;
/** Seconds a banner stays before it slides away. */
const BANNER_SECONDS = 6;
const DOCK_Y = 174;
const DOTS_Y = 168;
const PAGE_W = 320;
/** A release faster than this (px/s) turns the page toward the flick. */
const FLICK = 250;
/** UIScrollView's rubber band: the row moves (1 - 1/(over*k/w + 1))*w. */
const RUBBER = 0.55;
/** A carried icon held this close to a side for EDGE_FRAMES turns the page. */
const EDGE = 14;
const EDGE_FRAMES = 30;
/** Below this line a carried icon goes to the dock. */
const DOCK_LINE = 164;
/** Icons slide to a new place in this many ms. */
const SLIDE_MS = 200;
/** The carried icon is drawn this much larger, as on SpringBoard. */
const CARRY_SCALE = 1.18;
const DONE = { x: 262, y: 20, w: 52, h: 22 };

const rubber = (over: number) => (1 - 1 / ((Math.abs(over) * RUBBER) / PAGE_W + 1)) * PAGE_W * Math.sign(over);

export interface SpringboardEnv {
  sys: HomeSystem;
  press: Press;
  keys: Accessor<boolean>;
  setKeys(on: boolean): void;
  openApp(which: "settings" | "store"): void;
  confirm(title: string, message: string, action: string, run: () => void): void;
  /** False while another layer owns the screen. */
  active: Accessor<boolean>;
}

export interface Springboard {
  view: () => ReturnType<typeof View>;
  touch(): TouchPage;
  key(pressed: number): boolean;
  editing: Accessor<boolean>;
  launching: Accessor<string>;
}

/** The banner over the status bar: an applet to go back to, or one that stopped. */
interface Banner {
  app: HomeApp | null;
  title: string;
  line: string;
  /** Tapping the banner: go back to the applet, or dismiss. */
  resume: boolean;
}

function bannerFor(sys: HomeSystem): Banner | null {
  const table = sys.table();
  if (table.lastError) {
    const failed = table.apps.find((app) => app.output === table.lastError!.output) ?? null;
    return { app: failed, title: `${failed?.title ?? table.lastError.output} stopped`, line: table.lastError.message, resume: false };
  }
  const resume = table.resume ? table.apps.find((app) => app.output === table.resume) ?? null : null;
  if (resume) return { app: resume, title: resume.title, line: "Tap here or press SELECT to go back to it.", resume: true };
  return null;
}

/** The board's scale at the end of the launch zoom and the start of Home's
 *  own arrival. */
const LAUNCH_SCALE = 1.6;
const LAUNCH_MS = 260;
const ARRIVE_MS = 300;

const iconX = (slot: number) => (slot % COLS) * CELL_W + (CELL_W - ICON) / 2;
const iconY = (slot: number) => ROW_Y[Math.floor(slot / COLS)]!;
/** The dock's icons sit centred in 80 px cells. */
const dockX = (slot: number, count: number) => 160 - (count * CELL_W) / 2 + slot * CELL_W + (CELL_W - ICON) / 2;

/** An icon's position: in the paging row for the grid, on screen for the dock. */
interface Spot {
  x: number;
  y: number;
}

export function createSpringboard(env: SpringboardEnv): Springboard {
  const { sys, press } = env;
  const apps = () => sys.table().apps;
  const [page, setPage] = createSignal(0);
  const [focus, setFocus] = createSignal<string>("");
  const [editing, setEditing] = createSignal(false);
  const [banner, setBanner] = createSignal<Banner | null>(bannerFor(sys));
  const time = createMemo(() => civilFromEpoch(sys.now(), sys.offset()));
  const [launching, setLaunching] = createSignal("");
  const [wiggle, setWiggle] = createSignal(0);
  let gridNode: NodeMirror | undefined;
  let boardNode: NodeMirror | undefined;
  let carryNode: NodeMirror | undefined;

  // ---- the layout ----------------------------------------------------------------

  const keys = createMemo(() => [SETTINGS_KEY, MAC_KEY, ...apps().map((app) => appKey(app.output))]);
  const [saved, setSaved] = createSignal<HomeLayout | null>(loadLayout());
  const layout = createMemo(() => reconcile(saved(), keys()), undefined, { equals: sameLayout });
  // A host may mount storage after the first evaluation (the sim does);
  // read it once more on the first frame.
  let storeChecked = canStore();

  interface Carry {
    key: string;
    lifted: HomeLayout;
    place: Place | null;
    preview: HomeLayout;
    /** Where the stylus holds the icon, from its top-left corner. */
    grabX: number;
    grabY: number;
    /** Frames held at a side; the side (-1, 1, 0 = none). */
    edgeFrames: number;
    edge: number;
  }
  const [carry, setCarry] = createSignal<Carry | null>(null);
  const shown = createMemo(() => carry()?.preview ?? layout(), undefined, { equals: sameLayout });

  const commit = (next: HomeLayout) => {
    const tidied = tidy(next);
    setSaved(tidied);
    saveLayout(tidied);
  };

  /** Pages, plus an empty one after the last while an icon is carried. */
  const pages = () => {
    const list = shown().pages;
    const count = Math.max(1, list.length);
    return carry() && list[list.length - 1]!.length > 0 ? count + 1 : count;
  };
  const gridKeys = createMemo(() => shown().pages.flat());
  const dockKeys = createMemo(() => shown().dock);

  /** Every icon's spot, by key. */
  const spots = createMemo(() => {
    const out = new Map<string, Spot>();
    shown().pages.forEach((list, index) => list.forEach((key, slot) => out.set(key, { x: index * PAGE_W + iconX(slot), y: iconY(slot) })));
    const dock = shown().dock;
    dock.forEach((key, slot) => out.set(key, { x: dockX(slot, dock.length), y: DOCK_Y }));
    return out;
  });

  const appFor = (key: string): HomeApp | null => (key.startsWith("app:") ? apps().find((app) => appKey(app.output) === key) ?? null : null);
  const titleFor = (key: string) => (key === SETTINGS_KEY ? "Settings" : key === MAC_KEY ? "Mac" : appFor(key)?.title ?? "");
  const tileFor = (key: string): Omit<TileProps, "x" | "y" | "size"> => {
    if (key === SETTINGS_KEY) return { art: ICONS.general.art };
    if (key === MAC_KEY) return { art: ICONS.mac.art };
    const app = appFor(key);
    return app ? appTint(app.id, app.title) : {};
  };

  // ---- banner -------------------------------------------------------------------

  let bannerNode: NodeMirror | undefined;
  const hideBanner = () => {
    if (!banner()) return;
    if (bannerNode) animate(bannerNode, "translateY", -BANNER_H, { dur: 220, easing: "in" });
    after(0.24, () => setBanner(null));
  };
  if (banner()) after(BANNER_SECONDS, hideBanner);
  const tapBanner = () => {
    const current = banner();
    if (current?.resume && current.app) sys.launch(current.app.output);
    else hideBanner();
  };

  // ---- paging -------------------------------------------------------------------

  // The row's offset in px (0 = first page) as last written, and the
  // settle animation that may be moving it: its ease-out cubic is evaluated
  // here too, so a finger that lands mid-settle picks the row up where it is.
  let rowX = 0;
  let settle = { id: -1, from: 0, to: 0, frame: 0, frames: 0 };
  let frames = 0;
  onFrame(() => {
    frames++;
    if (!storeChecked && canStore()) {
      storeChecked = true;
      const stored = loadLayout();
      if (stored) setSaved(stored);
    }
    if (editing() && frames % 5 === 0) setWiggle((wiggle() + 1) % 4);
    // Keep the page index inside the layout after a removal.
    if (page() > pages() - 1) showPage(pages() - 1);
    const held = carry();
    if (held && held.edge !== 0 && ++held.edgeFrames >= EDGE_FRAMES) {
      held.edgeFrames = 0;
      showPage(page() + held.edge);
      replace(lastX, lastY);
    }
  });

  const clampPage = (next: number) => Math.max(0, Math.min(pages() - 1, next));
  const settledX = () => {
    if (settle.id < 0) return rowX;
    const t = Math.min(1, (frames - settle.frame) / settle.frames);
    return settle.from + (settle.to - settle.from) * (1 - (1 - t) ** 3);
  };
  const stopSettle = () => {
    if (settle.id < 0) return;
    rowX = settledX();
    cancelAnim(settle.id);
    settle.id = -1;
    if (gridNode) jump(gridNode, "translateX", rowX);
  };
  const placeRow = (x: number) => {
    rowX = x;
    if (gridNode) jump(gridNode, "translateX", x);
  };

  const showPage = (next: number, animated = true) => {
    const target = clampPage(next);
    setPage(target);
    stopSettle();
    const to = -target * PAGE_W;
    if (!gridNode || !animated || rowX === to) return placeRow(to);
    const ms = Math.max(180, Math.min(340, 150 + Math.abs(to - rowX) * 0.6));
    settle = { id: animate(gridNode, "translateX", to, { dur: ms, easing: "out" }), from: rowX, to, frame: frames, frames: ms / (1000 / 60) };
    rowX = to;
  };

  // A drag: the row follows the finger from where it was picked up.
  let dragFrom = 0;
  const dragTo = (dx: number) => {
    const x = dragFrom + dx;
    const min = -(pages() - 1) * PAGE_W;
    placeRow(x > 0 ? rubber(x) : x < min ? min + rubber(x - min) : x);
    const live = clampPage(Math.round(-rowX / PAGE_W));
    if (live !== page()) setPage(live);
  };
  const release = (vx: number) => {
    const at = -rowX / PAGE_W;
    showPage(vx < -FLICK ? Math.floor(at) + 1 : vx > FLICK ? Math.ceil(at) - 1 : Math.round(at));
  };

  // ---- carrying an icon ---------------------------------------------------------

  let lastX = 0;
  let lastY = 0;

  /** Where a carried icon at (x, y) on screen would go. */
  const placeAt = (lifted: HomeLayout, x: number, y: number): Place => {
    if (y >= DOCK_LINE) {
      const count = Math.min(DOCK_MAX, lifted.dock.length + 1);
      const slot = Math.round((x - (160 - (count * CELL_W) / 2) - CELL_W / 2) / CELL_W);
      return { at: "dock", slot: Math.max(0, Math.min(lifted.dock.length, slot)) };
    }
    const column = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL_W)));
    const row = y < (ROW_Y[0]! + ROW_Y[1]! + ICON) / 2 ? 0 : 1;
    const onPage = lifted.pages[page()]?.length ?? 0;
    return { at: "grid", page: page(), slot: Math.min(onPage, row * COLS + column) };
  };
  const samePlace = (a: Place | null, b: Place | null) =>
    a === b || (!!a && !!b && a.at === b.at && a.slot === b.slot && (a.at === "dock" || a.page === (b as typeof a).page));

  /** Move the carried icon to (x, y) and let the others make room. */
  const replace = (x: number, y: number) => {
    const held = carry();
    if (!held) return;
    const place = placeAt(held.lifted, x, y);
    if (samePlace(place, held.place)) return;
    const preview = drop(held.lifted, held.key, place);
    setCarry({ ...held, place: preview ? place : null, preview: preview ?? held.lifted });
  };

  const moveCarry = (x: number, y: number) => {
    lastX = x;
    lastY = y;
    const held = carry();
    if (!held) return;
    if (carryNode) {
      jump(carryNode, "translateX", x - held.grabX);
      jump(carryNode, "translateY", y - held.grabY);
    }
    const edge = y < DOCK_LINE ? (x < EDGE ? -1 : x > PAGE_W - EDGE ? 1 : 0) : 0;
    if (edge !== held.edge) {
      held.edge = edge;
      held.edgeFrames = 0;
    }
    replace(x, y);
  };

  const dragFor = (key: string): TargetDrag => ({
    start(x, y) {
      const from = spots().get(key);
      if (!from) return;
      const onScreen = layout().dock.includes(key) ? from : { x: from.x - page() * PAGE_W, y: from.y };
      const lifted = lift(layout(), key);
      setFocus("");
      setCarry({
        key,
        lifted,
        place: placeOf(layout(), key),
        preview: layout(),
        grabX: x - onScreen.x,
        grabY: y - onScreen.y,
        edgeFrames: 0,
        edge: 0,
      });
      lastX = x;
      lastY = y;
      if (carryNode) {
        jump(carryNode, "translateX", onScreen.x);
        jump(carryNode, "translateY", onScreen.y);
      }
    },
    move: moveCarry,
    end(x, y) {
      moveCarry(x, y);
      const held = carry();
      setCarry(null);
      if (held) commit(held.place ? held.preview : layout());
    },
    cancel() {
      setCarry(null);
    },
  });

  // ---- launching, deleting -------------------------------------------------------

  const launch = (app: HomeApp) => {
    if (launching()) return;
    setLaunching(app.output);
    if (boardNode) {
      animate(boardNode, "scale", LAUNCH_SCALE, { dur: LAUNCH_MS, easing: "in" });
      animate(boardNode, "opacity", 0, { dur: LAUNCH_MS, easing: "in" });
    }
    after(0.28, () => {
      if (sys.launch(app.output)) return;
      setLaunching("");
      if (boardNode) {
        jump(boardNode, "scale", 1);
        jump(boardNode, "opacity", 1);
      }
      env.confirm(`Cannot Open "${app.title}"`, "The console did not start this applet.", "OK", () => {});
    });
  };

  const activate = (key: string) => {
    if (editing()) return;
    if (key === SETTINGS_KEY) env.openApp("settings");
    else if (key === MAC_KEY) env.openApp("store");
    else {
      const app = appFor(key);
      if (app) launch(app);
    }
  };

  const remove = (app: HomeApp) =>
    env.confirm(`Delete "${app.title}"?`, "Deleting this applet also deletes its data.", "Delete", () => {
      sys.remove(app);
      if (apps().length === 0) setEditing(false);
    });

  const endEditing = () => {
    setEditing(false);
    setCarry(null);
  };

  // ---- the stylus ---------------------------------------------------------------

  const targets = (): Target[] => {
    const out: Target[] = [];
    const editingNow = editing();
    const icon = (key: string, x: number, y: number) => {
      out.push({
        id: key,
        x: x - 10,
        y: y - 4,
        w: ICON + 20,
        h: ICON + 22,
        run: () => activate(key),
        hold: () => setEditing(true),
        drag: editingNow ? dragFor(key) : undefined,
      });
      const app = editingNow ? appFor(key) : null;
      if (app) out.push({ id: `delete:${app.output}`, x: x - 14, y: y - 14, w: 28, h: 28, run: () => remove(app) });
    };
    const list = shown().pages[page()] ?? [];
    list.forEach((key, slot) => icon(key, iconX(slot), iconY(slot)));
    const dock = shown().dock;
    dock.forEach((key, slot) => icon(key, dockX(slot, dock.length), DOCK_Y));
    if (editingNow) out.push({ id: "home.done", ...DONE, run: endEditing });
    if (banner()) out.push({ id: "banner", x: 0, y: 0, w: 320, h: BANNER_H, run: tapBanner });
    return out;
  };

  // ---- the D-pad ------------------------------------------------------------------

  // The grid page as a 4-column matrix, the dock as the last row.
  const moveFocus = (pressed: number) => {
    const grid = shown().pages[page()] ?? [];
    const dock = shown().dock;
    const current = focus();
    const inGrid = grid.indexOf(current);
    const inDock = dock.indexOf(current);
    if (!env.keys() || (inGrid < 0 && inDock < 0)) {
      env.setKeys(true);
      setFocus(grid[0] ?? dock[0] ?? "");
      return;
    }
    if (inDock >= 0) {
      if (pressed & BTN.LEFT && inDock > 0) setFocus(dock[inDock - 1]!);
      else if (pressed & BTN.RIGHT && inDock < dock.length - 1) setFocus(dock[inDock + 1]!);
      else if (pressed & BTN.UP && grid.length > 0) {
        const column = Math.max(0, Math.min(COLS - 1, Math.floor((dockX(inDock, dock.length) + ICON / 2) / CELL_W)));
        const lastRow = Math.floor((grid.length - 1) / COLS);
        setFocus(grid[Math.min(grid.length - 1, lastRow * COLS + column)]!);
      }
      return;
    }
    const column = inGrid % COLS;
    if (pressed & BTN.LEFT) {
      if (column > 0) setFocus(grid[inGrid - 1]!);
      else if (page() > 0) {
        const previous = shown().pages[page() - 1] ?? [];
        showPage(page() - 1);
        setFocus(previous[previous.length - 1] ?? "");
      }
    } else if (pressed & BTN.RIGHT) {
      if (column < COLS - 1 && inGrid + 1 < grid.length) setFocus(grid[inGrid + 1]!);
      else if (page() < shown().pages.length - 1) {
        const next = shown().pages[page() + 1] ?? [];
        showPage(page() + 1);
        const row = Math.floor(inGrid / COLS);
        setFocus(next[Math.min(next.length - 1, row * COLS)] ?? next[0] ?? "");
      }
    } else if (pressed & BTN.UP) {
      if (inGrid >= COLS) setFocus(grid[inGrid - COLS]!);
    } else if (pressed & BTN.DOWN) {
      if (inGrid + COLS < grid.length) setFocus(grid[inGrid + COLS]!);
      else if (dock.length > 0) {
        const x = iconX(inGrid) + ICON / 2;
        let best = 0;
        dock.forEach((_, slot) => {
          if (Math.abs(dockX(slot, dock.length) + ICON / 2 - x) < Math.abs(dockX(best, dock.length) + ICON / 2 - x)) best = slot;
        });
        setFocus(dock[best]!);
      }
    }
  };

  // ---- drawing -----------------------------------------------------------------------

  /** The key being carried: its icon in the grid or dock is the hole the
   *  carried copy will fill, so it is drawn invisible meanwhile. */
  const carried = createMemo(() => carry()?.key ?? "");
  const iconProps = { env, focus, editing, wiggle, spots, titleFor, tileFor, appFor, carried };

  /** The board as Home boots: back from the launch zoom, while the host's
   *  switch transition fades its scrim away. */
  const arrive = (node: NodeMirror) => {
    boardNode = node;
    jump(node, "scale", LAUNCH_SCALE);
    jump(node, "opacity", 0);
    animate(node, "scale", 1, { dur: ARRIVE_MS, easing: "out" });
    animate(node, "opacity", 1, { dur: ARRIVE_MS, easing: "out" });
  };

  const view = () => (
    <View ref={arrive} class="absolute left-0 top-0 w-[320] h-[240]">
      <Wallpaper screen="bottom" />
      <View ref={(node) => (gridNode = node)} class="absolute left-0 top-0 w-[320] h-[164]">
        <For each={gridKeys()}>{(key, index) => <HomeIcon iconKey={key} index={index} {...iconProps} />}</For>
      </View>
      <Show when={apps().length === 0 && gridKeys().length === 0}>
        <Text class="absolute left-0 top-[58] w-[320] text-sm text-[#ffffffd0] font-bold text-center">No applets yet</Text>
        <Text class="absolute left-0 top-[78] w-[320] text-xs text-[#ffffffa0] text-center">Open Mac below to install applets from your Mac.</Text>
      </Show>
      <Show when={pages() > 1}>
        <For each={Array.from({ length: pages() }, (_, index) => index)}>
          {(index) => (
            <View
              class={page() === index ? "absolute w-[6] h-[6] rounded-[3] bg-white" : "absolute w-[6] h-[6] rounded-[3] bg-[#ffffff55]"}
              style={{ insetL: 160 - pages() * 6 + index * 12, insetT: DOTS_Y }}
            />
          )}
        </For>
      </Show>
      <Image class="absolute left-0 top-[200] w-[512] h-[64]" src="art/icons/dock.png" />
      <For each={dockKeys()}>{(key, index) => <HomeIcon iconKey={key} index={index} {...iconProps} />}</For>
      <StatusBar
        width={320}
        carrier="Pocket"
        bars={() => {
          const wifi = sys.wifi();
          return !wifi || wifi.state === "off" ? -1 : wifi.state === "connected" ? wifi.strength : 0;
        }}
        time={() => statusTime(time())}
      />
      <Show when={editing()}>
        <View
          class={press.is("home.done") ? "absolute rounded-[11] bg-[#ffffffd0]" : "absolute rounded-[11] bg-[#ffffff90]"}
          style={{ insetL: DONE.x, insetT: DONE.y, width: DONE.w, height: DONE.h }}
        >
          <Text class="absolute left-0 top-[4] w-[52] text-xs text-[#1c3a5a] font-bold text-center">Done</Text>
        </View>
      </Show>
      <Show when={carry()}>
        {(held) => (
          <View
            ref={(node) => {
              carryNode = node;
              jump(node, "translateX", lastX - held().grabX);
              jump(node, "translateY", lastY - held().grabY);
            }}
            class="absolute left-0 top-0 w-[46] h-[46]"
            style={{ scale: CARRY_SCALE, opacity: 0.9 }}
          >
            <Tile x={0} y={0} size={ICON} {...tileFor(held().key)} />
            <Show when={appFor(held().key) !== null}>
              <Image class="absolute left-[-9] top-[-9] w-[22] h-[22]" src="art/delete-badge.svg" />
            </Show>
            <IconLabel title={titleFor(held().key)} x={(ICON - LABEL_W) / 2} y={49} />
          </View>
        )}
      </Show>
      <Show when={banner()}>
        {(current) => (
          <View
            ref={(node) => {
              bannerNode = node;
              jump(node, "translateY", -BANNER_H);
              animate(node, "translateY", 0, { dur: 260, easing: "out" });
            }}
            class="absolute left-0 top-0 w-[320] h-[36] bg-gradient-to-b from-[#3a3a3a] to-[#0c0c0c]"
          >
            <View class="absolute left-0 bottom-0 w-[320] h-[1] bg-[#000000]" />
            <View class="absolute left-0 top-0 w-[320] h-[1] bg-[#ffffff30]" />
            <Show
              when={current().app}
              fallback={<Tile x={7} y={6} size={24} art={ICONS.general.art} />}
            >
              {(app) => <Tile x={7} y={6} size={24} {...appTint(app().id, app().title)} />}
            </Show>
            <Text class="absolute left-[38] top-[3] text-xs text-white font-bold">{ellipsize(current().title, FONT.xsBold, 272)}</Text>
            <Text class="absolute left-[38] top-[18] text-xs text-[#ffffffb8]">{ellipsize(current().line, FONT.xs, 272)}</Text>
          </View>
        )}
      </Show>
    </View>
  ) as unknown as ReturnType<typeof View>;

  return {
    view,
    editing,
    launching,
    touch: () => ({
      targets,
      background: () => {
        if (editing()) endEditing();
      },
      panX: {
        start: () => {
          stopSettle();
          dragFrom = rowX;
        },
        move: dragTo,
        end: (_dx, vx) => release(vx),
      },
    }),
    key(pressed) {
      if (!env.active()) return false;
      if (pressed & BTN.SQUARE) {
        if (editing()) endEditing();
        else setEditing(true);
        return true;
      }
      if (pressed & (BTN.CROSS | BTN.START) && editing()) {
        endEditing();
        return true;
      }
      if (pressed & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT)) {
        moveFocus(pressed);
        return true;
      }
      if (pressed & BTN.CIRCLE && env.keys() && focus()) {
        press.down(focus());
        press.release();
        const app = appFor(focus());
        if (editing() && app) remove(app);
        else activate(focus());
        return true;
      }
      return false;
    },
  };
}

/** One icon, grid or dock. It sits at its spot by layout; when the spot
 *  changes it jumps there and slides in from where it was. */
function HomeIcon(props: {
  iconKey: string;
  index: Accessor<number>;
  env: SpringboardEnv;
  focus: Accessor<string>;
  editing: Accessor<boolean>;
  wiggle: Accessor<number>;
  spots: Accessor<Map<string, Spot>>;
  titleFor(key: string): string;
  tileFor(key: string): Omit<TileProps, "x" | "y" | "size">;
  appFor(key: string): HomeApp | null;
  carried: Accessor<string>;
}) {
  const key = props.iconKey;
  const spot = createMemo(() => props.spots().get(key) ?? { x: -100, y: -100 }, undefined, {
    equals: (a, b) => a.x === b.x && a.y === b.y,
  });
  const angle = () => (props.editing() ? ([-2, 0, 2, 0][(props.wiggle() + props.index()) % 4] ?? 0) : 0);
  const deletable = () => props.editing() && props.appFor(key) !== null;
  let node: NodeMirror | undefined;
  createEffect(
    on(spot, (now, before) => {
      if (!node || !before || (before.x === now.x && before.y === now.y)) return;
      // A move across the paging row (a page turn) is not animated.
      if (Math.abs(before.x - now.x) >= PAGE_W) return;
      jump(node, "translateX", before.x - now.x);
      jump(node, "translateY", before.y - now.y);
      animate(node, "translateX", 0, { dur: SLIDE_MS, easing: "out" });
      animate(node, "translateY", 0, { dur: SLIDE_MS, easing: "out" });
    }),
  );
  return (
    <View
      ref={(el) => (node = el)}
      class="absolute w-[46] h-[46]"
      style={{ insetL: spot().x, insetT: spot().y, rotate: angle(), opacity: props.carried() === key ? 0 : 1 }}
    >
      <Tile x={0} y={0} size={ICON} {...props.tileFor(key)} dim={() => props.env.press.is(key)} />
      <View class={props.env.keys() && props.focus() === key ? "absolute left-[-4] top-[-4] w-[54] h-[54] rounded-[13] border-[#ffffff] border-2" : "hidden"} />
      <Show when={deletable()}>
        <Image class="absolute left-[-9] top-[-9] w-[22] h-[22]" src="art/delete-badge.svg" />
      </Show>
      <IconLabel title={props.titleFor(key)} x={(ICON - LABEL_W) / 2} y={49} />
    </View>
  );
}

/** An icon's title under it: white with a dark drop one pixel below, cut
 *  with "..." when it does not fit the cell. */
function IconLabel(props: { title: string; x: number; y: number }) {
  const text = () => ellipsize(props.title, FONT.xxsBold, LABEL_W - 2);
  const box = (y: number) => ({ insetL: props.x, insetT: y, width: LABEL_W });
  return (
    <>
      <Text class="absolute text-2xs text-[#00000099] font-bold text-center" style={box(props.y + 1)}>{text()}</Text>
      <Text class="absolute text-2xs text-white font-bold text-center" style={box(props.y)}>{text()}</Text>
    </>
  );
}
