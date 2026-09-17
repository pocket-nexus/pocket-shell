// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/gen-icons.ts — pixel-art icon source. ASCII grids compile to
// crispEdges SVGs in src/system-ui/icons/ (ignored; rebuilt before packaging):
//
//   bun src/system-ui/gen-icons.ts
//
// One 16×16 grid per subject; desktop icons emit a second 32px file scaled
// 2× so both stay one art. Caption glyphs and tiny hud art carry their own
// grids at native size. Luna's caption glyphs and the whole Aqua set are
// drawn vectors (filled paths, circles and rects — the subset bake-svg
// rasterizes) further down. The build then rasterizes each SVG at the plan's
// density like any other vector asset. Offline Blender application bakes
// are copied into the same output directory below.

import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const PAL: Record<string, string> = {
  k: "#000000",
  w: "#ffffff",
  g: "#c0c0c0",
  d: "#808080",
  e: "#dfdfdf",
  y: "#fcd116",
  Y: "#fcf080",
  b: "#000080",
  B: "#1084d0",
  r: "#ff0000",
  R: "#800000",
  t: "#008080",
  G: "#008000",
  o: "#ff8000",
  s: "#ffd800", // smiley yellow
};

interface Icon {
  file: string;
  rows: string[];
  /** Also emit a 32px desktop icon under this name: from `bigRows` when the
   *  subject has its own 32×32 art, else the 16px grid scaled 2×. */
  big?: string;
  bigRows?: string[];
}

// ---------------------------------------------------------------------------
// Pixel canvas: the 32×32 Classic desktop icons are drawn with rectangles,
// lines and discs instead of hand-typed grids (ragged rows were the failure
// mode of the 16px set).
// ---------------------------------------------------------------------------

type Grid = string[][];

function grid(n: number): Grid {
  return Array.from({ length: n }, () => Array<string>(n).fill("."));
}
function put(g: Grid, x: number, y: number, ch: string): void {
  if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = ch;
}
function fillRect(g: Grid, x: number, y: number, w: number, h: number, ch: string): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(g, xx, yy, ch);
}
function strokeRect(g: Grid, x: number, y: number, w: number, h: number, ch: string): void {
  fillRect(g, x, y, w, 1, ch);
  fillRect(g, x, y + h - 1, w, 1, ch);
  fillRect(g, x, y, 1, h, ch);
  fillRect(g, x + w - 1, y, 1, h, ch);
}
function line(g: Grid, x0: number, y0: number, x1: number, y1: number, ch: string): void {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    put(g, x, y, ch);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}
function disc(g: Grid, cx: number, cy: number, r: number, ch: string): void {
  for (let y = 0; y < g.length; y++)
    for (let x = 0; x < g[0].length; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(g, x, y, ch);
}
/** Classic raised bevel around (x, y, w, h): white top/left, dark bottom/right. */
function bevel(g: Grid, x: number, y: number, w: number, h: number, t = 1): void {
  for (let i = 0; i < t; i++) {
    fillRect(g, x + i, y + i, w - i * 2, 1, "w");
    fillRect(g, x + i, y + i, 1, h - i * 2, "w");
    fillRect(g, x + i, y + h - 1 - i, w - i * 2, 1, "d");
    fillRect(g, x + w - 1 - i, y + i, 1, h - i * 2, "d");
  }
}
const rowsOf = (g: Grid): string[] => g.map((r) => r.join(""));

/** My Computer: a beige monitor with a navy screen on a desktop case. */
function computer32(): string[] {
  const g = grid(32);
  // Monitor.
  strokeRect(g, 5, 0, 22, 20, "k");
  fillRect(g, 6, 1, 20, 18, "g");
  bevel(g, 6, 1, 20, 18);
  strokeRect(g, 8, 3, 16, 13, "k");
  fillRect(g, 9, 4, 14, 11, "b");
  fillRect(g, 10, 5, 5, 1, "B");
  fillRect(g, 10, 6, 3, 1, "B");
  fillRect(g, 10, 7, 1, 2, "B");
  put(g, 10, 5, "w");
  // Neck.
  fillRect(g, 12, 20, 8, 2, "k");
  fillRect(g, 13, 20, 6, 1, "d");
  // Case.
  strokeRect(g, 2, 22, 28, 8, "k");
  fillRect(g, 3, 23, 26, 6, "g");
  bevel(g, 3, 23, 26, 6);
  fillRect(g, 6, 25, 10, 1, "k");
  fillRect(g, 6, 26, 10, 1, "d");
  fillRect(g, 19, 25, 2, 2, "d");
  fillRect(g, 24, 26, 2, 1, "G");
  fillRect(g, 3, 30, 28, 1, "d");
  return rowsOf(g);
}

/** My Documents: the two-tone folder with a sheet tucked behind the flap. */
function documents32(): string[] {
  const g = grid(32);
  // Back panel with its tab.
  strokeRect(g, 1, 5, 12, 5, "k");
  fillRect(g, 2, 6, 10, 3, "y");
  strokeRect(g, 1, 8, 29, 20, "k");
  fillRect(g, 2, 9, 27, 18, "y");
  // Sheet.
  strokeRect(g, 7, 1, 16, 12, "k");
  fillRect(g, 8, 2, 14, 10, "w");
  fillRect(g, 10, 4, 9, 1, "d");
  fillRect(g, 10, 6, 7, 1, "d");
  fillRect(g, 10, 8, 9, 1, "d");
  // Front flap.
  strokeRect(g, 1, 13, 29, 15, "k");
  fillRect(g, 2, 14, 27, 13, "y");
  fillRect(g, 2, 14, 27, 1, "Y");
  fillRect(g, 2, 14, 1, 12, "Y");
  fillRect(g, 3, 26, 26, 1, "o");
  fillRect(g, 28, 15, 1, 12, "o");
  return rowsOf(g);
}

/** Recycle Bin: a ribbed gray basket, lid and handle, green recycle ring. */
function recycle32(): string[] {
  const g = grid(32);
  // Handle + lid.
  fillRect(g, 13, 2, 6, 2, "k");
  fillRect(g, 14, 3, 4, 1, "g");
  strokeRect(g, 3, 4, 26, 5, "k");
  fillRect(g, 4, 5, 24, 3, "g");
  fillRect(g, 4, 5, 24, 1, "w");
  fillRect(g, 4, 7, 24, 1, "d");
  // Tapering body.
  for (let y = 9; y <= 29; y++) {
    const inset = Math.floor((y - 9) / 7);
    const x0 = 5 + inset;
    const x1 = 26 - inset;
    put(g, x0, y, "k");
    put(g, x1, y, "k");
    for (let x = x0 + 1; x < x1; x++) put(g, x, y, "e");
    // Ribs.
    for (let x = x0 + 3; x < x1 - 1; x += 4) put(g, x, y, "g");
  }
  fillRect(g, 8, 29, 16, 1, "k");
  fillRect(g, 9, 30, 14, 1, "k");
  // Recycle ring: three chevrons around the middle.
  line(g, 16, 13, 10, 23, "G");
  line(g, 17, 13, 11, 23, "G");
  line(g, 16, 13, 22, 23, "G");
  line(g, 15, 13, 21, 23, "G");
  fillRect(g, 11, 23, 11, 2, "G");
  put(g, 16, 11, "G");
  put(g, 9, 24, "G");
  put(g, 23, 24, "G");
  return rowsOf(g);
}

/** Notepad: spiral rings over a ruled white pad with a curled corner. */
function notepad32(): string[] {
  const g = grid(32);
  strokeRect(g, 3, 3, 26, 28, "k");
  fillRect(g, 4, 4, 24, 26, "w");
  for (let x = 6; x <= 26; x += 4) {
    fillRect(g, x, 0, 2, 5, "k");
    put(g, x, 1, "d");
    put(g, x + 1, 1, "d");
  }
  fillRect(g, 4, 6, 24, 1, "d");
  const lens = [18, 14, 20, 10, 17];
  for (let i = 0; i < lens.length; i++) fillRect(g, 7, 10 + i * 4, lens[i], 1, "k");
  // Curled corner.
  fillRect(g, 24, 26, 4, 4, "d");
  line(g, 23, 30, 27, 26, "k");
  put(g, 27, 26, "w");
  put(g, 24, 29, "w");
  put(g, 25, 28, "w");
  put(g, 26, 27, "w");
  return rowsOf(g);
}

/** Minesweeper: one raised field cell holding a mine. */
function mines32(): string[] {
  const g = grid(32);
  fillRect(g, 0, 0, 32, 32, "g");
  bevel(g, 0, 0, 32, 32, 3);
  disc(g, 16, 17, 7.3, "k");
  fillRect(g, 16, 5, 1, 24, "k");
  fillRect(g, 4, 17, 24, 1, "k");
  line(g, 8, 9, 24, 25, "k");
  line(g, 24, 9, 8, 25, "k");
  fillRect(g, 12, 13, 3, 3, "w");
  put(g, 14, 15, "k");
  return rowsOf(g);
}

function svgFor(rows: string[], scale: number): string {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  for (const r of rows) {
    if (r.length !== w) throw new Error(`gen-icons: ragged grid (row "${r}" vs width ${w})`);
  }
  const byColor = new Map<string, string[]>();
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === "." || ch === " ") {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      const color = PAL[ch];
      if (!color) throw new Error(`gen-icons: unknown palette char '${ch}'`);
      const d = byColor.get(color) ?? [];
      d.push(`M${x * scale} ${y * scale}h${run * scale}v${scale}h${-run * scale}z`);
      byColor.set(color, d);
      x += run;
    }
  }
  const paths = [...byColor.entries()]
    .map(([color, ds]) => `<path fill="${color}" d="${ds.join("")}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w * scale} ${h * scale}" shape-rendering="crispEdges">${paths}</svg>\n`;
}

