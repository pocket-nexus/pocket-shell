// SPDX-License-Identifier: GPL-3.0-only
// test/wrap-op.test.ts — the wrapText op (spec op 43) against the JS greedy
// fallback (src/system-ui/notepad.ts wrapLine). On a baked host both reduce to
// the same additive atlas advances, so their break columns must agree
// column-for-column — this is the parity that lets apps use the op when
// present and the JS rules when not, without the layout ever moving.
//
// Runs on the wasm core with system-ui's generated W95FA atlas (slot 19) — the
// real consumer's font, spaces and CJK-free ASCII plus over-wide tokens.
//
// The same generated atlases are checked glyph by glyph below: the density-1
// bake of the 12.5px face once thresholded its comma and its semicolon away.

import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  FONT_CMAP_ENTRY_SIZE,
  FONT_HEADER_SIZE,
} from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import { createWasmUi } from "../../../vendor/pocketjs/hosts/web/wasm-ops.js";
import { segsFromBreaks, wrapLine } from "../src/system-ui/notepad.ts";
import { prepareAssets } from "../scripts/prepare-assets.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const WASM_PATH = join(ROOT, "../../vendor/pocketjs/hosts/web/pocketjs.wasm");

function ensureBuilt(path: string, cmd: string[]): void {
  if (existsSync(path)) return;
  const p = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0 || !existsSync(path)) throw new Error(`wrap-op: failed to produce ${path}`);
}

const SLOT = 19;
let ops: {
  loadFontAtlas(buf: Uint8Array): void;
  measureText(s: string, slot: number): number;
  wrapText?(s: string, slot: number, maxW: number): number[];
};

beforeAll(async () => {
  await prepareAssets();
  ensureBuilt(WASM_PATH, [process.execPath, "../../vendor/pocketjs/tools/wasm.ts"]);
  const wasm = await createWasmUi(await Bun.file(WASM_PATH).arrayBuffer());
  ops = {
    loadFontAtlas: wasm.ops.loadFontAtlas!,
    measureText: wasm.ops.measureText!,
    wrapText: wasm.ops.wrapText,
  };
  const atlas = await Bun.file(join(ROOT, "src/system-ui/fonts/w95fa-19.bin")).arrayBuffer();
  ops.loadFontAtlas(new Uint8Array(atlas));
});

const SAMPLES = [
  "",
  "Welcome to Pocket Shell Desktop.",
  "This desktop is one PocketJS guest: the windows, the taskbar, the Start menu and this Notepad are SolidJS JSX over the same DrawList contract the consoles boot, painted by the portable Rust backend.",
  "  - drag-select this text; Cmd+C/X/V, right-click",
  "word",
  "spaces      hang    at   soft   breaks      ",
  "averyveryverylongunbreakabletokenthatmustcharsplitacrossrows plus a tail",
  "a b c d e f g h i j k l m n o p q r s t u v w x y z",
];
const WIDTHS = [24, 60, 120, 200, 388];

describe("wrapText op ↔ JS fallback parity", () => {
  test("the op exists on the wasm host", () => {
    expect(typeof ops.wrapText).toBe("function");
  });

  test("break columns agree with the greedy JS rules for every sample", () => {
    const width = (s: string) => ops.measureText(s, SLOT);
    for (const line of SAMPLES) {
      for (const maxW of WIDTHS) {
        const opBreaks = ops.wrapText!(line, SLOT, maxW);
        const jsBreaks = wrapLine(line, maxW, width)
          .slice(1)
          .map((s) => s.from);
        expect({ line, maxW, breaks: opBreaks }).toEqual({ line, maxW, breaks: jsBreaks });
        // Segments rebuilt from the op tile the line exactly.
        const segs = segsFromBreaks(line.length, opBreaks);
        expect(segs[0].from).toBe(0);
        expect(segs[segs.length - 1].to).toBe(line.length);
        for (let i = 1; i < segs.length; i++) expect(segs[i].from).toBe(segs[i - 1].to);
      }
    }
  });

  test("fitting lines and empty text produce no breaks", () => {
    expect(ops.wrapText!("", SLOT, 100)).toEqual([]);
    expect(ops.wrapText!("short", SLOT, 10000)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The generated Classic atlases (FONT ATLAS format, spec.ts)
// ---------------------------------------------------------------------------

interface Glyph {
  advance: number;
  /** Coverage samples of the glyph's cell that hold ink. */
  ink: number;
  /** Samples with partial coverage; the Classic face is thresholded to none. */
  partial: number;
}

async function readAtlas(file: string): Promise<Map<number, Glyph>> {
  const bytes = new Uint8Array(
    await Bun.file(join(ROOT, "src/system-ui/fonts", file)).arrayBuffer(),
  );
  const view = new DataView(bytes.buffer);
  const count = view.getUint16(6, true);
  const density = bytes[14];
  const cell = bytes[8] * density * bytes[9] * density;
  const coverage = FONT_HEADER_SIZE + count * FONT_CMAP_ENTRY_SIZE;
  const glyphs = new Map<number, Glyph>();
  for (let i = 0; i < count; i++) {
    const entry = FONT_HEADER_SIZE + i * FONT_CMAP_ENTRY_SIZE;
    const samples = bytes.subarray(
      coverage + view.getUint16(entry + 4, true) * cell,
      coverage + (view.getUint16(entry + 4, true) + 1) * cell,
    );
    glyphs.set(view.getUint32(entry, true), {
      advance: bytes[entry + 6],
      ink: samples.filter((b) => b > 0).length,
      partial: samples.filter((b) => b > 0 && b < 255).length,
    });
  }
  return glyphs;
}

describe("the Classic face at both densities", () => {
  const ASCII = Array.from({ length: 95 }, (_, i) => 32 + i);
  const FILES = ["w95fa-19", "w95fa-20"];

  test("every ASCII glyph but the space has ink, at density 1 as at density 2", async () => {
    for (const file of FILES) {
      for (const suffix of ["", "@2x"]) {
        const atlas = await readAtlas(`${file}${suffix}.bin`);
        const blank = ASCII.filter((cp) => cp !== 32 && !(atlas.get(cp)!.ink > 0))
          .map((cp) => String.fromCodePoint(cp));
        expect({ atlas: `${file}${suffix}`, blank }).toEqual({ atlas: `${file}${suffix}`, blank: [] });
      }
    }
  });

  test("the bakes are bi-level: no sample holds partial coverage", async () => {
    for (const file of FILES) {
      for (const suffix of ["", "@2x"]) {
        const atlas = await readAtlas(`${file}${suffix}.bin`);
        for (const cp of ASCII) expect(atlas.get(cp)!.partial).toBe(0);
      }
    }
  });

  test("a glyph advances the same logical width at both densities", async () => {
    for (const file of FILES) {
      const one = await readAtlas(`${file}.bin`);
      const two = await readAtlas(`${file}@2x.bin`);
      for (const cp of ASCII) {
        expect({ cp, advance: one.get(cp)!.advance }).toEqual({ cp, advance: two.get(cp)!.advance });
      }
    }
  });

  test("the comma and the semicolon draw at density 1", async () => {
    const atlas = await readAtlas("w95fa-19.bin");
    const ink = (ch: string) => atlas.get(ch.codePointAt(0)!)!.ink;
    // A comma is a period with a tail, and a semicolon a comma under a dot.
    expect(ink(".")).toBeGreaterThan(0);
    expect(ink(",")).toBeGreaterThan(ink("."));
    expect(ink(";")).toBeGreaterThan(ink(","));
  });
});
