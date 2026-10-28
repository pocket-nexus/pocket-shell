// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/home/layout.ts — where each icon sits on the Home screen: pages
// of up to PER_PAGE icons and a dock of up to DOCK_MAX, as iOS SpringBoard
// keeps them, and where that order is kept between boots.
//
// A page holds PER_PAGE icons on the 3DS; a taller surface holds more, and
// the functions that fill pages take the page size.
//
// An icon is a key: "dock:settings" and "dock:mac" for Home's own pages,
// "app:<output>" for an installed applet. The model is pure (tests import it
// directly); the springboard holds the live copy in a signal.
//
// A saved layout is reconciled against what is installed on every read:
// keys of removed applets drop out, empty pages close up, and an applet the
// layout has not seen goes to its default place (Camera and Photos to the
// dock while it has room, everything else to the first page with room).
//
// Storage is the fs module (contracts/spec/fs.ts, capability data.fs, an
// enhancement in home/pocket.json): one small JSON file in Home's data root.
// A host without it keeps the order for the session only.

import { existsSync, readFileSync, writeFileSync } from "@pocketjs/framework/fs";

export const COLS = 4;
export const ROWS = 2;
export const PER_PAGE = COLS * ROWS;
export const DOCK_MAX = 4;

export const SETTINGS_KEY = "dock:settings";
export const MAC_KEY = "dock:mac";
export const CAMERA_KEY = "app:camera-main";
export const PHOTOS_KEY = "app:photos-main";
/** The dock's default order; an absent applet's place stays free. */
export const DEFAULT_DOCK = [SETTINGS_KEY, CAMERA_KEY, PHOTOS_KEY, MAC_KEY] as const;

export interface HomeLayout {
  pages: string[][];
  dock: string[];
}

/** Where a key is: a grid page and slot, or the dock. */
export type Place = { at: "grid"; page: number; slot: number } | { at: "dock"; slot: number };

export const appKey = (output: string) => `app:${output}`;

/** The layout for `keys` (every icon there is) from a saved one, if any. */
export function reconcile(saved: HomeLayout | null, keys: readonly string[], perPage = PER_PAGE): HomeLayout {
  const valid = new Set(keys);
  const placed = new Set<string>();
  const keep = (key: string) => {
    if (!valid.has(key) || placed.has(key)) return false;
    placed.add(key);
    return true;
  };
  const dock = (saved?.dock ?? []).filter(keep).slice(0, DOCK_MAX);
  const pages = (saved?.pages ?? []).map((page) => page.filter(keep).slice(0, perPage)).filter((page) => page.length > 0);
  // Home's own pages and the dock's applets go to the dock while it has
  // room, in their default order; everything else fills pages in install
  // order.
  for (const key of DEFAULT_DOCK) {
    if (!valid.has(key) || placed.has(key) || dock.length >= DOCK_MAX) continue;
    const order = DEFAULT_DOCK.indexOf(key);
    const at = dock.findIndex((other) => DEFAULT_DOCK.indexOf(other as (typeof DEFAULT_DOCK)[number]) > order);
    dock.splice(at < 0 ? dock.length : at, 0, key);
    placed.add(key);
  }
  for (const key of keys) {
    if (placed.has(key)) continue;
    placed.add(key);
    const open = pages.find((page) => page.length < perPage);
    if (open) open.push(key);
    else pages.push([key]);
  }
  if (pages.length === 0) pages.push([]);
  return { pages, dock };
}

export function placeOf(layout: HomeLayout, key: string): Place | null {
  const dock = layout.dock.indexOf(key);
  if (dock >= 0) return { at: "dock", slot: dock };
  for (let page = 0; page < layout.pages.length; page++) {
    const slot = layout.pages[page]!.indexOf(key);
    if (slot >= 0) return { at: "grid", page, slot };
  }
  return null;
}

/** `layout` without `key`; its page keeps its place even when emptied, so a
 *  drag that lifts a page's only icon can still drop it back there. */
export function lift(layout: HomeLayout, key: string): HomeLayout {
  return { pages: layout.pages.map((page) => page.filter((other) => other !== key)), dock: layout.dock.filter((other) => other !== key) };
}

/** `lifted` (from `lift`) with `key` dropped at `place`. A full page pushes
 *  its last icon on to the next page, as SpringBoard does; a full dock takes
 *  nothing and the result is null. A page index one past the last opens a
 *  new page. */
export function drop(lifted: HomeLayout, key: string, place: Place, perPage = PER_PAGE): HomeLayout | null {
  const pages = lifted.pages.map((page) => [...page]);
  const dock = [...lifted.dock];
  if (place.at === "dock") {
    if (dock.length >= DOCK_MAX) return null;
    dock.splice(Math.max(0, Math.min(place.slot, dock.length)), 0, key);
    return { pages, dock };
  }
  while (pages.length <= place.page) pages.push([]);
  let carry: string | undefined = key;
  for (let page = place.page; carry !== undefined; page++) {
    if (page >= pages.length) pages.push([]);
    const list = pages[page]!;
    list.splice(page === place.page ? Math.max(0, Math.min(place.slot, list.length)) : 0, 0, carry);
    carry = list.length > perPage ? list.pop() : undefined;
  }
  return { pages, dock };
}

/** Empty pages close up; one page always remains. */
export function tidy(layout: HomeLayout): HomeLayout {
  const pages = layout.pages.filter((page) => page.length > 0);
  return { pages: pages.length > 0 ? pages : [[]], dock: layout.dock };
}

export function sameLayout(a: HomeLayout, b: HomeLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- storage ------------------------------------------------------------------

const FILE = "home-layout.json";

/** True where the host mounts the fs module. */
export function canStore(): boolean {
  return typeof (globalThis as { fs?: unknown }).fs === "object" && (globalThis as { fs?: unknown }).fs !== null;
}

export function loadLayout(): HomeLayout | null {
  if (!canStore()) return null;
  try {
    if (!existsSync(FILE)) return null;
    const parsed = JSON.parse(readFileSync(FILE, "utf8") as string) as Partial<HomeLayout> & { v?: number };
    if (parsed.v !== 1 || !Array.isArray(parsed.pages) || !Array.isArray(parsed.dock)) return null;
    const strings = (list: unknown) => (Array.isArray(list) ? list.filter((key): key is string => typeof key === "string") : []);
    return { pages: parsed.pages.map(strings), dock: strings(parsed.dock) };
  } catch {
    return null;
  }
}

export function saveLayout(layout: HomeLayout): boolean {
  if (!canStore()) return false;
  try {
    writeFileSync(FILE, JSON.stringify({ v: 1, pages: layout.pages, dock: layout.dock }));
    return true;
  } catch {
    return false;
  }
}