const ICONS: Icon[] = [
  {
    // My Computer: a CRT over a slim base, navy screen with a sky glint.
    file: "computer-16.svg",
    big: "computer.svg",
    bigRows: computer32(),
    rows: [
      "................",
      ".kkkkkkkkkkkkk..",
      ".kggggggggggkk..",
      ".kgkkkkkkkkgkk..",
      ".kgkbbbbbbkgkk..",
      ".kgkbBBbbbkgkk..",
      ".kgkbBbbbbkgkk..",
      ".kgkbbbbbbkgkk..",
      ".kgkkkkkkkkgkk..",
      ".kggggggggggkk..",
      ".kkkkkkkkkkkkk..",
      "......kggk......",
      "....kkggggkk....",
      "..kggggggggggk..",
      "..kggkkkkkkggk..",
      "..kkkkkkkkkkkk..",
    ],
  },
  {
    // My Documents: the two-tone yellow folder with a paper peeking out.
    file: "folder-16.svg",
    big: "documents.svg",
    bigRows: documents32(),
    rows: [
      "................",
      "................",
      ".kkkkk..........",
      "kYYYYYkkkkkkkk..",
      "kYYYYYYYYYYYYk..",
      "kYwwwwwwwwwwYk..",
      "kYwkkkwwkkwwYk..",
      "kkkkkkkkkkkkkkk.",
      "kyyyyyyyyyyyyyk.",
      "kyYYYYYYYYYYYyk.",
      "kyyyyyyyyyyyyyk.",
      "kyyyyyyyyyyyyyk.",
      "kyyyyyyyyyyyyyk.",
      "kkkkkkkkkkkkkkk.",
      "................",
      "................",
    ],
  },
  {
    // Recycle Bin: gray basket, dark lid, recycle chevrons.
    file: "recycle-16.svg",
    big: "recycle.svg",
    bigRows: recycle32(),
    rows: [
      "................",
      "......kkkk......",
      "....kkggggkk....",
      "..kkggggggggkk..",
      ".kddddddddddddk.",
      ".kddddddddddddk.",
      "..kggggggggggk..",
      "..kgGGggggGGgk..",
      "..kgGgggggGggk..",
      "..kggGGgGGgggk..",
      "..kgggGGGggggk..",
      "..kggggGgggggk..",
      "..kggggggggggk..",
      "...kggggggggk...",
      "...kkkkkkkkkk...",
      "................",
    ],
  },
  {
    // Notepad: spiral pad, ruled lines.
    file: "notepad-16.svg",
    big: "notepad.svg",
    bigRows: notepad32(),
    rows: [
      "................",
      "..kdkdkdkdkdk...",
      ".kwwwwwwwwwwwk..",
      ".kwwwwwwwwwwwk..",
      ".kwkkkkkkkkwwk..",
      ".kwwwwwwwwwwwk..",
      ".kwkkkkkkwwwwk..",
      ".kwwwwwwwwwwwk..",
      ".kwkkkkkkkwwwk..",
      ".kwwwwwwwwwwwk..",
      ".kwkkkkwwwwwwk..",
      ".kwwwwwwwwwwwk..",
      ".kwwwwwwwwwwwk..",
      ".kkkkkkkkkkkkk..",
      "................",
      "................",
    ],
  },
  {
    // Minesweeper: a raised cell with a mine.
    file: "mines-16.svg",
    big: "mines.svg",
    bigRows: mines32(),
    rows: [
      "wwwwwwwwwwwwwwwd",
      "wggggggggggggggd",
      "wgggggggkggggggd",
      "wgggkggkkkggkggd",
      "wggggkkkkkkkgggd",
      "wgggkkkwwkkkkggd",
      "wgggkkwwkkkkkggd",
      "wgkkkkwwkkkkkkgd",
      "wgggkkkkkkkkkggd",
      "wgggkkkkkkkkkggd",
      "wggggkkkkkkkgggd",
      "wgggkggkkkggkggd",
      "wgggggggkggggggd",
      "wggggggggggggggd",
      "wggggggggggggggd",
      "dddddddddddddddd",
    ],
  },
  {
    // Local disk.
    file: "drive-16.svg",
    rows: [
      "................",
      "................",
      "................",
      "................",
      ".kkkkkkkkkkkkkk.",
      ".kggggggggggggk.",
      ".keeeeeeeeeeegk.",
      ".kggggggggggggk.",
      ".kgggggggggkgGk.",
      ".kkkkkkkkkkkkkk.",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
    ],
  },
  {
    // CD-ROM drive: a disc.
    file: "cdrom-16.svg",
    rows: [
      "................",
      "................",
      ".....kkkkkk.....",
      "...kkeeeeeekk...",
      "..keeeeeeeeeek..",
      "..keeewwweeeek..",
      ".keeewgggweeeek.",
      ".keewggkggweeek.",
      ".keewgkwkgweeek.",
      ".keewggkggweeek.",
      ".keeewgggweeeek.",
      "..keeewwweeeek..",
      "..keeeeeeeeeek..",
      "...kkeeeeeekk...",
      ".....kkkkkk.....",
      "................",
    ],
  },
  {
    // Plain document.
    file: "file-16.svg",
    rows: [
      "................",
      "..kkkkkkkkk.....",
      "..kwwwwwwwkk....",
      "..kwwwwwwwkgk...",
      "..kwwwwwwwkkkk..",
      "..kwkkkkkwwwwk..",
      "..kwwwwwwwwwwk..",
      "..kwkkkkkkkwwk..",
      "..kwwwwwwwwwwk..",
      "..kwkkkkkkwwwk..",
      "..kwwwwwwwwwwk..",
      "..kwkkkkkkkkwk..",
      "..kwwwwwwwwwwk..",
      "..kwwwwwwwwwwk..",
      "..kkkkkkkkkkkk..",
      "................",
    ],
  },
  {
    // Shut Down: a power key on a gray keycap.
    file: "shutdown-16.svg",
    big: "shutdown.svg",
    rows: [
      "................",
      ".kkkkkkkkkkkkkk.",
      ".kwwwwwwwwwwwgk.",
      ".kwggggggggggdk.",
      ".kwgggkkkgggggk.",
      ".kwggkgkgkggggk.",
      ".kwgkggkggkgggk.",
      ".kwgkggkggkgggk.",
      ".kwgkggggggkggk.",
      ".kwgkggggggkggk.",
      ".kwggkggggkgggk.",
      ".kwgggkkkkggggk.",
      ".kwggggggggggdk.",
      ".kgddddddddddgk.",
      ".kkkkkkkkkkkkkk.",
      "................",
    ],
  },
  {
    // Settings: a gear.
    file: "settings-16.svg",
    rows: [
      "................",
      "......kk........",
      "..kk.kggk.kk....",
      "..kgkkggkkgk....",
      "...kggggggk.....",
      "..kkggkkggkk....",
      ".kgggkwwkgggk...",
      ".kgggkwwkgggk...",
      "..kkggkkggkk....",
      "...kggggggk.....",
      "..kgkkggkkgk....",
      "..kk.kggk.kk....",
      "......kk........",
      "................",
      "................",
      "................",
    ],
  },
  {
    // Find: a magnifier.
    file: "find-16.svg",
    rows: [
      "................",
      "...kkkk.........",
      "..kwwwwk........",
      ".kwggggwk.......",
      ".kwgggggk.......",
      ".kwgggggk.......",
      ".kwggggwk.......",
      "..kwwwwk........",
      "...kkkkkk.......",
      "......kkdk......",
      ".......kddk.....",
      "........kddk....",
      ".........kddk...",
      "..........kk....",
      "................",
      "................",
    ],
  },
  {
    // Help: a question mark on a page.
    file: "help-16.svg",
    rows: [
      "................",
      "....kkkkkk......",
      "...kbbbbbbk.....",
      "..kbbkkkbbbk....",
      "..kbbk.kbbbk....",
      "...kk..kbbbk....",
      "......kbbbk.....",
      ".....kbbbk......",
      ".....kbbk.......",
      ".....kbbk.......",
      "......kk........",
      ".....kbbk.......",
      ".....kbbk.......",
      "......kk........",
      "................",
      "................",
    ],
  },
  {
    // Run…: a command window.
    file: "run-16.svg",
    rows: [
      "................",
      ".kkkkkkkkkkkkk..",
      ".kbbbbbbbbbbbk..",
      ".kkkkkkkkkkkkk..",
      ".kwwwwwwwwwwwk..",
      ".kwkwwwwwwwwwk..",
      ".kwkkwwwwwwwwk..",
      ".kwkkkwwwwwwwk..",
      ".kwkkwwkkkkwwk..",
      ".kwkwwwwwwwwwk..",
      ".kwwwwwwwwwwwk..",
      ".kkkkkkkkkkkkk..",
      "................",
      "................",
      "................",
      "................",
    ],
  },
  {
    // Recycle 16 shares the desktop art; folder-16 doubles as Documents.
    // PocketJS favicon motif (site/assets/favicon.svg) with a white pocket
    // frame around a solid black interior. Pixels outside the white frame
    // stay transparent; the lens and two bars remain white. The 16px copy is
    // used by task buttons; the 32px copy is every Pocket app icon.
    file: "pocket-app-16.svg",
    big: "pocket-app.svg",
    rows: [
      "................",
      "................",
      "................",
      "..wwwwwwwwwwww..",
      ".wkkkkkkkkkkkkw.",
      ".wkkkkkkkkkkkkw.",
      ".wkkwwkkwwwwwkw.",
      ".wkwwwwkkkkkkkw.",
      ".wkwwwwkwwwkkkw.",
      ".wkkwwkkkkkkkkw.",
      ".wkkkkkkkkkkkkw.",
      ".wkkkkkkkkkkkkw.",
      "..wwwwwwwwwwww..",
      "................",
      "................",
      "................",
    ],
  },
  {
    // Start button copy of the same product mark. Kept as its established
    // filename because chrome.tsx refers to it directly.
    file: "start-logo.svg",
    rows: [
      "................",
      "................",
      "................",
      "..kkkkkkkkkkkk..",
      ".k............k.",
      ".k............k.",
      ".k..kk..kkkkk.k.",
      ".k.kkkk.......k.",
      ".k.kkkk.kkk...k.",
      ".k..kk........k.",
      ".k............k.",
      ".k............k.",
      "..kkkkkkkkkkkk..",
      "................",
      "................",
      "................",
    ],
  },
];

