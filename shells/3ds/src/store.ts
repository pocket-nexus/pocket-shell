// SPDX-License-Identifier: GPL-3.0-or-later
// src/store.ts — the shell's live state: the window manager
// wrapped in signals, the per-frame input dispatcher that turns shoulder
// chords into actions, window geometry animation, and the applet states the
// windows render. Everything the two screens show reads from here.
//
// Reactivity is coarse on purpose. `rev` bumps after every structural change
// (open, close, focus, layout), and nothing re-evaluates per frame: window
// transitions run on the core's animation tracks. A window's node sits at its
// placement, and a translate/scale carries it from where it was last drawn
// (FLIP), so a transition costs JS once, when it starts, and never relayouts.

import { createMemo, createSignal } from "solid-js";
import { BTN } from "@pocketjs/framework/input";
import { analogX, analogY, onFrame } from "@pocketjs/framework/lifecycle";
import { animate, jump } from "@pocketjs/framework/animation";
import { after, virtualFrame } from "@pocketjs/framework/clock";
import type { NodeMirror } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework";
import { chordsOf, keySheet, layerOf, type ActionId, type Layer } from "./chords.ts";
import { CLEAR, civilFromEpoch, complete, detectOffsetMinutes, run as runShell, type CivilTime, type ShellApi } from "./shell.ts";
import { WindowManager, WORKSPACES, type Placement, type Rect } from "./wm.ts";

export type AppId = "term" | "notes" | "top";
export const APPS: readonly AppId[] = ["term", "notes", "top"];

/** The menu (L + A, or the dock's first cell): Omarchy's SUPER + SPACE list,
 *  one row per app and then the shell's own settings. */
export type MenuItem =
  | { kind: "app"; app: AppId; label: string; blurb: string }
  | { kind: "action"; action: "keys" | "wallpaper" | "bar" | "about"; label: string; blurb: string };
export const MENU: readonly MenuItem[] = [
  { kind: "app", app: "term", label: "Terminal", blurb: "pocketsh" },
  { kind: "app", app: "notes", label: "Notes", blurb: "scratch pad" },
  { kind: "app", app: "top", label: "Top", blurb: "frames, host" },
  { kind: "action", action: "keys", label: "Keys", blurb: "every chord" },
  { kind: "action", action: "wallpaper", label: "Wallpaper", blurb: "next background" },
  { kind: "action", action: "bar", label: "Bar", blurb: "show or hide" },
  { kind: "action", action: "about", label: "About", blurb: "Pocket Shell" },
];
const ABOUT = "Pocket Shell · Omarchy's chords on a 3DS · PocketJS";

export const WALLPAPERS = ["road", "lake", "swirl"] as const;
export type Wallpaper = (typeof WALLPAPERS)[number];

export const isTextApp = (app: AppId | undefined): boolean => app === "term" || app === "notes";

export interface TermState {
  kind: "term";
  lines: string[];
  input: string;
  history: string[];
  /** history.length when not browsing. */
  histIdx: number;
  /** Lines scrolled up from the bottom. */
  scroll: number;
}
export interface NotesState {
  kind: "notes";
  text: string;
  scroll: number;
}
export interface TopState {
  kind: "top";
}
export type AppletState = TermState | NotesState | TopState;

/** A closed window's outline, fading where the window was last drawn. */
export interface Ghost {
  key: number;
  rect: Rect;
}

/** One window's transition: where it was drawn when the transition began,
 *  where it is heading, and the virtual frame it began on. */
interface Motion {
  from: Rect;
  fromAlpha: number;
  to: Rect;
  toAlpha: number;
  start: number;
}

export interface Drag {
  id: number;
  /** Finger position in stage coordinates. */
  x: number;
  y: number;
  /** A window the finger is over (swap target). */
  over: number | null;
  /** A workspace tab the finger is over (move target). */
  overWs: number | null;
}

export type KbLayer = "lower" | "upper" | "sym";

