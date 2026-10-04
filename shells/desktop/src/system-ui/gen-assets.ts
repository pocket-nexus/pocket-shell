// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/gen-assets.ts — bakes W95FA (assets/fonts/W95FA.otf, OFL; the
// FontsArena Win95 MS Sans Serif recreation) into per-app FONT ATLAS blobs,
// generated under ignored src/system-ui/fonts/ and spliced by pak.json:
//
//   bun src/system-ui/gen-assets.ts
//
// It also bakes the smooth face the XP and Aqua themes share. Tahoma and
// Trebuchet MS (the fonts Windows XP ships) and Lucida Grande (Mac OS X's) are
// Microsoft's and Apple's and cannot be redistributed, so both themes borrow
// the vendored Inter (OFL) — the same neutral grotesque the framework's own
// slots use. Their text is antialiased, so these slots keep their coverage
// instead of thresholding it the way the W95FA bitmap face does. Aqua gets no
// slots of its own: the five below are the whole app budget.
//
// Slots (spec.ts MAX_FONT_SLOTS is 24 and the framework pins 0..18, so the
// five app-side slots below are the whole budget — a third XP size would
// need the contract widened):
//   19  W95FA 12.5px regular — the whole Classic desktop
//   20  W95FA 12.5px synthetic bold (GDI smear: 1px max-blend + advance+1)
//   21  W95FA 25px regular — Classic's About banner
//   22  Inter 12px regular — the whole XP and Aqua desktops
//   23  Inter 12.5px bold — XP/Aqua captions, task buttons, panel headings
//
// W95FA is a bitmap-font conversion on an 80-units/px grid at its native
// 12.5px, with sloppy CFF floats (…129.92 for 130) and a 10-unit x phase.
// Coordinates snap to the 40-unit half-pixel grid minus that phase before
// baking, so at rasterDensity 2 every stroke edge lands on a device pixel;
// the bake then hard-thresholds coverage to 0/255 and asserts the AA
// fraction was already negligible (the snap really aligned) and that
// edge-sharing strokes survived the fill ('h' keeps its ascender — the
// nonzero-winding guarantee this font's outlines depend on).
//
// At rasterDensity 1 a device pixel is 80 units at 12.5px. The font's
// vertical edges sit at 50 + 80k units, which the half-pixel snap leaves in
// the middle of a device pixel, and a few glyphs (comma, semicolon, hyphen,
// equals, quotes) are drawn a fraction of a pixel off in y. The threshold
// then drops what covers half a pixel: the comma and the semicolon bake
// empty, and the quotes, the hyphen and the equals sign lose pixels. The
// 12.5px slots at density 1 therefore bake from a second snap, to the
// 80-unit grid with the 50-unit phase, where every edge is a device pixel
// edge again. The 25px slot keeps the 40-unit snap: 40 units are its device
// pixel at density 1. Every density then asserts that the snap aligned and
// that each mapped glyph but the space has ink.

import { parse as parseFont, type Font } from "opentype.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  bakeSlot,
  type BakedAtlas,
} from "../../../../vendor/pocketjs/framework/compiler/bake-font.ts";
import {
  FONT_CMAP_ENTRY_SIZE,
  FONT_FLAG_BOLD,
  FONT_HEADER_SIZE,
} from "../../../../vendor/pocketjs/contracts/spec/spec.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const OUT = join(ROOT, "src/system-ui/fonts");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const PHASE = 10; // measured x offset of the outline grid, font units
const STEP = 40; // half-pixel grid at 12.5px (80 units/px)
/** The whole-pixel grid at 12.5px and the x offset of the font's pixel
 *  columns on it (50 is 10 on the half-pixel grid). */
const PIXEL_STEP = STEP * 2;
const PIXEL_PHASE = PHASE + STEP;

/** W95FA with its outlines snapped to a `step`-unit grid whose x origin sits
 *  at `phase`. */