// Native-size art (caption glyphs, hud bits) — no 2× variant. Pak textures
// must be pow2, so every canvas is 8×8 or 16×16 with the art inside.
const NATIVE: Icon[] = [
  {
    file: "cap-min.svg",
    rows: ["........", "........", "........", "........", "........", ".kkkkkk.", ".kkkkkk.", "........"],
  },
  {
    file: "cap-max.svg",
    rows: ["kkkkkkkk", "kkkkkkkk", "k......k", "k......k", "k......k", "k......k", "k......k", "kkkkkkkk"],
  },
  {
    file: "cap-restore.svg",
    rows: [
      "...kkkkk",
      "...kkkkk",
      "...k...k",
      "kkkkk..k",
      "kkkkkkkk",
      "k...k...",
      "k...k...",
      "kkkkk...",
    ],
  },
  {
    file: "cap-close.svg",
    rows: ["........", "kk....kk", ".kk..kk.", "..kkkk..", "...kk...", "..kkkk..", ".kk..kk.", "kk....kk"],
  },
   {
    file: "menu-arrow.svg",
    rows: ["........", "..k.....", "..kk....", "..kkk...", "..kkkk..", "..kkk...", "..kk....", "..k....."],
  },
  { file: "grip.svg", rows: grip16() },
  {
    // Menu checkmark (checked toggle items, e.g. Edit > Word Wrap).
    file: "check-16.svg",
    rows: [
      "................",
      "................",
      "................",
      "..........kk....",
      ".........kkk....",
      "........kkk.....",
      "..kk...kkk......",
      "..kkk.kkk.......",
      "...kkkkk........",
      "....kkk.........",
      ".....k..........",
      "................",
      "................",
      "................",
      "................",
      "................",
    ],
  },
  {
    file: "mine.svg",
    rows: [
      "...k....",
      "..kkk.k.",
      ".kkkkkk.",
      "kkwkkkkk",
      ".kkkkkk.",
      "..kkk.k.",
      "...k....",
      "........",
    ],
  },
  {
    file: "flag.svg",
    rows: [
      "..rr....",
      "rrrr....",
      "..rr....",
      "...k....",
      "...k....",
      "..kk....",
      ".kkkkk..",
      "kkkkkkk.",
    ],
  },
  {
    // Explorer coolbar arrows: Back, Forward, Up (a folder with an arrow).
    file: "nav-back-16.svg",
    rows: [
      "................",
      "................",
      "................",
      "......k.........",
      ".....kk.........",
      "....kkk.........",
      "...kkkkkkkkkkk..",
      "..kkkkkkkkkkkk..",
      "...kkkkkkkkkkk..",
      "....kkk.........",
      ".....kk.........",
      "......k.........",
      "................",
      "................",
      "................",
      "................",
    ],
  },
  {
    file: "nav-forward-16.svg",
    rows: [
      "................",
      "................",
      "................",
      ".........k......",
      ".........kk.....",
      ".........kkk....",
      "..kkkkkkkkkkk...",
      "..kkkkkkkkkkkk..",
      "..kkkkkkkkkkk...",
      ".........kkk....",
      ".........kk.....",
      ".........k......",
      "................",
      "................",
      "................",
      "................",
    ],
  },
  {
    file: "nav-up-16.svg",
    rows: [
      "................",
      ".kkkkk..........",
      "kyyyyykkkkkkkk..",
      "kyyyyyyyyyyyyk..",
      "kkkkkkkkkkkkkkk.",
      "kyyyyyyykyyyyyk.",
      "kyyyyyykkkyyyyk.",
      "kyyyyykkkkkyyyk.",
      "kyyyykkkkkkkyyk.",
      "kyyyyyykkkyyyyk.",
      "kyyyyyykkkyyyyk.",
      "kyyyyyykkkyyyyk.",
      "kyyyyyyyyyyyyyk.",
      "kkkkkkkkkkkkkkk.",
      "................",
      "................",
    ],
  },
  { file: "smile.svg", rows: face("smile") },
  { file: "smile-ooh.svg", rows: face("ooh") },
  { file: "smile-dead.svg", rows: face("dead") },
  { file: "smile-cool.svg", rows: face("cool") },
];

/** Status-bar size grip: diagonal white/gray ridge pairs in the lower-right
 *  triangle of a 16×16 canvas. */
function grip16(): string[] {
  const N = 16;
  const grid: string[][] = Array.from({ length: N }, () => Array(N).fill("."));
  for (const k of [17, 21, 25, 29]) {
    for (let x = 0; x < N; x++) {
      const yw = k - x;
      if (yw >= 4 && yw < N && x >= 4) grid[yw][x] = "w";
      const yd = k + 1 - x;
      if (yd >= 4 && yd < N && x >= 4) grid[yd][x] = "d";
    }
  }
  return grid.map((r) => r.join(""));
}

/** Smiley faces built procedurally: a yellow disc with a black ring, then
 *  per-state eyes and mouth pixels — hand grids kept coming out ragged. */
function face(kind: "smile" | "ooh" | "dead" | "cool"): string[] {
  const N = 16;
  const grid: string[][] = Array.from({ length: N }, () => Array(N).fill("."));
  const c = (N - 1) / 2;
  const inside = (x: number, y: number) => (x - c) ** 2 + (y - c) ** 2 <= 7.2 ** 2;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) if (inside(x, y)) grid[y][x] = "s";
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (grid[y][x] !== "s") continue;
      const edge =
        !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (edge) grid[y][x] = "k";
    }
  }
  const px = (x: number, y: number) => {
    grid[y][x] = "k";
  };
  if (kind === "dead") {
    for (const ex of [4, 9]) {
      px(ex, 4);
      px(ex + 2, 4);
      px(ex + 1, 5);
      px(ex, 6);
      px(ex + 2, 6);
    }
    // Frown.
    for (let x = 6; x <= 9; x++) px(x, 10);
    px(5, 11);
    px(10, 11);
  } else if (kind === "cool") {
    // Sunglasses: one bar with two lenses.
    for (let x = 2; x <= 13; x++) px(x, 5);
    for (const lx of [3, 9]) {
      for (let x = lx; x <= lx + 3; x++) {
        px(x, 6);
        px(x, 7);
      }
    }
    for (let x = 6; x <= 9; x++) px(x, 12);
    px(5, 11);
    px(10, 11);
  } else {
    // Eyes.
    for (const ex of [5, 10]) {
      px(ex, 5);
      px(ex, 6);
    }
    if (kind === "smile") {
      for (let x = 6; x <= 9; x++) px(x, 12);
      px(5, 11);
      px(10, 11);
      px(4, 10);
      px(11, 10);
    } else {
      // "ooh": a small round mouth.
      for (const [x, y] of [
        [7, 9],
        [8, 9],
        [6, 10],
        [9, 10],
        [6, 11],
        [9, 11],
        [7, 12],
        [8, 12],
      ]) {
        px(x, y);
      }
    }
  }
  return grid.map((r) => r.join(""));
}

