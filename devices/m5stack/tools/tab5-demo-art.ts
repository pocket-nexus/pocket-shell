// Converts the M5Tab5-UserDemo factory images (LVGL C arrays, RGB565 or
// RGB565A8, made for 1280x720) into apps/tab5-demo/art: halved with a 2x2
// box filter for the 640x360 surface, then padded to power-of-two sides with
// opaque black (pak images are power-of-two, at most 512; PSM_5650 entries
// refuse alpha). The launcher picture is cut into four tiles.
//   bun tools/tab5-demo-art.ts <M5Tab5-UserDemo checkout>
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodePNG } from "../third_party/pocketjs/tools/png.ts";

const IMAGES = [
  "sw_on", "sw_off", "sw_chg_on", "sw_chg_off", "sw_qc_on", "sw_qc_off", "sw_rf_h", "sw_rf_l",
  "chg_arrow_up", "chg_arrow_down", "arrow_state_on", "internal_i2c_dev_chart", "porta_i2c_dev_chart",
  "porta_i2c_ext5v_on", "logo_tab", "logo_5",
];
/** The launcher picture's tiles on the halved 640x360 picture. */
const TILES = [
  { name: "bg_00", x: 0, y: 0, w: 512, h: 256 },
  { name: "bg_10", x: 512, y: 0, w: 128, h: 256 },
  { name: "bg_01", x: 0, y: 256, w: 512, h: 104 },
  { name: "bg_11", x: 512, y: 256, w: 128, h: 104 },
];

interface Raster { w: number; h: number; rgba: Uint8Array }

function readLvglImage(path: string): Raster {
  const text = readFileSync(path, "utf8");
  const w = Number(/\.header\.w\s*=\s*(\d+)/.exec(text)![1]);
  const h = Number(/\.header\.h\s*=\s*(\d+)/.exec(text)![1]);
  const alpha = /\.header\.cf\s*=\s*LV_COLOR_FORMAT_RGB565A8/.test(text);
  const start = text.indexOf("{", text.indexOf("_map[]")) + 1;
  const bytes = Uint8Array.from(text.slice(start, text.indexOf("};", start)).match(/0x[0-9a-fA-F]{2}/g)!.map(b => parseInt(b, 16)));
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; ++i) {
    const v = bytes[2 * i]! | bytes[2 * i + 1]! << 8;
    rgba[i * 4] = ((v >> 11 & 31) * 527 + 23) >> 6;
    rgba[i * 4 + 1] = ((v >> 5 & 63) * 259 + 33) >> 6;
    rgba[i * 4 + 2] = ((v & 31) * 527 + 23) >> 6;
    rgba[i * 4 + 3] = alpha ? bytes[2 * w * h + i]! : 255;
  }
  return { w, h, rgba };
}

function halve(image: Raster): Raster {
  const w = image.w >> 1, h = image.h >> 1;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; ++y) for (let x = 0; x < w; ++x) for (let c = 0; c < 4; ++c) {
    const at = (dx: number, dy: number) => image.rgba[((2 * y + dy) * image.w + 2 * x + dx) * 4 + c]!;
    rgba[(y * w + x) * 4 + c] = (at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1) + 2) >> 2;
  }
  return { w, h, rgba };
}

function pow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** The region (x, y, w, h) of `image` at the top left of a padded raster. */
function padded(image: Raster, x = 0, y = 0, w = image.w, h = image.h): Raster {
  const pw = pow2(w), ph = pow2(h);
  if (pw > 512 || ph > 512) throw new Error(`${w}x${h} pads past 512`);
  const rgba = new Uint8Array(pw * ph * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  for (let row = 0; row < Math.min(h, image.h - y); ++row)
    rgba.set(image.rgba.subarray(((y + row) * image.w + x) * 4, ((y + row) * image.w + x + w) * 4), row * pw * 4);
  return { w: pw, h: ph, rgba };
}

const source = resolve(process.argv[2] ?? "");
const images = join(source, "app", "assets", "images");
const out = resolve(import.meta.dir, "..", "apps", "tab5-demo", "art");
const write = (name: string, raster: Raster) => {
  writeFileSync(join(out, `${name}.png`), encodePNG(raster.rgba, raster.w, raster.h));
  console.log(`${name}.png ${raster.w}x${raster.h}`);
};
const launcher = halve(readLvglImage(join(images, "launcher_bg.c")));
for (const tile of TILES) write(tile.name, padded(launcher, tile.x, tile.y, tile.w, tile.h));
for (const name of IMAGES) write(name, padded(halve(readLvglImage(join(images, `${name}.c`)))));