async function loadSnapped(step: number, phase: number): Promise<Font> {
  const snapCoord = (v: number, offset: number): number =>
    Math.round((v - offset) / step) * step;
  const font = parseFont(await Bun.file(join(ROOT, "assets/fonts/W95FA.otf")).arrayBuffer());
  // Snap only the glyphs the bake reads — .notdef and unmapped decorations
  // are off-grid and never rasterized (gid 0 is the drawn tofu box).
  const gids = new Set<number>();
  for (const cp of CHARS) {
    const gi = font.charToGlyphIndex(String.fromCodePoint(cp));
    if (gi > 0) gids.add(gi);
  }
  for (const gi of gids) {
    const glyph = font.glyphs.get(gi);
    const path = glyph.path as { commands?: Array<Record<string, number | string>> };
    for (const cmd of path?.commands ?? []) {
      for (const key of ["x", "x1", "x2"]) {
        if (typeof cmd[key] === "number") {
          const s = snapCoord(cmd[key] as number, phase);
          const err = Math.abs((cmd[key] as number) - phase - s);
          // Two conversion strays ('"' and 'y') sit up to 16 units off the
          // grid — snap them too (≤0.2px drift); anything worse is a new
          // font revision and needs a fresh look.
          if (err > 20) {
            throw new Error(`gen-assets: gid ${gi} x=${cmd[key]} is off the ${step}-unit grid`);
          }
          cmd[key] = s;
        }
      }
      for (const key of ["y", "y1", "y2"]) {
        if (typeof cmd[key] === "number") cmd[key] = snapCoord(cmd[key] as number, 0);
      }
    }
  }

  // W95FA ships no backtick (cp 96 → .notdef, the drawn tofu box), but the
  // desktop's ⌘` shortcut copy needs one. Synthesize it: mirror the
  // apostrophe's ink around its own x bounds (the mark leans the other way;
  // bounds are snapped 40-multiples, so the mirror stays on the pixel grid)
  // into a donor glyph outside the ASCII set, and remap cp 96 onto it. The
  // same holds on the whole-pixel grid, whose bounds are 80-multiples.
  const apoGi = font.charToGlyphIndex("'");
  const apo = font.glyphs.get(apoGi);
  const apoCmds = (apo.path as { commands: Array<Record<string, number | string>> }).commands;
  const xs: number[] = [];
  for (const cmd of apoCmds) {
    for (const key of ["x", "x1", "x2"]) {
      if (typeof cmd[key] === "number") xs.push(cmd[key] as number);
    }
  }
  const pivot = Math.min(...xs) + Math.max(...xs);
  let donorGid = -1;
  for (let gi = font.glyphs.length - 1; gi > 0; gi--) {
    if (!gids.has(gi)) {
      donorGid = gi;
      break;
    }
  }
  if (donorGid < 0) throw new Error("gen-assets: no donor gid for the synthetic backtick");
  const donor = font.glyphs.get(donorGid);
  const donorPath = donor.path as { commands: Array<Record<string, number | string>> };
  donorPath.commands.length = 0;
  for (const cmd of apoCmds) {
    const m: Record<string, number | string> = { ...cmd };
    for (const key of ["x", "x1", "x2"]) {
      if (typeof m[key] === "number") m[key] = pivot - (m[key] as number);
    }
    donorPath.commands.push(m);
  }
  donor.advanceWidth = apo.advanceWidth;
  const origIndex = font.charToGlyphIndex.bind(font);
  font.charToGlyphIndex = (s: string) => (s === "`" ? donorGid : origIndex(s));

  return font;
}

const CHARS: number[] = [];
for (let c = 32; c <= 126; c++) CHARS.push(c);

/** Hard-threshold the coverage plane to 0/255 and report the AA fraction. */
function threshold(atlas: BakedAtlas): number {
  const cmapEnd = FONT_HEADER_SIZE + atlas.glyphCount * FONT_CMAP_ENTRY_SIZE;
  let aa = 0;
  let ink = 0;
  for (let i = cmapEnd; i < atlas.bytes.length; i++) {
    const b = atlas.bytes[i];
    if (b > 0) ink++;
    if (b > 0 && b < 255) {
      aa++;
      atlas.bytes[i] = b >= 128 ? 255 : 0;
    }
  }
  return ink > 0 ? aa / ink : 0;
}

/** Coverage cell for a codepoint (gid-indexed cells after header + cmap). */
function cellFor(atlas: BakedAtlas, cp: number): Uint8Array {
  const view = new DataView(atlas.bytes.buffer, atlas.bytes.byteOffset, atlas.bytes.byteLength);
  const cellBytes = atlas.coverageW * atlas.coverageH;
  const cellsOff = FONT_HEADER_SIZE + atlas.glyphCount * FONT_CMAP_ENTRY_SIZE;
  for (let i = 0; i < atlas.glyphCount; i++) {
    const e = FONT_HEADER_SIZE + i * FONT_CMAP_ENTRY_SIZE;
    if (view.getUint32(e, true) === cp) {
      const gid = view.getUint16(e + 4, true);
      return atlas.bytes.subarray(cellsOff + gid * cellBytes, cellsOff + (gid + 1) * cellBytes);
    }
  }
  throw new Error(`gen-assets: codepoint ${cp} missing from the bake`);
}

/** Synthetic bold: widen cells by one logical px, max-blend a copy shifted
 *  one logical px right (the classic GDI smear), advance +1. Rebuilds the
 *  blob because cellW changes. */