const outDir = join(import.meta.dir, "icons");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
let count = 0;
for (const icon of ICONS) {
  await Bun.write(join(outDir, icon.file), svgFor(icon.rows, 1));
  count++;
  if (icon.big) {
    await Bun.write(
      join(outDir, icon.big),
      icon.bigRows ? svgFor(icon.bigRows, 1) : svgFor(icon.rows, 2),
    );
    count++;
  }
}
// Luna caption glyphs are drawn, not gridded: at 21px the cell carries a
// ~10px mark whose diagonals must stay smooth, and the pixel grids the rest
// of this file emits stair-step the moment the host bakes them at 2x. These
// are plain filled shapes (bake-svg does fills, never strokes) in a 16px
// power-of-two tile, so the bar ends land on whole pixels while the X keeps
// analytic coverage on its slopes.
interface VectorIcon {
  file: string;
  body: string;
  /** Tile size; pak images are power-of-two, so 8, 16 or 32. */
  size?: number;
}

/** One diagonal bar of the close mark, as a filled quad. */
function bar(x0: number, y0: number, x1: number, y1: number, w: number): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  const p = (x: number, y: number) => `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`;
  return `M${p(x0 + nx, y0 + ny)}L${p(x1 + nx, y1 + ny)}L${p(x1 - nx, y1 - ny)}L${p(x0 - nx, y0 - ny)}z`;
}

const VECTORS: VectorIcon[] = [
  {
    file: "xp-cap-close.svg",
    body: `<path fill="#ffffff" d="${bar(3.4, 3.4, 12.6, 12.6, 2.6)}${bar(12.6, 3.4, 3.4, 12.6, 2.6)}"/>`,
  },
  {
    // Turn Off Computer: Luna's red plate with the power mark.
    file: "xp-power.svg",
    body:
      '<rect x="1" y="1" width="14" height="14" rx="3" fill="#b13a2a"/>' +
      '<rect x="2" y="2" width="12" height="12" rx="2" fill="#e2543c"/>' +
      // A ring cut by the plate colour, then the bar: bake-svg fills
      // circles, rects and polygonal paths — never arcs.
      '<circle cx="8" cy="9" r="4.6" fill="#ffffff"/>' +
      '<circle cx="8" cy="9" r="2.9" fill="#e2543c"/>' +
      '<rect x="6.9" y="3.2" width="2.2" height="3.4" fill="#e2543c"/>' +
      '<rect x="7.1" y="3.4" width="1.8" height="5" fill="#ffffff"/>',
  },
  {
    // Start-panel user tile: Luna frames the picture in a soft blue plate.
    file: "xp-user.svg",
    size: 32,
    body:
      '<rect x="0" y="0" width="32" height="32" rx="3" fill="#6f9fdd"/>' +
      '<rect x="2" y="2" width="28" height="28" rx="2" fill="#a8c8ee"/>' +
      '<circle cx="16" cy="12" r="6" fill="#ffffff"/>' +
      '<path fill="#ffffff" d="M16 19c6 0 10 4 10 9v3H6v-3c0-5 4-9 10-9z"/>',
  },
  {
    file: "xp-cap-min.svg",
    body: '<rect x="3" y="10" width="10" height="2.5" fill="#ffffff"/>',
  },
  {
    // Outline box with the doubled caption bar Luna draws across its top.
    file: "xp-cap-max.svg",
    body:
      '<rect x="3" y="3" width="10" height="3" fill="#ffffff"/>' +
      '<rect x="3" y="6" width="1.5" height="7" fill="#ffffff"/>' +
      '<rect x="11.5" y="6" width="1.5" height="7" fill="#ffffff"/>' +
      '<rect x="3" y="11.5" width="10" height="1.5" fill="#ffffff"/>',
  },
  {
    // Two stacked boxes: the back one clipped to an L by the front one.
    file: "xp-cap-restore.svg",
    body:
      '<rect x="6" y="2.5" width="7.5" height="2.5" fill="#ffffff"/>' +
      '<rect x="12" y="5" width="1.5" height="5" fill="#ffffff"/>' +
      '<rect x="9.5" y="8.5" width="2.5" height="1.5" fill="#ffffff"/>' +
      '<rect x="2.5" y="6" width="7.5" height="2.5" fill="#ffffff"/>' +
      '<rect x="2.5" y="8.5" width="1.5" height="5" fill="#ffffff"/>' +
      '<rect x="8.5" y="8.5" width="1.5" height="5" fill="#ffffff"/>' +
      '<rect x="2.5" y="12" width="7.5" height="1.5" fill="#ffffff"/>',
  },
];

for (const icon of VECTORS) {
  const size = icon.size ?? 16;
  await Bun.write(
    join(outDir, icon.file),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
      `viewBox="0 0 ${size} ${size}">${icon.body}</svg>`,
  );
  count++;
}

// ---------------------------------------------------------------------------
// Aqua (Mac OS X 10.2–10.4) vector set. Drawn once in a 32-unit space and
// emitted at 32px (desktop, Dock, dialogs) and 16px (captions, menus, lists)
// through the viewBox, so both sizes are one drawing. bake-svg fills paths
// (with cubic curves), rects and circles — no strokes, no gradients, no
// arcs — so every outline is a slightly larger shape painted first, every
// gel is a flat body plus a translucent sheen shape, and every stroke is a
// polygon swept along its centerline.
// ---------------------------------------------------------------------------

type Pt = [number, number];
const K = 0.5523; // cubic approximation of a quarter circle

const f = (n: number) => String(Math.round(n * 100) / 100);

/** Rounded rectangle path (cubic corners). */
function rrect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  const k = rr * K;
  return (
    `M${f(x + rr)} ${f(y)}` +
    `L${f(x + w - rr)} ${f(y)}` +
    `C${f(x + w - rr + k)} ${f(y)} ${f(x + w)} ${f(y + rr - k)} ${f(x + w)} ${f(y + rr)}` +
    `L${f(x + w)} ${f(y + h - rr)}` +
    `C${f(x + w)} ${f(y + h - rr + k)} ${f(x + w - rr + k)} ${f(y + h)} ${f(x + w - rr)} ${f(y + h)}` +
    `L${f(x + rr)} ${f(y + h)}` +
    `C${f(x + rr - k)} ${f(y + h)} ${f(x)} ${f(y + h - rr + k)} ${f(x)} ${f(y + h - rr)}` +
    `L${f(x)} ${f(y + rr)}` +
    `C${f(x)} ${f(y + rr - k)} ${f(x + rr - k)} ${f(y)} ${f(x + rr)} ${f(y)}z`
  );
}

function poly(pts: Pt[]): string {
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${f(x)} ${f(y)}`).join("") + "z";
}

/** Points along a circle from angle a0 to a1 (degrees, clockwise on screen). */
function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** A polyline swept to a filled band of width w (mitered by averaging the
 *  adjacent segment normals — fine for gently bending icon strokes). */
function sweep(pts: Pt[], w: number): string {
  const n = pts.length;
  const normals: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy) || 1;
    normals.push([-dy / len, dx / len]);
  }
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = normals[Math.max(0, i - 1)];
    const b = normals[Math.min(n - 2, i)];
    let nx = a[0] + b[0];
    let ny = a[1] + b[1];
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    left.push([pts[i][0] + (nx * w) / 2, pts[i][1] + (ny * w) / 2]);
    right.push([pts[i][0] - (nx * w) / 2, pts[i][1] - (ny * w) / 2]);
  }
  return poly([...left, ...right.reverse()]);
}

/** Gear outline: `teeth` teeth between radii ri and ro around (cx, cy). */
function gear(cx: number, cy: number, ri: number, ro: number, teeth: number): string {
  const pts: Pt[] = [];
  const step = 360 / teeth;
  for (let t = 0; t < teeth; t++) {
    const a = t * step;
    for (const [da, r] of [
      [0, ri],
      [step * 0.15, ro],
      [step * 0.45, ro],
      [step * 0.6, ri],
    ] as [number, number][]) {
      const rad = ((a + da) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(rad), cy + r * Math.sin(rad)]);
    }
  }
  return poly(pts);
}

const P = (d: string, fill: string, extra = "") => `<path fill="${fill}" d="${d}"${extra}/>`;
const C = (cx: number, cy: number, r: number, fill: string) =>
  `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}"/>`;
const R = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"/>`;

/** Vertical gradient emulation inside a rounded rect: the top color as the
 *  whole shape, the bottom color as a 2r-tall rounded foot, and full-width
 *  square bands for the straight middle so the stops land exactly (the foot's
 *  rounded top corners hide under the bands). */