const PROMPT = "❯ ";
const MAX_LINES = 200;
/** Omarchy's low-urgency notification lasts 5 s; a status line here reads in less. */
const TOAST_MS = 1800;
const SLIDE_PX = 48;
/** Window transitions: the core's "out" curve over MOTION_MS. */
const MOTION_MS = 200;
/** The core rounds a duration to whole 60 Hz frames the same way. */
const MOTION_FRAMES = Math.max(1, Math.round((MOTION_MS * 60) / 1000));
const GHOST_MS = 170;
const GHOST_SCALE = 0.7;
const CLOSE_BAR_MS = 100;
const MAX_MENU_INDEX = MENU.length - 1;
export const FPS_SLOTS = 32;
const DEAD_ZONE = 0.25;
const RESIZE_PX = 3;
const SCROLL_PX = 6;

function initialState(app: AppId): AppletState {
  switch (app) {
    case "term":
      return {
        kind: "term",
        lines: ["pocketsh — type help, or hold L", ""],
        input: "",
        history: [],
        histIdx: 0,
        scroll: 0,
      };
    case "notes":
      return { kind: "notes", text: "", scroll: 0 };
    case "top":
      return { kind: "top" };
  }
}

/** The core's EaseOut, so a transition interrupted mid-flight restarts from
 *  exactly where it was drawn. */
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
const mix = (a: number, b: number, e: number): number => a + (b - a) * e;
const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
export const samePlacement = (a: Placement | undefined, b: Placement | undefined): boolean =>
  a === b || (!!a && !!b && a.id === b.id && a.hidden === b.hidden && sameRect(a.rect, b.rect));
const sameList = <T,>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** Where `m` has the window drawn on virtual frame `now`: after `n` core
 *  ticks a track sits at ease(n / frames). */
function drawnAt(m: Motion, now: number): { rect: Rect; alpha: number } {
  const e = easeOut(Math.min(1, Math.max(0, (now - m.start) / MOTION_FRAMES)));
  return {
    rect: { x: mix(m.from.x, m.to.x, e), y: mix(m.from.y, m.to.y, e), w: mix(m.from.w, m.to.w, e), h: mix(m.from.h, m.to.h, e) },
    alpha: mix(m.fromAlpha, m.toAlpha, e),
  };
}

/** Put `node` (laid out at `m.to`, transform origin top-left) where `m`
 *  starts, then let the core carry it home. */
function play(node: NodeMirror, m: Motion): void {
  const { from, to } = m;
  jump(node, "translateX", from.x - to.x);
  jump(node, "translateY", from.y - to.y);
  jump(node, "scaleX", to.w > 0 ? from.w / to.w : 1);
  jump(node, "scaleY", to.h > 0 ? from.h / to.h : 1);
  jump(node, "opacity", m.fromAlpha);
  const opts = { dur: MOTION_MS, easing: "out" } as const;
  animate(node, "translateX", 0, opts);
  animate(node, "translateY", 0, opts);
  animate(node, "scaleX", 1, opts);
  animate(node, "scaleY", 1, opts);
  animate(node, "opacity", m.toAlpha, opts);
}

const shrink = (r: Rect, by: number): Rect => ({
  x: r.x + r.w * by * 0.5,
  y: r.y + r.h * by * 0.5,
  w: r.w * (1 - by),
  h: r.h * (1 - by),
});

export type ShellStore = ReturnType<typeof createShellStore>;