function embolden(src: BakedAtlas, slot: number): Uint8Array {
  const d = src.rasterDensity;
  const srcW = src.coverageW;
  const dstCellW = src.cellW + 1;
  const dstW = dstCellW * d;
  const h = src.coverageH;
  const cellBytesSrc = srcW * h;
  const cellBytesDst = dstW * h;
  const cmapBytes = src.glyphCount * FONT_CMAP_ENTRY_SIZE;
  const out = new Uint8Array(FONT_HEADER_SIZE + cmapBytes + src.glyphCount * cellBytesDst);
  out.set(src.bytes.subarray(0, FONT_HEADER_SIZE + cmapBytes));
  out[8] = dstCellW;
  out[12] = slot;
  out[13] = FONT_FLAG_BOLD;
  // Advances grow one logical px (clamped to the u8 the cmap carries).
  for (let i = 0; i < src.glyphCount; i++) {
    const a = FONT_HEADER_SIZE + i * FONT_CMAP_ENTRY_SIZE + 6;
    out[a] = Math.min(255, out[a] + 1);
  }
  const srcCells = FONT_HEADER_SIZE + cmapBytes;
  for (let g = 0; g < src.glyphCount; g++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < dstW; x++) {
        const at = (dx: number) => {
          const sx = x - dx;
          return sx >= 0 && sx < srcW
            ? src.bytes[srcCells + g * cellBytesSrc + y * srcW + sx]
            : 0;
        };
        out[srcCells + g * cellBytesDst + y * dstW + x] = Math.max(at(0), at(d));
      }
    }
  }
  return out;
}

/** Luna face: the vendored Inter, baked with its coverage intact. */
async function bakeLuna(density: number): Promise<[BakedAtlas, BakedAtlas]> {
  const dir = join(ROOT, "../../vendor/pocketjs/assets/fonts");
  const regular = parseFont(await Bun.file(join(dir, "Inter-Regular.ttf")).arrayBuffer());
  const bold = parseFont(await Bun.file(join(dir, "Inter-Bold.ttf")).arrayBuffer());
  return [
    bakeSlot(regular, 22, 12, false, CHARS, density),
    bakeSlot(bold, 23, 12.5, true, CHARS, density),
  ];
}

/** Codepoints of the bake whose coverage cell holds no ink. */
function blankGlyphs(atlas: BakedAtlas): string[] {
  return CHARS.filter((cp) => cp !== 32 && !cellFor(atlas, cp).some((b) => b > 0))
    .map((cp) => String.fromCodePoint(cp));
}

const font = await loadSnapped(STEP, PHASE);
const pixelFont = await loadSnapped(PIXEL_STEP, PIXEL_PHASE);

for (const density of [1, 2]) {
  const suffix = density === 2 ? "@2x" : "";
  const a19 = bakeSlot(density === 1 ? pixelFont : font, 19, 12.5, false, CHARS, density);
  const aa19 = threshold(a19);
  const a21 = bakeSlot(font, 21, 25, false, CHARS, density);
  const aa21 = threshold(a21);
  // The snap guarantee: every edge is a device pixel, so the rasterizer
  // produced (near-)bi-level coverage BEFORE thresholding.
  if (aa19 > 0.02 || aa21 > 0.02) {
    throw new Error(`gen-assets: AA fraction too high at density ${density} (${aa19}, ${aa21}) — grid snap regressed?`);
  }
  // A glyph the threshold erased would draw as a gap in every string.
  const blank = [...blankGlyphs(a19), ...blankGlyphs(a21)];
  if (blank.length > 0) {
    throw new Error(`gen-assets: glyphs baked empty at density ${density}: ${blank.join(" ")}`);
  }
  // Fill-rule guarantee: W95FA strokes share edges; even-odd cancels them.
  const hCell = cellFor(a19, "h".codePointAt(0)!);
  const nCell = cellFor(a19, "n".codePointAt(0)!);
  if (Buffer.from(hCell).equals(Buffer.from(nCell))) {
    throw new Error("gen-assets: 'h' baked identical to 'n' — fill rule regressed to even-odd?");
  }
  if (!hCell.some((b) => b > 0)) throw new Error("gen-assets: 'h' baked empty");
  const a20 = embolden(a19, 20);
  const [a22, a23] = await bakeLuna(density);
  await Bun.write(join(OUT, `w95fa-19${suffix}.bin`), a19.bytes);
  await Bun.write(join(OUT, `w95fa-20${suffix}.bin`), a20);
  await Bun.write(join(OUT, `w95fa-21${suffix}.bin`), a21.bytes);
  await Bun.write(join(OUT, `inter-22${suffix}.bin`), a22.bytes);
  await Bun.write(join(OUT, `inter-23${suffix}.bin`), a23.bytes);
  console.log(
    `gen-assets: density ${density} — slot19 ${a19.bytes.length}B (AA ${(aa19 * 100).toFixed(2)}%), ` +
      `slot20 ${a20.length}B, slot21 ${a21.bytes.length}B (AA ${(aa21 * 100).toFixed(2)}%), ` +
      `slot22 ${a22.bytes.length}B, slot23 ${a23.bytes.length}B`,
  );
}