function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mix = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return "#" + mix.map((v) => v.toString(16).padStart(2, "0")).join("");
}
function vgrad(x: number, y: number, w: number, h: number, r: number, stops: string[], bands = 8): string {
  const rr = Math.min(r, h / 2, w / 2);
  const top = stops[0];
  const bottom = stops[stops.length - 1];
  let out = P(rrect(x, y, w, h, rr), top);
  if (rr > 0) out += P(rrect(x, y + h - 2 * rr, w, 2 * rr, rr), bottom);
  const y0 = y + rr;
  const y1 = y + h - rr;
  if (y1 <= y0) return out;
  const at = (t: number): string => {
    const pos = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(pos));
    return lerpHex(stops[i], stops[i + 1], pos - i);
  };
  for (let i = 0; i < bands; i++) {
    const by0 = y0 + ((y1 - y0) * i) / bands;
    const by1 = y0 + ((y1 - y0) * (i + 1)) / bands;
    out += R(x, by0, w, by1 - by0 + 0.02, at((i + 0.5) / bands));
  }
  return out;
}
/** Ellipse path (four cubics). */
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  const kx = rx * K;
  const ky = ry * K;
  return (
    `M${f(cx + rx)} ${f(cy)}` +
    `C${f(cx + rx)} ${f(cy + ky)} ${f(cx + kx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}` +
    `C${f(cx - kx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ky)} ${f(cx - rx)} ${f(cy)}` +
    `C${f(cx - rx)} ${f(cy - ky)} ${f(cx - kx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)}` +
    `C${f(cx + kx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ky)} ${f(cx + rx)} ${f(cy)}z`
  );
}
/** Left-to-right metal sheen inside a trapezoid: vertical stripes between
 *  the slanted edges. */
function trapStripes(
  y0: number,
  y1: number,
  lt: number,
  rt: number,
  lb: number,
  rb: number,
  stops: string[],
  bands = 10,
): string {
  let out = "";
  const at = (t: number): string => {
    const pos = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(pos));
    return lerpHex(stops[i], stops[i + 1], pos - i);
  };
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands + 0.002;
    const xt0 = lt + (rt - lt) * t0;
    const xt1 = lt + (rt - lt) * t1;
    const xb0 = lb + (rb - lb) * t0;
    const xb1 = lb + (rb - lb) * t1;
    out += P(poly([[xt0, y0], [xt1, y0], [xb1, y1], [xb0, y1]]), at((i + 0.5) / bands));
  }
  return out;
}
/** Soft contact shadow under an object. */
function groundShadow(cx: number, cy: number, rx: number, ry: number): string {
  return P(ellipse(cx, cy, rx, ry), "#00000022") + P(ellipse(cx, cy, rx * 0.7, ry * 0.6), "#0000002a");
}

// Aqua palette: gel blues for folders and plates, and neutral metal grays.
const AQ = {
  outline: "#3565aa",
  plateDark: "#1f4f9f",
  ink: "#1e1e1e",
  paper: "#ffffff",
  paperEdge: "#8c8c8c",
  rule: "#b9cdea",
};

/** The PocketJS mark, from site/assets/favicon.svg without its plate: the
 *  rounded-rect frame (stroke 2.6), the lens at (10, 16) and the two bars,
 *  on a soft contact shadow. The frame is a filled ring (outer minus inner,
 *  even-odd) since bake-svg has no strokes; a theme supplies the metal. */
function pocketMark(pal: {
  frame: string;
  frameLight: string;
  frameShade: string;
  lens: string[];
  bar: string;
  barLight: string;
}): string {
  const ring = (dx: number, dy: number, fill: string) =>
    `<path fill="${fill}" fill-rule="evenodd" d="${rrect(2 + dx, 6 + dy, 28, 20, 6)}${rrect(4.6 + dx, 8.6 + dy, 22.8, 14.8, 3.4)}"/>`;
  return (
    groundShadow(16, 28.4, 13, 1.6) +
    // Shade below-right, highlight above-left, metal in between.
    ring(0.6, 0.7, pal.frameShade) +
    ring(-0.4, -0.5, pal.frameLight) +
    ring(0, 0, pal.frame) +
    // Lens: shaded disc with a glint.
    C(10, 16, 3.3, pal.lens[2]) +
    C(9.8, 15.6, 2.8, pal.lens[1]) +
    C(9.4, 14.9, 1.9, pal.lens[0]) +
    C(9, 14.6, 0.8, "#ffffffb0") +
    // Bars.
    P(rrect(16.4, 13, 10, 2.2, 1.1), pal.barLight) +
    P(rrect(16.4, 17.6, 6.5, 2.2, 1.1), pal.barLight) +
    P(rrect(16, 12.6, 10, 2.2, 1.1), pal.bar) +
    P(rrect(16, 17.2, 6.5, 2.2, 1.1), pal.bar) +
    P(rrect(16.3, 12.9, 9.4, 0.8, 0.4), "#ffffff73") +
    P(rrect(16.3, 17.5, 5.9, 0.8, 0.4), "#ffffff73")
  );
}

/** Bliss-like sky and hill for Luna screens inside (x, y, w, h). */
function blissScreen(x: number, y: number, w: number, h: number, r: number): string {
  const hy = y + h * 0.72;
  return (
    vgrad(x, y, w, h, r, ["#3d8fe6", "#7dbcf2", "#c7e6fb"], 6) +
    P(
      `M${f(x)} ${f(y + h)}C${f(x + w * 0.2)} ${f(hy - h * 0.2)} ${f(x + w * 0.5)} ${f(hy - h * 0.12)} ${f(x + w * 0.7)} ${f(hy)}` +
        `C${f(x + w * 0.85)} ${f(hy + h * 0.05)} ${f(x + w * 0.95)} ${f(hy)} ${f(x + w)} ${f(hy - h * 0.06)}L${f(x + w)} ${f(y + h)}z`,
      "#3e9a2f",
    ) +
    P(
      `M${f(x)} ${f(y + h)}C${f(x + w * 0.2)} ${f(hy)} ${f(x + w * 0.5)} ${f(hy + h * 0.02)} ${f(x + w * 0.7)} ${f(hy + h * 0.1)}` +
        `C${f(x + w * 0.85)} ${f(hy + h * 0.14)} ${f(x + w * 0.95)} ${f(hy + h * 0.1)} ${f(x + w)} ${f(hy + h * 0.06)}L${f(x + w)} ${f(y + h)}z`,
      "#6bc24a",
    )
  );
}

/** Document page with a soft shadow, an edge and a dog-eared corner. */
function page(lines: string, extra = ""): string {
  return (
    groundShadow(16, 29.6, 10, 1.4) +
    P(rrect(6.5, 2.5, 19, 27, 1.5), AQ.paperEdge) +
    vgrad(7, 3, 18, 26, 1, ["#ffffff", "#fafafa", "#f0f0f0"], 4) +
    P(poly([[19, 3], [25, 9], [19, 9]]), "#dcdcdc") +
    P(poly([[19, 3], [19, 9], [25, 9], [25, 8.4], [19.6, 8.4], [19.6, 3]]), AQ.paperEdge) +
    lines +
    extra
  );
}

interface AquaIcon {
  /** Base name; `${name}.svg` is 32px, `${name}-16.svg` 16px. */
  name: string;
  body: string;
  /** Emit only the 16px file (list and menu art). */
  smallOnly?: boolean;
}

