// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/state.ts — compositor state: window controls, popups, desktop
// icons. Hot geometry lives in per-window refs so a drag re-evaluates one
// window's style binding, not the world; the window LIST only changes on
// open/close (a reorder would rebuild the layout tree — z rides zIndex).

import { createState, type State } from "./reactivity.ts";
import type { CaptionButton, Geo } from "./wm.ts";
import type { FolderTool, IconName } from "./theme.ts";
import type { Doc, History, VSeg } from "./notepad.ts";
import type { Mines } from "./mines.ts";
import type { PocketAppSpec } from "./pocket-apps.ts";

export type WinKind =
  "notepad" | "mines" | "folder" | "pocket" | "about" | "shutdown" | "devices";

export interface MenuDef {
  label: string;
  /** Hit width in px (measured at open — mirrors the render's px-[6] pads). */
  width: number;
  /** Built at open — disabled states follow live state (selection, …). */
  items: () => PopupItem[];
}

export interface PopupItem {
  label: string;
  /** Semantic icon; the active theme resolves the artwork at paint time. */
  icon?: IconName;
  shortcut?: string;
  disabled?: boolean;
  /** Toggle state — renders a checkmark in the icon slot. */
  checked?: boolean;
  sep?: boolean;
  sub?: PopupItem[];
  act?: () => void;
  /** Start-panel placement (the XP two-column layout reads these; the
   *  Classic single-column panel ignores them). `right` moves the row into
   *  the places column, `bottom` pins it under the programs column, `foot`
   *  puts it in the blue strip along the bottom of the panel. */
  col?: "right";
  bottom?: boolean;
  foot?: boolean;
}

export interface Popup {
  x: number;
  y: number;
  w: number;
  items: PopupItem[];
}

export interface WinCtl {
  id: number;
  kind: WinKind;
  /** Reactive: a folder window renames itself as it navigates. */
  title: State<string>;
  /** Semantic icon; the active theme resolves the artwork at paint time. */
  icon: State<IconName>;
  buttons: readonly CaptionButton[];
  resizable: boolean;
  minW: number;
  minH: number;
  menus: MenuDef[] | null;
  geo: State<Geo>;
  z: State<number>;
  minimized: State<boolean>;
  maximized: State<boolean>;
  /** Geometry to restore on un-maximize. */
  restoreGeo: Geo | null;
  pressedBtn: State<CaptionButton | null>;
  /** Pointer over the caption's control cluster (Aqua reveals glyphs). */
  captionHover: State<boolean>;
  /** Open menu-bar index, -1 closed. */
  openMenu: State<number>;
  /** Program-specific state bag (PadData, MinesData, …). */
  data: unknown;
}

// Program state bags. Solid signals retain each window's independently owned state.

export interface PadData {
  kind: "notepad";
  doc: State<Doc>;
  scroll: State<number>;
  preedit: State<{ s: string; c: number } | null>;
  /** Word wrap (Edit menu toggle): reflow to the window width. */
  wrap: State<boolean>;
  /** Undo/redo snapshots (notepad.ts History). Plain field: nothing renders
   *  from it — the Edit/context menus read it when they build their items. */
  hist: History;
  layout: State<{
    status: "pending" | "ready" | "error" | "companion-required";
    lines: string[]; rows: VSeg[]; width: number; slot: number; error?: string;
  }>;
}

export interface MinesData {
  kind: "mines";
  /** Mutated in place by mines.ts rules — publish through an always-notifying Solid signal. */
  board: State<Mines>;
  /** Cell index held by the primary button, -1 none. */
  held: State<number>;
  smileyHeld: State<boolean>;
  /** Seconds shown by the timer (app.tsx advances it while playing). */
  elapsed: State<number>;
}

export interface FolderRow {
  icon: IconName;
  name: string;
  size: string;
  type: string;
  open?: () => void;
}

/** The places every file-manager window lists in its sidebar and navigates
 *  among in place (the same window renames and refills itself). */
export type PlaceId = "computer" | "drivec" | "documents" | "recycle";

export interface Place {
  id: PlaceId;
  label: string;
  icon: IconName;
}

export const PLACES: readonly Place[] = [
  { id: "computer", label: "My Computer", icon: "computer" },
  { id: "drivec", label: "(C:)", icon: "drive" },
  { id: "documents", label: "My Documents", icon: "documents" },
  { id: "recycle", label: "Recycle Bin", icon: "recycle" },
];

/** The macOS file browser presents the shell's own sample folders and apps. */
export const MAC_PLACES: readonly Place[] = [
  { id: "computer", label: "Pocket Shell", icon: "computer" },
  { id: "drivec", label: "Applications", icon: "folder" },
  { id: "documents", label: "Documents", icon: "documents" },
  { id: "recycle", label: "Trash", icon: "recycle" },
];

export interface FolderData {
  kind: "folder";
  places: readonly Place[];
  place: State<PlaceId>;
  rows: State<FolderRow[]>;
  selected: State<number>;
  /** Navigation history: visited places and the cursor into them. */
  hist: State<{ items: PlaceId[]; at: number }>;
  /** Toolbar button held by the primary button, null none. */
  toolHeld: State<FolderTool | null>;
}

export interface PocketData {
  kind: "pocket";
  app: PocketAppSpec;
}

export interface AboutData {
  kind: "about";
  armed: State<string | null>;
}

export interface ShutdownData {
  kind: "shutdown";
  choice: State<number>;
  armed: State<string | null>;
}

export interface TaskEntry {
  id: number;
  title: string;
  icon: IconName;
}

export interface DeskIcon {
  icon: IconName;
  label: string;
  open: () => void;
}

let nextId = 1;

export function createWin(spec: {
  kind: WinKind;
  title: string;
  icon: IconName;
  geo: Geo;
  buttons?: readonly CaptionButton[];
  resizable?: boolean;
  minW?: number;
  minH?: number;
  menus?: MenuDef[] | null;
  data?: unknown;
}): WinCtl {
  return {
    id: nextId++,
    kind: spec.kind,
    title: createState(spec.title),
    icon: createState<IconName>(spec.icon),
    buttons: spec.buttons ?? ["min", "max", "close"],
    resizable: spec.resizable ?? true,
    minW: spec.minW ?? 200,
    minH: spec.minH ?? 120,
    menus: spec.menus ?? null,
    geo: createState<Geo>(spec.geo),
    z: createState(0),
    minimized: createState(false),
    maximized: createState(false),
    restoreGeo: null,
    pressedBtn: createState<CaptionButton | null>(null),
    captionHover: createState(false),
    openMenu: createState(-1),
    data: spec.data,
  };
}
