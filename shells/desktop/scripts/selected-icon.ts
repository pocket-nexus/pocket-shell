// SPDX-License-Identifier: GPL-3.0-only
import { deflateSync } from "node:zlib";
import { decodePng } from "../../../vendor/pocketjs/framework/compiler/pak.ts";

/** Preserve the authored silhouette and alpha, including antialiased edges.
 * Selection is theme paint, generated at build time for native image hosts. */
export function selectedIcon(input: Uint8Array, theme: string, density: number): Buffer {
  const { width, height, rgba } = decodePng(input);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (theme === "classic-") {
      const stipple = (Math.floor(x / density) + Math.floor(y / density)) % 2 === 0;
      for (let c = 0; c < 3; c++) rgba[i + c] = stipple ? (c === 2 ? 128 : 0) : Math.round(rgba[i + c] * .55);
    } else if (theme === "xp-") {
      rgba[i] = Math.round(rgba[i] * .48 + 20);
      rgba[i + 1] = Math.round(rgba[i + 1] * .52 + 40);
      rgba[i + 2] = Math.round(rgba[i + 2] * .55 + 85);
    } else {
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(rgba[i + c] * .58);
    }
  }
  function chunk(type: string, payload: Buffer): Buffer {
    const body = Buffer.concat([Buffer.from(type), payload]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const head = Buffer.alloc(4), tail = Buffer.alloc(4);
    head.writeUInt32BE(payload.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([head, body, tail]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