const AQUA: AquaIcon[] = [
  {
    // Gel folder: tab, shaded back panel, glossy front flap on a soft shadow.
    name: "aqua-folder",
    body:
      groundShadow(16, 28.8, 13, 1.8) +
      P(rrect(3, 4.5, 12, 6, 2.5), AQ.outline) +
      P(rrect(3, 7, 26, 20, 3), AQ.outline) +
      vgrad(4, 5.5, 10, 5, 2, ["#9cc4f2", "#6ea3e6"], 3) +
      vgrad(4, 8, 24, 18, 2.5, ["#b3d4f6", "#8ab8ee", "#6ea3e6"], 6) +
      vgrad(4, 14, 24, 12, 2.5, ["#8fbbef", "#5f97e1", "#4d86d8", "#6ea6ea"], 8) +
      R(4, 14, 24, 0.9, "#3565aa99") +
      P(ellipse(16, 16.2, 11, 1.6), "#ffffff4d") +
      P(ellipse(16, 10.5, 11, 1.4), "#ffffff66"),
  },
  {
    // Flat-panel display: brushed bezel, Aqua-blue screen with a glossy
    // reflection, chrome neck and foot on a contact shadow.
    name: "aqua-computer",
    body:
      groundShadow(16, 29.4, 10, 1.6) +
      P(rrect(2.5, 2.5, 27, 20, 3), "#7d7d7d") +
      vgrad(3, 3, 26, 19, 2.5, ["#fbfbfb", "#e9e9e9", "#d2d2d2"], 6) +
      P(rrect(5, 5, 22, 13, 1.5), "#123f8f") +
      vgrad(5.5, 5.5, 21, 12, 1.2, ["#1e5cc4", "#3f86dd", "#7fb6f0"], 6) +
      P(poly([[5.5, 5.5], [15, 5.5], [8.5, 17.5], [5.5, 17.5]]), "#ffffff33") +
      P(ellipse(16, 7.2, 9.5, 1.3), "#ffffff5c") +
      vgrad(14, 22, 4, 5, 0.8, ["#e6e6e6", "#a9a9a9"], 3) +
      P(rrect(7.5, 26, 17, 3.8, 1.9), "#8a8a8a") +
      vgrad(8, 26.4, 16, 3, 1.5, ["#f4f4f4", "#c2c2c2"], 3),
  },
  {
    // Wire-mesh trash: metal sheen left to right, a rimmed lid, a handle.
    name: "aqua-trash",
    body:
      groundShadow(16, 29.6, 9, 1.4) +
      P(rrect(13, 3.2, 6, 3, 1.4), "#7a7a7a") +
      P(rrect(13.6, 3.7, 4.8, 1.6, 0.8), "#d9d9d9") +
      P(rrect(6.5, 5.8, 19, 4, 1.8), "#7a7a7a") +
      trapStripes(6.3, 9.3, 7, 25, 7, 25, ["#bdbdbd", "#f4f4f4", "#b5b5b5", "#e6e6e6", "#a9a9a9"], 8) +
      P(poly([[7.5, 9.6], [24.5, 9.6], [23, 29.5], [9, 29.5]]), "#7a7a7a") +
      trapStripes(10, 29, 8, 24, 9.4, 22.6, ["#a9a9a9", "#efefef", "#b8b8b8", "#dedede", "#9c9c9c"], 10) +
      R(11.4, 11, 0.8, 17.4, "#5a5a5a55") +
      R(14.4, 11, 0.8, 17.6, "#5a5a5a55") +
      R(17.2, 11, 0.8, 17.6, "#5a5a5a55") +
      R(20.1, 11, 0.8, 17.4, "#5a5a5a55") +
      P(poly([[8.6, 14], [23.6, 14], [23.4, 14.9], [8.8, 14.9]]), "#5a5a5a4d") +
      P(poly([[9.2, 21], [23, 21], [22.8, 21.9], [9.4, 21.9]]), "#5a5a5a4d"),
  },
  {
    // Text document with a pencil laid across it.
    name: "aqua-notepad",
    body: page(
      R(10, 12, 12, 1.3, AQ.rule) + R(10, 15.5, 12, 1.3, AQ.rule) + R(10, 19, 8, 1.3, AQ.rule),
      P(poly([[12, 30.5], [25.5, 17], [28.5, 20], [15, 33.5]]), "#00000022") +
        P(poly([[14.5, 28], [27, 15.5], [29.5, 18], [17, 30.5]]), "#e9b13b") +
        P(poly([[14.5, 28], [27, 15.5], [28.2, 16.7], [15.7, 29.2]]), "#f6cc6a") +
        P(poly([[27, 15.5], [29.5, 18], [31.5, 13.6]]), "#e7c39a") +
        P(poly([[29.9, 15.2], [31.5, 13.6], [30.8, 16.1]]), "#3a3a3a") +
        P(poly([[14.5, 28], [17, 30.5], [12.6, 32], [12.2, 31.4]]), "#f2b9b2"),
    ),
  },
  {
    // Round bomb with a lit fuse; shaded by offset discs, glossy glint.
    name: "aqua-mines",
    body:
      groundShadow(15, 29.2, 9.5, 1.6) +
      P(sweep([[20, 10.5], [23, 7.5], [26, 7]], 1.8), "#4a4a4a") +
      C(27, 6, 2.4, "#ffb020") +
      C(27, 6, 1.2, "#fff0a0") +
      C(15, 18.5, 9.6, "#0d0d0d") +
      C(14.6, 18, 8.8, "#262626") +
      C(14, 17, 7.6, "#353535") +
      C(13.2, 15.6, 5.6, "#454545") +
      P(ellipse(12.4, 14.2, 3.4, 2.2), "#ffffff4d") +
      P(ellipse(12, 13.6, 2, 1.2), "#ffffff99") +
      R(18.5, 9.5, 3, 3, "#4a4a4a"),
  },
  {
    // Pocket apps and the launcher logo: the PocketJS mark in the favicon's
    // cool silver, its lens Aqua-blue glass.
    name: "aqua-pocket-app",
    body: pocketMark({
      frame: "#dbe5f2",
      frameLight: "#f7fbff",
      frameShade: "#6c7f99",
      lens: ["#bfe0ff", "#4d8be4", "#1f4f9f"],
      bar: "#d6e1ef",
      barLight: "#6c7f99",
    }),
  },
  {
    // Shut Down: the power mark on a red gel disc.
    name: "aqua-power",
    body:
      groundShadow(16, 29.8, 10, 1.4) +
      C(16, 16.5, 13, "#8f1f16") +
      C(16, 16.5, 12, "#c8372a") +
      C(16, 16, 11.2, "#dc4b3d") +
      C(16, 15.2, 9.6, "#e8624f") +
      P(ellipse(16, 9.8, 8.4, 3.6), "#ffffff70") +
      P(ellipse(16, 8.6, 6, 2), "#ffffffb0") +
      C(16, 17, 6.6, "#ffffff") +
      C(16, 17, 4.6, "#dc4b3d") +
      R(14.4, 8, 3.2, 7, "#dc4b3d") +
      R(14.9, 9.5, 2.2, 8.5, "#ffffff"),
  },
  {
    // Local disk: a brushed box with a green activity light.
    name: "aqua-drive",
    smallOnly: true,
    body:
      P(rrect(2.5, 9.5, 27, 13, 2.5), "#7a7a7a") +
      vgrad(3, 10, 26, 12, 2, ["#f2f2f2", "#d9d9d9", "#c4c4c4"], 4) +
      R(6, 17, 12, 1.4, "#9a9a9a") +
      C(25, 17.5, 1.7, "#1d8a2b") +
      C(25, 17.5, 1, "#5fe06a"),
  },
  {
    // Optical disc with a see-through hub.
    name: "aqua-cdrom",
    smallOnly: true,
    body:
      C(16, 16, 13, "#a9b6c4") +
      C(16, 16, 12, "#e8eef4") +
      C(16, 16, 8, "#cfd9e4") +
      C(11.5, 11, 3.2, "#ffffff90") +
      C(16, 16, 4.2, "#8f9caa") +
      C(16, 16, 3.4, "hole"),
  },
  {
    // Plain document.
    name: "aqua-file",
    smallOnly: true,
    body: page(R(10, 13, 12, 1.6, "#c9c9c9") + R(10, 17, 12, 1.6, "#c9c9c9") + R(10, 21, 8, 1.6, "#c9c9c9")),
  },
  {
    // System Preferences: a gray gear with an open hub.
    name: "aqua-settings",
    smallOnly: true,
    body:
      P(gear(16, 16, 9.5, 13.5, 8), "#6f6f6f") +
      P(gear(16, 16, 9, 12.5, 8), "#a9a9a9") +
      C(16, 16, 8, "#8a8a8a") +
      C(16, 16, 6.5, "#d0d0d0") +
      C(16, 16, 3.6, "hole"),
  },
  {
    // Find: a magnifier with a tinted lens.
    name: "aqua-find",
    smallOnly: true,
    body:
      P(sweep([[19.5, 19.5], [28, 28]], 4.4), "#5a5a5a") +
      C(13, 13, 10, "#4f7fc4") +
      C(13, 13, 8, "#dfe9f7") +
      C(10.5, 10, 2.6, "#ffffffb0"),
  },
  {
    // Help: a white question mark on a blue gel disc.
    name: "aqua-help",
    smallOnly: true,
    body:
      C(16, 16, 13, AQ.plateDark) +
      C(16, 16, 12, "#3f83dd") +
      C(16, 12, 7.5, "#6faaf0") +
      P(
        sweep(
          [...arcPts(16, 12.5, 4.4, 185, 435, 14), [16.2, 18.6], [16, 20.6]],
          2.6,
        ),
        "#ffffff",
      ) +
      C(16, 24.3, 1.7, "#ffffff"),
  },
  {
    // Run: a tiny window with a prompt.
    name: "aqua-run",
    smallOnly: true,
    body:
      P(rrect(2.5, 5.5, 27, 21, 2.5), "#7a7a7a") +
      P(rrect(3, 6, 26, 20, 2), "#ffffff") +
      P(rrect(3, 6, 26, 7, 2), "#d0d0d0") +
      R(3, 10.5, 26, 15, "#ffffff") +
      P(sweep([[7, 14.5], [11, 18], [7, 21.5]], 2.2), "#2f6fd6") +
      R(13.5, 19.6, 6, 2, "#2f6fd6"),
  },
  {
    // Menu checkmark.
    name: "aqua-check",
    smallOnly: true,
    body: P(sweep([[7, 16.5], [13, 22.5], [25, 9]], 3.2), AQ.ink),
  },
];

