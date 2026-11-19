// SPDX-License-Identifier: GPL-3.0-or-later
// The mark the PSP program's veil draws between two guests (program/src/veil.rs,
// POCKET_SHELL_VEIL_LOGO): the geometry of PocketJS's
// assets/brand/pocketjs-avatar-white-minimal.svg (1024 viewBox), a 76-wide
// stroked round-rect, the face circle and two rounded bars, white with real
// alpha, supersampled at 512 and downscaled to 128x128 RGBA.

import { resizeBilinear } from "../../vendor/pocketjs/tools/image-resize.ts";

export const VEIL_LOGO_SIZE = 128;

export function bakeVeilLogo(): Uint8Array {
  const S = 512;
  const k = S / 1024;
  const sdRoundRect = (px: number, py: number, cx: number, cy: number, hw: number, hh: number, r: number) => {
    const qx = Math.abs(px - cx) - (hw - r);
    const qy = Math.abs(py - cy) - (hh - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const big = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = (x + 0.5) / k;
      const py = (y + 0.5) / k;
      const outline = Math.abs(sdRoundRect(px, py, 512, 512, 414, 246, 147)) - 38;
      const face = Math.hypot(px - 338, py - 512) - 92;
      const bar1 = sdRoundRect(px, py, 664, 449, 152, 35, 35);
      const bar2 = sdRoundRect(px, py, 614, 583, 102, 35, 35);
      const d = Math.min(outline, face, bar1, bar2);
      const o = (y * S + x) * 4;
      big[o] = big[o + 1] = big[o + 2] = 255;
      big[o + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - (d * k) / 1.5)));
    }
  }
  return resizeBilinear(big, S, S, VEIL_LOGO_SIZE, VEIL_LOGO_SIZE);
}