export function createShellStore() {
  const wm = new WindowManager<AppId>();
  const applets = new Map<number, AppletState>();
  const motions = new Map<number, Motion>();
  const winNodes = new Map<number, NodeMirror>();
  let ghostKey = 0;
  let closeBarNode: NodeMirror | undefined;
  let closeBarHeight = 0;
  let toastBarNode: NodeMirror | undefined;
  let toastSeq = 0;

  // The RTC's epoch is trustworthy; QuickJS's breakdown of it on this device
  // is not (see civilFromEpoch). Read the zone once, then do the arithmetic.
  const detectedOffset = (() => {
    try {
      const ms = Date.now();
      return detectOffsetMinutes(ms, new Date(ms));
    } catch {
      return 0;
    }
  })();

  const [offsetMinutes, setOffsetMinutes] = createSignal(detectedOffset);
  const [rev, setRev] = createSignal(0);
  const [ghosts, setGhosts] = createSignal<readonly Ghost[]>([]);
  const [epochSecond, setEpochSecond] = createSignal(0);
  const [layer, setLayer] = createSignal<Layer>("plain");
  const [latchL, setLatchL] = createSignal(false);
  const [latchR, setLatchR] = createSignal(false);
  const [launcherOpen, setLauncherOpen] = createSignal(false);
  const [launcherIndex, setLauncherIndex] = createSignal(0);
  const [keysOpen, setKeysOpen] = createSignal(false);
  const [kbOpen, setKbOpen] = createSignal(false);
  const [kbLayer, setKbLayer] = createSignal<KbLayer>("lower");
  const [wallpaper, setWallpaper] = createSignal<Wallpaper>("road");
  const [toast, setToast] = createSignal("");
  const [drag, setDrag] = createSignal<Drag | null>(null);
  const [closing, setClosingState] = createSignal<{ id: number; over: boolean } | null>(null);
  /** The close bar stays mounted while it slides out after `closing` clears. */
  const [closeBarShown, setCloseBarShown] = createSignal(false);
  const [fps, setFps] = createSignal(0);
  // top's graph sweeps: each second overwrites one slot and moves the head,
  // so one bar redraws instead of all of them shifting.
  const fpsSlots = Array.from({ length: FPS_SLOTS }, () => createSignal(0));
  const [fpsHead, setFpsHead] = createSignal(0);

  let frames = 0;
  let prevButtons = 0;
  let lastSecond = -1;
  let fpsFrames = 0;
  let fpsStamp = 0;

  // ---- derived -----------------------------------------------------------------

  const active = createMemo(() => {
    rev();
    return wm.active;
  });
  // The active Workspace is one mutable object, so identity never changes:
  // opt out of the memo's equality check or nothing downstream re-reads it.
  const workspace = createMemo(
    () => {
      rev();
      return wm.workspace();
    },
    undefined,
    { equals: false },
  );
  // Structural changes bump `rev`; these memos compare by value, so a bump
  // that moved nothing stops here instead of re-running every window.
  const placements = createMemo<Placement[]>(
    () => {
      rev();
      return wm.placements();
    },
    [],
    { equals: (a, b) => a.length === b.length && a.every((p, i) => samePlacement(p, b[i])) },
  );
  const order = createMemo(
    () => {
      rev();
      return wm.order();
    },
    undefined,
    { equals: sameList },
  );
  const focusedId = createMemo(() => {
    rev();
    return wm.workspace().focus;
  });
  const focusedApp = createMemo(() => {
    const id = focusedId();
    return id === null ? undefined : wm.windows.get(id)?.app;
  });
  const counts = createMemo(
    () => {
      rev();
      return wm.workspaces.map((ws) => wm.count(ws));
    },
    undefined,
    { equals: sameList },
  );
  /** Apps with a window anywhere, for the dock's marks. */
  const openApps = createMemo(
    () => {
      rev();
      const apps: AppId[] = [];
      for (const w of wm.windows.values()) if (!apps.includes(w.app)) apps.push(w.app);
      return apps.sort();
    },
    undefined,
    { equals: sameList },
  );
  const layoutKind = createMemo(() => workspace().layout);
  const barVisible = createMemo(() => {
    rev();
    return wm.barVisible;
  });
  const kbVisible = createMemo(() => kbOpen() && isTextApp(focusedApp()));
  const now = createMemo<CivilTime>(() => civilFromEpoch(epochSecond() * 1000, offsetMinutes()));

  const placementOf = (id: number): Placement | undefined => placements().find((p) => p.id === id);

  /** One revision per window's applet: an edit re-renders that window alone,
   *  not the whole shell. */
  const appletRevs = new Map<number, ReturnType<typeof createSignal<number>>>();
  const appletRev = (id: number): number => {
    let signal = appletRevs.get(id);
    if (!signal) {
      signal = createSignal(0);
      appletRevs.set(id, signal);
    }
    return signal[0]();
  };
  const touch = (id: number | null) => {
    if (id !== null) appletRevs.get(id)?.[1]((v) => v + 1);
  };
  const windowOf = (id: number) => wm.windows.get(id);
  const stateOf = (id: number): AppletState | undefined => applets.get(id);
  /** Re-read once a second, with the clock. */
  const uptimeSeconds = (): number => {
    epochSecond();
    return frames / 60;
  };
  /** Re-read once a second, with the clock. */
  const frameCount = (): number => {
    epochSecond();
    return frames;
  };

  // ---- window transitions ------------------------------------------------------------

  /** After a structural change, send every window whose placement moved from
   *  where it is drawn now to where it belongs. */
  const retarget = () => {
    const now = virtualFrame();
    const live = new Set<number>();
    for (const p of placements()) {
      live.add(p.id);
      const toAlpha = p.hidden ? 0 : 1;
      const m = motions.get(p.id);
      if (m && sameRect(m.to, p.rect) && m.toAlpha === toAlpha) continue;
      const drawn = m ? drawnAt(m, now) : { rect: p.rect, alpha: toAlpha };
      const next: Motion = { from: drawn.rect, fromAlpha: drawn.alpha, to: p.rect, toAlpha, start: now };
      motions.set(p.id, next);
      const node = winNodes.get(p.id);
      if (node) play(node, next);
    }
    for (const id of [...motions.keys()]) if (!live.has(id)) motions.delete(id);
  };

  const bump = () => {
    setRev((r) => r + 1);
    retarget();
  };

  /** Start `id` from `from` (its node plays it when it mounts). */
  const enter = (id: number, from: Rect, fromAlpha: number) => {
    const p = wm.placement(id);
    if (!p) return;
    motions.set(id, { from, fromAlpha, to: p.rect, toAlpha: p.hidden ? 0 : 1, start: virtualFrame() });
  };

  /** Stage windows register their node; a window that mounts mid-transition
   *  (every new window does) plays from where the transition has it now. */
  const bindWindow = (id: number, node: NodeMirror) => {
    winNodes.set(id, node);
    const m = motions.get(id);
    if (!m) return;
    const now = virtualFrame();
    const drawn = drawnAt(m, now);
    const next: Motion = { ...m, from: drawn.rect, fromAlpha: drawn.alpha, start: now };
    motions.set(id, next);
    play(node, next);
  };
  const unbindWindow = (id: number, node: NodeMirror) => {
    if (winNodes.get(id) === node) winNodes.delete(id);
  };

  /** A closed window's outline pops out where it was drawn (Omarchy's
   *  windowsOut: short, linear, popin). */
  const bindGhost = (node: NodeMirror) => {
    const opts = { dur: GHOST_MS, easing: "linear" } as const;
    animate(node, "scaleX", GHOST_SCALE, opts);
    animate(node, "scaleY", GHOST_SCALE, opts);
    animate(node, "opacity", 0, opts);
  };

  /** The close bar rises while a window is held and sinks when it is let go. */
  const setClosing = (next: { id: number; over: boolean } | null) => {
    const was = closing();
    setClosingState(next);
    if (next && !was) {
      // Still mounted and sinking: rise again. Otherwise it mounts and
      // bindCloseBar raises it.
      if (closeBarShown() && closeBarNode) raiseCloseBar(closeBarNode);
      else setCloseBarShown(true);
    } else if (!next && was && closeBarNode) {
      const opts = { dur: CLOSE_BAR_MS, easing: "in" } as const;
      animate(closeBarNode, "translateY", closeBarHeight, opts);
      animate(closeBarNode, "opacity", 0, opts);
      after(CLOSE_BAR_MS / 1000, () => {
        if (!closing()) hideCloseBar();
      });
    } else if (!next) {
      hideCloseBar();
    }
  };
  const hideCloseBar = () => {
    closeBarNode = undefined;
    setCloseBarShown(false);
  };
  const raiseCloseBar = (node: NodeMirror) => {
    jump(node, "translateY", closeBarHeight);
    jump(node, "opacity", 0);
    const opts = { dur: CLOSE_BAR_MS, easing: "out" } as const;
    animate(node, "translateY", 0, opts);
    animate(node, "opacity", 1, opts);
  };
  const bindCloseBar = (node: NodeMirror, height: number) => {
    closeBarNode = node;
    closeBarHeight = height;
    if (closing()) raiseCloseBar(node);
  };

  // ---- mutations -----------------------------------------------------------------

  /** A notification card with a countdown bar (Omarchy's), gone after TOAST_MS. */
  const say = (message: string) => {
    const seq = ++toastSeq;
    setToast(message);
    if (!message) return;
    if (toastBarNode) runCountdown(toastBarNode);
    after(TOAST_MS / 1000, () => {
      if (seq === toastSeq) setToast("");
    });
  };
  const runCountdown = (node: NodeMirror) => {
    jump(node, "scaleX", 1);
    animate(node, "scaleX", 0, { dur: TOAST_MS, easing: "linear" });
  };
  /** The card's countdown bar registers on mount; origin at its left end. */
  const bindToastBar = (node: NodeMirror | undefined) => {
    toastBarNode = node;
    if (node && toast()) runCountdown(node);
  };

  const runMenu = (index: number) => {
    const item = MENU[index];
    setLauncherOpen(false);
    if (!item) return;
    if (item.kind === "app") open(item.app);
    else if (item.action === "about") say(ABOUT);
    else run(item.action);
  };

  const open = (app: AppId, wsId: number = wm.active): number => {
    const id = wm.open(app, wsId);
    applets.set(id, initialState(app));
    // Omarchy's windowsIn: pop in from 87% while fading up.
    const target = wm.placement(id)?.rect;
    if (target) enter(id, shrink(target, 0.13), 0);
    bump();
    return id;
  };

  const close = (id: number | null = wm.workspace().focus): boolean => {
    if (id === null) return false;
    const m = motions.get(id);
    const win = wm.windows.get(id);
    const onStage = win?.ws === wm.active;
    const drawn = m ? drawnAt(m, virtualFrame()) : undefined;
    if (!wm.close(id)) return false;
    if (drawn && drawn.alpha > 0 && onStage) {
      const ghost: Ghost = { key: ++ghostKey, rect: drawn.rect };
      setGhosts([...ghosts(), ghost]);
      after(GHOST_MS / 1000, () => setGhosts(ghosts().filter((g) => g !== ghost)));
    }
    motions.delete(id);
    applets.delete(id);
    appletRevs.delete(id);
    bump();
    return true;
  };

  const focusWin = (id: number) => {
    wm.focusWin(id);
    bump();
  };

  const switchWs = (id: number) => {
    if (id < 1 || id > WORKSPACES || id === wm.active) return;
    const slide = (id > wm.active ? 1 : -1) * SLIDE_PX;
    wm.switchWs(id);
    arrive(slide);
    say(`workspace ${id}`);
    bump();
  };

  /** The arriving workspace's windows slide in from `slide` px beside their
   *  places, so the direction of the switch stays readable. */
  const arrive = (slide: number) => {
    for (const p of wm.placements()) enter(p.id, { ...p.rect, x: p.rect.x + slide }, p.hidden ? 0 : 1);
  };

  const toggleLayout = () => {
    const kind = wm.toggleLayout();
    say(`layout: ${kind}`);
    bump();
  };

  const nextWallpaper = (): Wallpaper => {
    const next = WALLPAPERS[(WALLPAPERS.indexOf(wallpaper()) + 1) % WALLPAPERS.length];
    setWallpaper(next);
    return next;
  };

  const toggleKeyboard = () => {
    if (!isTextApp(focusedApp())) {
      say("the keyboard types into term or notes");
      return;
    }
    setKbOpen(!kbOpen());
  };

  const run = (action: ActionId): void => {
    switch (action) {
      case "focus.left":
      case "focus.right":
      case "focus.up":
      case "focus.down": {
        const dir = action.slice(6) as "left" | "right" | "up" | "down";
        if (!wm.focusDir(dir)) say(wm.count() === 0 ? "empty workspace — L+A launches" : `nothing ${dir}`);
        break;
      }
      case "swap.left":
      case "swap.right":
      case "swap.up":
      case "swap.down": {
        const dir = action.slice(5) as "left" | "right" | "up" | "down";
        if (!wm.swapDir(dir)) say(`nothing to swap ${dir}`);
        break;
      }
      case "ws.prev":
      case "ws.next": {
        const next = wm.active + (action === "ws.next" ? 1 : -1);
        if (next < 1 || next > WORKSPACES) say(`workspace ${wm.active} is the ${next < 1 ? "first" : "last"}`);
        else switchWs(next);
        return;
      }
      case "carry.prev":
      case "carry.next": {
        const delta = action === "carry.next" ? 1 : -1;
        const from = wm.active;
        if (wm.carryWs(delta)) {
          arrive(delta * SLIDE_PX);
          say(`carried to workspace ${wm.active}`);
        } else {
          say(wm.workspace().focus === null ? "nothing to carry" : `workspace ${from} is the ${delta < 0 ? "first" : "last"}`);
        }
        break;
      }
      case "launcher":
        setLauncherOpen(!launcherOpen());
        setKeysOpen(false);
        return;
      case "close":
        if (!close()) say("nothing to close");
        return;
      case "fullscreen":
        if (!wm.toggleFullscreen("full")) say("nothing to fill the screen with");
        break;
      case "maximize":
        if (!wm.toggleFullscreen("max")) say("nothing to maximize");
        break;
      case "split":
        if (wm.workspace().layout === "dwindle") {
          if (!wm.toggleSplit()) say("a split needs two windows");
        } else if (!wm.cycleColumnWidth()) say("no column focused");
        break;
      case "swapsplit":
        if (wm.workspace().layout === "dwindle") {
          if (!wm.swapSplit()) say("a split needs two windows");
        } else if (!wm.consumeOrExpel()) say("nothing to stack with");
        break;
      case "layout":
        toggleLayout();
        return;
      case "keys":
        setKeysOpen(!keysOpen());
        setLauncherOpen(false);
        return;
      case "another": {
        const app = focusedApp();
        if (app) open(app);
        else say("focus a window to open another of it");
        return;
      }
      case "reopen": {
        const id = wm.reopen();
        if (id === null) say("nothing to reopen");
        else {
          applets.set(id, initialState(wm.windows.get(id)!.app));
          const target = wm.placement(id)?.rect;
          if (target) enter(id, shrink(target, 0.13), 0);
        }
        break;
      }
      case "wallpaper":
        say(`wallpaper: ${nextWallpaper()}`);
        return;
      case "bar":
        wm.toggleBar();
        break;
    }
    bump();
  };

  // ---- text input ----------------------------------------------------------------

  const focusedText = (): TermState | NotesState | null => {
    const id = wm.workspace().focus;
    const state = id === null ? undefined : applets.get(id);
    return state && (state.kind === "term" || state.kind === "notes") ? state : null;
  };

  const shellApi: ShellApi = {
    apps: () => APPS,
    windows: () =>
      [...wm.windows.values()].map((w) => ({
        id: w.id,
        app: w.app,
        title: w.title,
        ws: w.ws,
        focused: wm.workspace(w.ws).focus === w.id,
      })),
    workspace: () => wm.active,
    layout: () => wm.workspace().layout,
    wallpaper: () => wallpaper(),
    uptimeSeconds,
    now: () => civilFromEpoch(Date.now(), offsetMinutes()),
    host: () => getOps().__host ?? "3ds",
    open: (app) => (APPS.includes(app as AppId) ? open(app as AppId) : null),
    close: (id) => close(id ?? wm.workspace().focus),
    focus: (id) => {
      if (!wm.windows.has(id)) return false;
      focusWin(id);
      return true;
    },
    switchWs: (id) => {
      if (!Number.isInteger(id) || id < 1 || id > WORKSPACES) return false;
      switchWs(id);
      return true;
    },
    setLayout: (kind) => {
      if (wm.workspace().layout !== kind) toggleLayout();
    },
    nextWallpaper,
    timezone: () => offsetMinutes(),
    setTimezone: (minutes) => setOffsetMinutes(minutes),
    keys: () => keySheet(wm.workspace().layout),
  };

  const termSubmit = (term: TermState) => {
    const line = term.input;
    term.lines.push(PROMPT + line);
    const out = runShell(line, shellApi);
    if (out.length === 1 && out[0] === CLEAR) term.lines = [];
    else term.lines.push(...out);
    if (term.lines.length > MAX_LINES) term.lines.splice(0, term.lines.length - MAX_LINES);
    if (line.trim()) term.history.push(line);
    term.histIdx = term.history.length;
    term.input = "";
    term.scroll = 0;
  };

  const termComplete = (term: TermState) => {
    const word = term.input.trimStart();
    if (word.includes(" ")) return;
    const matches = complete(word);
    if (matches.length === 1) term.input = matches[0] + " ";
    else if (matches.length > 1) term.lines.push(matches.join("  "));
  };

  const termHistory = (term: TermState, delta: number) => {
    const next = Math.max(0, Math.min(term.history.length, term.histIdx + delta));
    term.histIdx = next;
    term.input = next === term.history.length ? "" : term.history[next];
  };

  /** A character from the deck keyboard, into whichever text applet has focus. */
  const typeChar = (ch: string) => {
    const state = focusedText();
    if (!state) return;
    if (state.kind === "term") state.input += ch;
    else state.text += ch;
    touch(wm.workspace().focus);
  };

  const typeKey = (key: "enter" | "backspace" | "space" | "tab") => {
    const state = focusedText();
    if (!state) return;
    if (state.kind === "term") {
      if (key === "enter") termSubmit(state);
      else if (key === "backspace") state.input = state.input.slice(0, -1);
      else if (key === "space") state.input += " ";
      else termComplete(state);
    } else {
      if (key === "enter") state.text += "\n";
      else if (key === "backspace") state.text = state.text.slice(0, -1);
      else if (key === "space") state.text += " ";
      else state.text += "  ";
    }
    // A submitted command that changed the window manager bumped on its own.
    touch(wm.workspace().focus);
  };

  // ---- plain-layer buttons: the focused applet's ---------------------------------

  const plainInput = (pressed: number) => {
    // Nothing went down this frame, so nothing below can change: returning
    // here keeps an idle frame from bumping `rev` and re-running every
    // window's effects while a term or notes window has focus.
    if (pressed === 0) return;
    if (launcherOpen()) {
      let index = launcherIndex();
      if (pressed & BTN.UP) index -= 1;
      if (pressed & BTN.DOWN) index += 1;
      setLauncherIndex(Math.max(0, Math.min(MAX_MENU_INDEX, index)));
      if (pressed & BTN.CIRCLE) runMenu(launcherIndex());
      if (pressed & BTN.CROSS) setLauncherOpen(false);
      return;
    }
    if (keysOpen()) {
      if (pressed & (BTN.CROSS | BTN.SELECT | BTN.CIRCLE)) setKeysOpen(false);
      return;
    }
    if (pressed & BTN.SELECT) {
      toggleKeyboard();
      return;
    }
    const id = wm.workspace().focus;
    const state = id === null ? undefined : applets.get(id);
    if (!state) return;
    switch (state.kind) {
      case "term":
        if (pressed & BTN.CIRCLE) termSubmit(state);
        if (pressed & BTN.CROSS) state.input = state.input.slice(0, -1);
        if (pressed & BTN.TRIANGLE) termComplete(state);
        if (pressed & BTN.SQUARE) state.input += " ";
        if (pressed & BTN.UP) termHistory(state, -1);
        if (pressed & BTN.DOWN) termHistory(state, 1);
        if (pressed & BTN.START) {
          state.lines = [];
          state.scroll = 0;
        }
        break;
      case "notes":
        if (pressed & BTN.CIRCLE) state.text += "\n";
        if (pressed & BTN.CROSS) state.text = state.text.slice(0, -1);
        if (pressed & BTN.SQUARE) state.text += " ";
        break;
      default:
        return;
    }
    touch(id);
  };

  const scrollApplet = (lines: number) => {
    const id = wm.workspace().focus;
    const state = id === null ? undefined : applets.get(id);
    if (!state) return;
    if (state.kind === "term" || state.kind === "notes") {
      state.scroll = Math.max(0, state.scroll + lines);
      touch(id);
    }
  };

  // ---- the frame -------------------------------------------------------------------

  let scrollCarry = 0;

  onFrame((buttons) => {
    frames++;

    // Wall clock, once a second.
    const nowSecond = Math.floor(Date.now() / 1000);
    if (nowSecond !== lastSecond) {
      lastSecond = nowSecond;
      setEpochSecond(nowSecond);
      const stamp = Date.now();
      if (fpsStamp > 0) {
        const sample = Math.round((fpsFrames * 1000) / Math.max(1, stamp - fpsStamp));
        setFps(sample);
        const head = fpsHead();
        fpsSlots[head][1](sample);
        setFpsHead((head + 1) % FPS_SLOTS);
      }
      fpsStamp = stamp;
      fpsFrames = 0;
    }
    fpsFrames++;

    const held = buttons | (latchL() ? BTN.LTRIGGER : 0) | (latchR() ? BTN.RTRIGGER : 0);
    const currentLayer = layerOf(held);
    if (currentLayer !== layer()) setLayer(currentLayer);
    const pressed = buttons & ~prevButtons;
    prevButtons = buttons;

    let consumed = false;
    if (currentLayer === "plain") {
      plainInput(pressed);
    } else {
      for (const chord of chordsOf(currentLayer)) {
        if (pressed & chord.button) {
          run(chord.action);
          consumed = true;
        }
      }
    }
    if (consumed && (latchL() || latchR())) {
      setLatchL(false);
      setLatchR(false);
    }

    // The circle pad: resize under L, pan the strip under R, scroll the applet plain.
    const ax = analogX();
    const ay = analogY();
    const px = Math.abs(ax) > DEAD_ZONE ? ax : 0;
    const py = Math.abs(ay) > DEAD_ZONE ? ay : 0;
    if (px !== 0 || py !== 0) {
      if (currentLayer === "super") {
        wm.resize(px * RESIZE_PX, py * RESIZE_PX);
        bump();
      } else if (currentLayer === "shift") {
        if (wm.workspace().layout === "scrolling" && px !== 0) {
          wm.scrollBy(px * SCROLL_PX);
          bump();
        }
      } else if (currentLayer === "plain" && py !== 0) {
        scrollCarry += -py * 0.4;
        const lines = Math.trunc(scrollCarry);
        if (lines !== 0) {
          scrollCarry -= lines;
          scrollApplet(lines);
        }
      }
    } else {
      scrollCarry = 0;
    }

  });

  return {
    wm,
    rev,
    frameCount,
    epochSecond,
    now,
    fps,
    fpsSlot: (i: number) => fpsSlots[i][0](),
    fpsHead,
    uptimeSeconds,
    layer,
    latchL,
    setLatchL,
    latchR,
    setLatchR,
    launcherOpen,
    setLauncherOpen,
    launcherIndex,
    setLauncherIndex,
    keysOpen,
    setKeysOpen,
    kbOpen,
    setKbOpen,
    kbVisible,
    kbLayer,
    setKbLayer,
    wallpaper,
    offsetMinutes,
    toast,
    say,
    bindToastBar,
    runMenu,
    drag,
    setDrag,
    closing,
    setClosing,
    closeBarShown,
    bindCloseBar,
    active,
    workspace,
    layoutKind,
    barVisible,
    placements,
    placementOf,
    order,
    focusedId,
    focusedApp,
    counts,
    openApps,
    appletRev,
    windowOf,
    stateOf,
    bindWindow,
    unbindWindow,
    ghosts,
    bindGhost,
    open,
    close,
    focusWin,
    switchWs,
    toggleLayout,
    toggleKeyboard,
    run,
    typeChar,
    typeKey,
    bump,
  };
}