for (const icon of AQUA) {
  const svg = (px: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" ` +
    `viewBox="0 0 32 32">${icon.body}</svg>`;
  if (!icon.smallOnly) {
    await Bun.write(join(outDir, `${icon.name}.svg`), svg(32));
    count++;
  }
  await Bun.write(join(outDir, `${icon.name}-16.svg`), svg(16));
  count++;
}

// ---------------------------------------------------------------------------
// Luna (Windows XP) vector set: the five desktop subjects in XP's saturated,
// softly shaded style, at 32px and 16px. Small system art (drives, files,
// gear, magnifier, help, run, check) is shared with the Aqua set — those
// Luna icons were smooth neutral objects too.
// ---------------------------------------------------------------------------

const XP: AquaIcon[] = [
  {
    // My Computer: a front-facing flat panel in Luna silver — soft bezel
    // gradient, a dark inner rim, the Bliss sky with a glossy sweep, a
    // power light, a tapered neck on a round foot. No side faces.
    name: "xp-computer",
    body:
      groundShadow(16, 29.6, 11, 1.4) +
      P(rrect(3, 2.5, 26, 19.5, 2.2), "#5d6b7d") +
      vgrad(3.6, 3.1, 24.8, 18.3, 1.8, ["#fbfcfe", "#e3e8ee", "#c5cdd7"], 6) +
      P(rrect(5.6, 5, 20.8, 13.6, 0.9), "#33475f") +
      blissScreen(6.2, 5.6, 19.6, 12.4, 0.5) +
      P(poly([[6.2, 5.6], [13.5, 5.6], [8.2, 12.6], [6.2, 12.6]]), "#ffffff30") +
      P(rrect(3.6, 18.9, 24.8, 2.5, 0.8), "#c3ccd6") +
      C(25.6, 20.15, 0.65, "#3fc24a") +
      P(poly([[13.4, 22], [18.6, 22], [18.1, 25.4], [13.9, 25.4]]), "#8f9aa8") +
      P(poly([[13.9, 22], [18.1, 22], [17.7, 25.1], [14.3, 25.1]]), "#d5dbe3") +
      P(ellipse(16, 27.6, 9.6, 2.4), "#5d6b7d") +
      P(ellipse(16, 27.3, 8.8, 1.9), "#c9d1da") +
      P(ellipse(16, 26.9, 7.4, 1.1), "#eef1f5"),
  },
  {
    // Pocket apps: the PocketJS mark in Luna silver with a Luna-blue lens.
    name: "xp-pocket-app",
    body: pocketMark({
      frame: "#e2e8f0",
      frameLight: "#ffffff",
      frameShade: "#5d6b7d",
      lens: ["#a8cdf6", "#3d8fe6", "#1e5cc4"],
      bar: "#dfe6ef",
      barLight: "#5d6b7d",
    }),
  },
  {
    // Manila folder with XP's warm gradient and an open lighter flap.
    name: "xp-folder",
    body:
      groundShadow(16, 28.8, 13, 1.8) +
      P(rrect(3, 4.5, 12, 6, 2), "#b98a25") +
      P(rrect(3, 7, 26, 20, 2.5), "#b98a25") +
      vgrad(4, 5.5, 10, 5, 1.5, ["#f8e39a", "#e8c15a"], 3) +
      vgrad(4, 8, 24, 18, 2, ["#f3d576", "#e4b94a", "#d9a83a"], 6) +
      P(rrect(3, 13, 26, 14, 2.5), "#b98a25") +
      vgrad(4, 14, 24, 12, 2, ["#fff2b5", "#f6d879", "#e9bf4e"], 8) +
      P(ellipse(16, 15.8, 11, 1.2), "#ffffff66"),
  },
  {
    // Recycle Bin: a translucent blue-gray basket with a crumpled sheet.
    name: "xp-recycle",
    body:
      groundShadow(16, 29.6, 9, 1.4) +
      P(poly([[7, 9.5], [25, 9.5], [23, 29.5], [9, 29.5]]), "#6d8db3") +
      trapStripes(10, 29, 7.6, 24.4, 9.5, 22.5, ["#c6d8ec", "#eaf2fa", "#b4c9e0", "#dbe7f3", "#a9bfd8"], 10) +
      P(rrect(5.5, 7, 21, 3.6, 1.8), "#5b7ba3") +
      vgrad(6, 7.4, 20, 2.8, 1.4, ["#e6effa", "#b9cce3"], 3) +
      P(rrect(13, 4.6, 6, 3, 1.4), "#5b7ba3") +
      P(rrect(13.6, 5.1, 4.8, 1.6, 0.8), "#dfe9f5") +
      C(16, 17.5, 4.2, "#f4f4f4") +
      C(14.8, 16.4, 2.4, "#ffffff") +
      P(poly([[12.4, 19.6], [15.6, 17.3], [19.2, 20.4], [16.2, 21.5]]), "#dedede") +
      R(9.2, 11, 0.9, 17.4, "#3f5d8455") +
      R(22.2, 11, 0.9, 17.4, "#3f5d8455"),
  },
  {
    // Notepad: a spiral-bound white pad with light-blue rules.
    name: "xp-notepad",
    body:
      groundShadow(16, 29.6, 10, 1.4) +
      P(rrect(6.5, 4.5, 19, 25, 1.5), "#7d8794") +
      vgrad(7, 5, 18, 24, 1, ["#ffffff", "#f6f8fb", "#e5e9ee"], 4) +
      R(9, 8.5, 14, 0.9, "#9fb6d4") +
      R(9.5, 12, 13, 1.1, "#b7cbe6") +
      R(9.5, 15.5, 13, 1.1, "#b7cbe6") +
      R(9.5, 19, 13, 1.1, "#b7cbe6") +
      R(9.5, 22.5, 9, 1.1, "#b7cbe6") +
      C(9.5, 4.6, 1.6, "#5b6b7d") +
      C(13.8, 4.6, 1.6, "#5b6b7d") +
      C(18.2, 4.6, 1.6, "#5b6b7d") +
      C(22.5, 4.6, 1.6, "#5b6b7d") +
      C(9.5, 4.6, 0.9, "#c9d3de") +
      C(13.8, 4.6, 0.9, "#c9d3de") +
      C(18.2, 4.6, 0.9, "#c9d3de") +
      C(22.5, 4.6, 0.9, "#c9d3de"),
  },
  {
    // Minesweeper: a soft gray tile with a black mine.
    name: "xp-mines",
    body:
      P(rrect(2.5, 2.5, 27, 27, 2.5), "#7d8794") +
      vgrad(3, 3, 26, 26, 2, ["#f4f6f8", "#dfe3e8", "#c3c9d1"], 6) +
      R(16, 7, 1.4, 18, "#111111") +
      R(7, 16, 18, 1.4, "#111111") +
      P(sweep([[9.5, 9.5], [22.5, 22.5]], 1.4), "#111111") +
      P(sweep([[22.5, 9.5], [9.5, 22.5]], 1.4), "#111111") +
      C(16, 16, 6.6, "#0d0d0d") +
      C(15.6, 15.6, 5.9, "#2a2a2a") +
      C(15, 15, 4.6, "#3d3d3d") +
      P(ellipse(13.8, 13.8, 2, 1.3), "#ffffff8c"),
  },
];

for (const icon of XP) {
  const svg = (px: number) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" ` +
    `viewBox="0 0 32 32">${icon.body}</svg>`;
  await Bun.write(join(outDir, `${icon.name}.svg`), svg(32));
  await Bun.write(join(outDir, `${icon.name}-16.svg`), svg(16));
  count += 2;
}

// ---------------------------------------------------------------------------
// Aqua traffic-light faces. The core paints gradient fills inside rounded
// boxes as per-row spans, which bands a 14px gel into stripes; a face baked
// here is supersampled 4×4 by bake-svg, so the rim, body shading, seat glow
// and top sheen all land smooth. 16px tile, 14px disc centered at (8, 8).
// ---------------------------------------------------------------------------

function light(rim: string, body: string, deep: string, glow: string, pressed: boolean): string {
  // Body: concentric discs stepping from the deep seat color up to the body
  // color, each lifted a little, so the shading reads as a smooth sphere.
  const steps = 5;
  let out = C(8, 8, 7, rim) + C(8, 8, 6.2, deep);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    out += C(8, 8 - 1.3 * t, 6.2 - 1.1 * t, lerpHex(deep, body, t));
  }
  // Seat glow and top sheen: nested ellipses with rising alpha stand in for
  // radial falloff (bake-svg has fills only).
  const glowRgb = glow.slice(0, 7);
  const glowSteps: [number, number, string][] = [
    [4.7, 2.7, "40"],
    [3.9, 2.1, "55"],
    [3.0, 1.5, "70"],
  ];
  for (const [rx, ry, a] of glowSteps) out += P(ellipse(8, 11.2, rx, ry), glowRgb + a);
  const sheen: [number, number, number, string][] = [
    [4.9, 4.9, 2.7, "38"],
    [4.6, 4.3, 2.2, "55"],
    [4.3, 3.6, 1.7, "80"],
    [4.0, 2.7, 1.15, "b8"],
  ];
  for (const [cy, rx, ry, a] of sheen) out += P(ellipse(8, cy, rx, ry), "#ffffff" + a);
  if (pressed) out += C(8, 8, 7, "#00000040");
  return out;
}
const LIGHTS: [string, string, string, string, string][] = [
  ["close", "#9a2b22", "#ff9080", "#c93023", "#ffc0b4"],
  ["min", "#97700f", "#ffe07a", "#dd9612", "#fff0a8"],
  ["zoom", "#1d7322", "#aeef9a", "#2fa030", "#ccffb8"],
  ["gray", "#8f8f8f", "#eeeeee", "#b0b0b0", "#ffffff"],
];

/** A stadium (pill) and horizontal slices of it. Every band, gloss and glow
 *  of the Luna Start button is cut to this exact outline — a rounded rect of
 *  any other radius spills past the curve and hazes the taskbar behind it. */
