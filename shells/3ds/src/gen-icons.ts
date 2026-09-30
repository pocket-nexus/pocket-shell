// SPDX-License-Identifier: GPL-3.0-or-later
// src/gen-icons.ts — the deck's icons, drawn as 16×16 pixel art and written
// to src/icons/ as PNGs (ignored; regenerated before every guest build).
//
// Omarchy draws its bar and menus with monochrome Material Design glyphs at
// about a 1 px stroke. A 16 px glyph from a font is resampled onto this panel
// and turns soft, so these are drawn on the pixel grid instead: 1 px lines,
// no antialiasing. The core cannot tint an image, so each icon is written in
// the three colors the deck paints it with.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

export const ICON_SIZE = 16;

/** fg: resting; accent: active or selected; ink: on an accent fill. */
export const ICON_TONES = { fg: 0xa9b1d6, accent: 0x7aa2f7, ink: 0x1a1b26 } as const;
export type IconTone = keyof typeof ICON_TONES;

class Grid {
  readonly on = new Uint8Array(ICON_SIZE * ICON_SIZE);
  px(x: number, y: number): void {
    if (x >= 0 && y >= 0 && x < ICON_SIZE && y < ICON_SIZE) this.on[y * ICON_SIZE + x] = 1;
  }
  line(x0: number, y0: number, x1: number, y1: number): void {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  path(...points: [number, number][]): void {
    for (let i = 1; i < points.length; i++) this.line(...points[i - 1], ...points[i]);
  }
  /** Outline of a w×h box; `round` leaves the four corner pixels off. */
  box(x: number, y: number, w: number, h: number, round = false): void {
    const r = round ? 1 : 0;
    this.line(x + r, y, x + w - 1 - r, y);
    this.line(x + r, y + h - 1, x + w - 1 - r, y + h - 1);
    this.line(x, y + r, x, y + h - 1 - r);
    this.line(x + w - 1, y + r, x + w - 1, y + h - 1 - r);
  }
  fill(x: number, y: number, w: number, h: number, round = false): void {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const corner = (i === 0 || i === w - 1) && (j === 0 || j === h - 1);
        if (!(round && corner)) this.px(x + i, y + j);
      }
    }
  }
  /** A 1 px ring: pixel centers within half a pixel of radius `r`. */
  ring(cx: number, cy: number, r: number): void {
    for (let y = 0; y < ICON_SIZE; y++) {
      for (let x = 0; x < ICON_SIZE; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d >= r - 0.5 && d < r + 0.5) this.px(x, y);
      }
    }
  }
}

/** One definition per icon, in the Material Design shapes Omarchy uses. */
export const ICONS = {
  /** md-view-grid-outline: the menu. */
  menu: (g: Grid) => {
    for (const x of [1, 9]) for (const y of [1, 9]) g.box(x, y, 6, 6, true);
  },
  /** md-console: a window with a prompt. */
  term: (g: Grid) => {
    g.box(0, 1, 16, 14, true);
    g.line(1, 3, 14, 3);
    g.path([4, 6], [7, 9], [4, 12]);
    g.line(9, 12, 12, 12);
  },
  /** md-note-text-outline: a page with a folded corner. */
  notes: (g: Grid) => {
    g.line(2, 0, 9, 0);
    g.line(9, 0, 13, 4);
    g.line(13, 4, 13, 15);
    g.line(2, 15, 13, 15);
    g.line(2, 0, 2, 15);
    g.path([9, 1], [9, 4], [12, 4]);
    g.line(5, 7, 10, 7);
    g.line(5, 10, 10, 10);
    g.line(5, 13, 8, 13);
  },
  /** md-pulse: the activity monitor. */
  top: (g: Grid) => {
    g.path([0, 9], [3, 9], [5, 4], [8, 14], [10, 6], [12, 9], [15, 9]);
  },
  /** md-keyboard-outline: the touch keyboard. */
  kbd: (g: Grid) => {
    g.box(0, 3, 16, 11, true);
    for (const x of [3, 6, 9, 12]) {
      g.px(x, 6);
      g.px(x, 8);
    }
    g.line(5, 11, 10, 11);
  },
  /** md-help-circle-outline: the key sheet. */
  keys: (g: Grid) => {
    g.ring(8, 8, 7);
    g.path([6, 5], [7, 4], [9, 4], [10, 5], [10, 6], [8, 8], [8, 9]);
    g.px(8, 11);
  },
  /** md-image-outline: the wallpaper. */
  wall: (g: Grid) => {
    g.box(0, 2, 16, 12, true);
    g.path([1, 11], [5, 7], [8, 10], [10, 8], [14, 12]);
    g.fill(10, 4, 2, 2);
  },
  /** md-dock-top: the top bar. */
  bar: (g: Grid) => {
    g.box(0, 2, 16, 12, true);
    g.fill(1, 3, 14, 3);
  },
  /** The dwindle layout: one leaf, then the other half split again. */
  dwindle: (g: Grid) => {
    g.box(0, 2, 16, 12, true);
    g.line(7, 3, 7, 12);
    g.line(8, 7, 14, 7);
  },
  /** The scrolling layout: columns on a strip wider than the screen. */
  scrolling: (g: Grid) => {
    g.box(0, 2, 6, 12, true);
    g.box(7, 2, 6, 12, true);
    g.line(14, 2, 15, 2);
    g.line(14, 13, 15, 13);
    g.line(14, 3, 14, 12);
  },
} satisfies Record<string, (g: Grid) => void>;
export type IconName = keyof typeof ICONS;

export function drawIcon(name: IconName): Uint8Array {
  const g = new Grid();
  ICONS[name](g);
  return g.on;
}

/** `icons/<name>-<tone>.png`, the path the guest and images.json use. */
export const iconPath = (name: IconName, tone: IconTone): string => `icons/${name}-${tone}.png`;

function png(mask: Uint8Array, rgb: number): Uint8Array {
  const n = ICON_SIZE;
  const raw = new Uint8Array(n * (n * 4 + 1));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const o = y * (n * 4 + 1) + 1 + x * 4;
      raw[o] = (rgb >> 16) & 0xff;
      raw[o + 1] = (rgb >> 8) & 0xff;
      raw[o + 2] = rgb & 0xff;
      raw[o + 3] = mask[y * n + x] ? 0xff : 0;
    }
  }
  const table = new Uint32Array(256).map((_, k) => {
    let c = k;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, n);
  view.setUint32(4, n);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Replace src/icons/ with every icon in every tone. */
export function writeIcons(srcDir = import.meta.dir): number {
  const dir = resolve(srcDir, "icons");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let count = 0;
  for (const name of Object.keys(ICONS) as IconName[]) {
    const mask = drawIcon(name);
    for (const tone of Object.keys(ICON_TONES) as IconTone[]) {
      writeFileSync(resolve(srcDir, iconPath(name, tone)), png(mask, ICON_TONES[tone]));
      count++;
    }
  }
  return count;
}

if (import.meta.main) console.log(`pocket-shell: ${writeIcons()} icons in src/icons/`);
