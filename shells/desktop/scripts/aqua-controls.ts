// SPDX-License-Identifier: GPL-3.0-only
import { encodeRgbaPng } from "./selected-icon.ts";

/** Bake the complete gel face with 8x coverage sampling. Raster alpha covers
 * the rim and gradient together, including the 1x and Retina silhouettes. */
export function aquaControl(width: number, state: "normal" | "down" | "disabled", density: number): Buffer {
  const w = (width === 28 ? 32 : 64) * density, h = 32 * density, rgba = new Uint8Array(w * h * 4);
  const radius = 10.5, rim = state === "down" ? 110 : state === "disabled" ? 179 : 138;
  const inside = (x: number, y: number, inset: number) => {
    const r = radius - inset, cx = Math.max(radius + .5, Math.min(width - radius - .5, x));
    return (x - cx) ** 2 + (y - 11) ** 2 <= r * r;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let coverage = 0, color = 0;
    for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++) {
      const px = (x + (sx + .5) / 8) / w * width, py = (y + (sy + .5) / 8) / h * 22;
      if (!inside(px, py, 0)) continue;
      coverage++;
      color += !inside(px, py, 1) ? rim : state === "disabled" ? 231 : state === "down" ? 184 + py * 1.1 : 255 - py * 1.5;
    }
    const at = (y * w + x) * 4;
    if (coverage) { rgba.fill(Math.round(color / coverage), at, at + 3); rgba[at + 3] = Math.round(coverage / 64 * 255); }
  }
  return encodeRgbaPng(w, h, rgba);
}