interface Pill {
  /** Centers of the left and right end caps, their shared center y, radius. */
  xl: number;
  xr: number;
  cy: number;
  r: number;
}
function pillSlice(p: Pill, ya: number, yb: number): string {
  const top = Math.max(ya, p.cy - p.r);
  const bot = Math.min(yb, p.cy + p.r);
  if (bot <= top) return "";
  const half = (y: number) => {
    const t = Math.max(-1, Math.min(1, (y - p.cy) / p.r));
    return p.r * Math.sqrt(1 - t * t);
  };
  const n = 14;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const y = top + ((bot - top) * i) / n;
    pts.push([p.xl - half(y), y]);
  }
  for (let i = n; i >= 0; i--) {
    const y = top + ((bot - top) * i) / n;
    pts.push([p.xr + half(y), y]);
  }
  return poly(pts);
}
function pillGrad(p: Pill, stops: string[], bands: number): string {
  const y0 = p.cy - p.r;
  const y1 = p.cy + p.r;
  const at = (t: number): string => {
    const pos = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(pos));
    return lerpHex(stops[i], stops[i + 1], pos - i);
  };
  let out = "";
  for (let i = 0; i < bands; i++) {
    const ya = y0 + ((y1 - y0) * i) / bands;
    const yb = y0 + ((y1 - y0) * (i + 1)) / bands + 0.03;
    out += P(pillSlice(p, ya, yb), at((i + 0.5) / bands));
  }
  return out;
}

/** Luna's Start pill: dark rim, green gradient, a top gloss fading out, a
 *  seat glow. 128x32; the pill spans x 0..98 and the taskbar's full 30px,
 *  the visible 84px are x 14..98 (the taskbar clips the left overhang). */
function xpStart(pressed: boolean): string {
  const rim: Pill = { xl: 15, xr: 83, cy: 16, r: 15 };
  const body: Pill = { xl: 15, xr: 83, cy: 16, r: 14 };
  const stops = pressed
    ? ["#2b7a2e", "#256f28", "#236927", "#2a7a2d", "#358a38"]
    : ["#5cb860", "#43a247", "#338f36", "#2c8330", "#2f8a34", "#3f9b47"];
  const gloss = pressed
    ? P(pillSlice(body, 2, 10), "#00000030") + P(pillSlice(body, 2, 5), "#0000002a")
    : P(pillSlice(body, 2, 14.5), "#ffffff1f") +
      P(pillSlice(body, 2, 11.5), "#ffffff21") +
      P(pillSlice(body, 2, 8.5), "#ffffff24") +
      P(pillSlice(body, 2, 5.5), "#ffffff2b") +
      P(pillSlice(body, 2, 3.4), "#ffffff40");
  const seat = pressed
    ? ""
    : P(pillSlice(body, 23.5, 30), "#b4eeb42e") + P(pillSlice(body, 26.5, 30), "#c4f4c43d");
  return (
    P(pillSlice(rim, 1, 31), pressed ? "#174a18" : "#1f5a20") +
    pillGrad(body, stops, 14) +
    gloss +
    seat
  );
}

/** Toolbar arrows. Aqua: a dark chevron arrow for its gel pills. Luna: a
 *  green gel disc carrying a white arrow (Explorer's Back / Forward), and
 *  a folder with a green arrow for Up. Drawn in a 16-space tile. */
function arrowPath(dir: "left" | "right" | "up", cx: number, cy: number, w: number): string {
  const s = 3.6;
  const pts: Pt[] =
    dir === "left"
      ? [[cx + s, cy], [cx - s, cy]]
      : dir === "right"
        ? [[cx - s, cy], [cx + s, cy]]
        : [[cx, cy + s], [cx, cy - s]];
  const head: Pt[] =
    dir === "left"
      ? [[cx - s + 2.6, cy - 3], [cx - s, cy], [cx - s + 2.6, cy + 3]]
      : dir === "right"
        ? [[cx + s - 2.6, cy - 3], [cx + s, cy], [cx + s - 2.6, cy + 3]]
        : [[cx - 3, cy - s + 2.6], [cx, cy - s], [cx + 3, cy - s + 2.6]];
  return sweep(pts, w) + sweep(head, w);
}
function lunaDisc(): string {
  return (
    C(8, 8, 7.2, "#1f6a24") +
    C(8, 8, 6.4, "#3fa246") +
    C(8, 7.2, 5.6, "#57b95c") +
    P(ellipse(8, 4.6, 4.2, 1.8), "#ffffff73")
  );
}
const NAV: VectorIcon[] = [
  { file: "aqua-back-16.svg", size: 16, body: P(arrowPath("left", 8, 8, 2.2), "#3a3a3a") },
  { file: "aqua-forward-16.svg", size: 16, body: P(arrowPath("right", 8, 8, 2.2), "#3a3a3a") },
  { file: "aqua-up-16.svg", size: 16, body: P(arrowPath("up", 8, 8, 2.2), "#3a3a3a") },
  { file: "xp-back-16.svg", size: 16, body: lunaDisc() + P(arrowPath("left", 8, 8, 1.9), "#ffffff") },
  { file: "xp-forward-16.svg", size: 16, body: lunaDisc() + P(arrowPath("right", 8, 8, 1.9), "#ffffff") },
  {
    file: "xp-up-16.svg",
    size: 16,
    body:
      P(rrect(1, 5, 14, 9.5, 1.2), "#b98a25") +
      vgrad(1.5, 5.5, 13, 8.5, 0.8, ["#fbe6a1", "#e9bf4e"], 4) +
      P(arrowPath("up", 8, 9.6, 1.9), "#2f7f33"),
  },
];

// 8px Aqua marks: the traffic-light glyphs that surface on hover (dark
// tints of each light), the menu chevron, and the Dock's running triangle;
// plus the 16px resize grip (three grooves stepping into the corner).
const AQUA_MARKS: VectorIcon[] = [
  ...LIGHTS.flatMap(([name, rim, body, deep, glow]): VectorIcon[] => [
    { file: `aqua-light-${name}.svg`, size: 16, body: light(rim, body, deep, glow, false) },
    { file: `aqua-light-${name}-down.svg`, size: 16, body: light(rim, body, deep, glow, true) },
  ]),
  {
    file: "aqua-cap-close.svg",
    size: 8,
    body: `<path fill="#4b1611" d="${bar(1.6, 1.6, 6.4, 6.4, 1.7)}${bar(6.4, 1.6, 1.6, 6.4, 1.7)}"/>`,
  },
  { file: "aqua-cap-min.svg", size: 8, body: R(1.5, 3.2, 5, 1.7, "#5b4306") },
  {
    file: "aqua-cap-zoom.svg",
    size: 8,
    body: R(1.5, 3.2, 5, 1.7, "#12461a") + R(3.15, 1.5, 1.7, 5, "#12461a"),
  },
  {
    file: "aqua-menu-arrow.svg",
    size: 8,
    body: P(poly([[2, 1], [6.2, 4], [2, 7]]), "#000000"),
  },
  {
    file: "aqua-dock-mark.svg",
    size: 8,
    body: P(poly([[1, 7], [7, 7], [4, 2.2]]), "#000000d0"),
  },
  {
    file: "xp-start.svg",
    size: 32,
    body: xpStart(false),
  },
  {
    file: "xp-start-down.svg",
    size: 32,
    body: xpStart(true),
  },
  {
    file: "aqua-grip.svg",
    size: 16,
    body:
      `<path fill="#ffffffcc" d="${bar(5.5, 15.5, 15.5, 5.5, 1)}${bar(9.5, 15.5, 15.5, 9.5, 1)}${bar(13.5, 15.5, 15.5, 13.5, 1)}"/>` +
      `<path fill="#7f7f7f" d="${bar(4.5, 14.5, 14.5, 4.5, 1)}${bar(8.5, 14.5, 14.5, 8.5, 1)}${bar(12.5, 14.5, 14.5, 12.5, 1)}"/>`,
  },
];

for (const icon of [...AQUA_MARKS, ...NAV]) {
  const size = icon.size ?? 16;
  const w = icon.file.startsWith("xp-start") ? 128 : size;
  await Bun.write(
    join(outDir, icon.file),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${size}" ` +
      `viewBox="0 0 ${w} ${size}">${icon.body}</svg>`,
  );
  count++;
}
for (const icon of NATIVE) {
  await Bun.write(join(outDir, icon.file), svgFor(icon.rows, 1));
  count++;
}
console.log(`gen-icons: wrote ${count} SVGs to src/system-ui/icons/`);

// These six reviewed PNGs are offline Cycles bakes, not regenerated SVGs.
// Keep normal builds independent of Blender and publish both render densities.
for (const name of ["files", "devices"]) {
  const baked = join(import.meta.dir, "../../assets/icons");
  for (const size of [16, 32]) {
    copyFileSync(join(baked, `${name}-${size}.png`), join(outDir, `${name}-${size}.png`));
    copyFileSync(join(baked, `${name}-${size * 2}.png`), join(outDir, `${name}-${size}@2x.png`));
  }
}
