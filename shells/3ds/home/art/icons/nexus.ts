// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/home/art/icons/nexus.ts — Pocket Nexus's icon picture: the O
// with a face from the Pocket Nexus wordmark, on the wordmark's night plum.
//
//   bun shells/3ds/home/art/icons/nexus.ts <render dir>
//
// The letter is the wordmark's own art: PocketJS's apps/nexus/art/draw.js
// (NX.letter, the homepage's sticker letters in Titan One) evaluated in
// headless Chrome at the size of a Blender render, so bake.ts finishes it
// like every other icon. Titan One loads from Google Fonts at render time;
// builds read the baked PNGs.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HeadlessChrome } from "../../../../../vendor/pocketjs/tools/headless-chrome.ts";

const DRAW_JS = resolve(import.meta.dir, "../../../../../vendor/pocketjs/apps/nexus/art/draw.js");
const OUT = resolve(process.argv[2] ?? ".pocket-build/home-icons/render");
const RES = 512;
/** The letter's font size: the O with its keyline fills about 85% of the tile. */
const FS = 450;
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Titan+One&display=block">
<style>html,body{margin:0;background:transparent}</style></head><body></body></html>`;

const chrome = await HeadlessChrome.start({ port: 9352, profile: `${process.env.TMPDIR ?? "/tmp/"}pocket-home-nexus-icon` });
try {
  await chrome.viewport(RES, RES);
  await chrome.html(PAGE);
  const loaded = await chrome.evaluate(`(async () => {
    for (let i = 0; i < 150; i++) {
      await document.fonts.load('100px "Titan One"', "O");
      if (document.fonts.check('100px "Titan One"', "O")) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  })()`);
  if (!loaded) throw new Error("Titan One did not load");
  await chrome.evaluate(`${await Bun.file(DRAW_JS).text()}\ntrue`);
  const url: string = await chrome.evaluate(`(() => {
    const n = ${RES}, c = document.createElement("canvas");
    c.width = n; c.height = n;
    const g = c.getContext("2d");
    // The plate: the wordmark's night plum, lighter toward the top, with a
    // warm glow behind the letter like the homepage's haze.
    const plate = g.createLinearGradient(0, 0, 0, n);
    plate.addColorStop(0, "#74479f"); plate.addColorStop(1, "#2c1650");
    g.fillStyle = plate; g.fillRect(0, 0, n, n);
    const glow = g.createRadialGradient(n / 2, n * 0.52, 0, n / 2, n * 0.52, n * 0.5);
    glow.addColorStop(0, "rgba(255, 200, 90, .34)"); glow.addColorStop(1, "rgba(255, 200, 90, 0)");
    g.fillStyle = glow; g.fillRect(0, 0, n, n);
    // Three of the wordmark's confetti colours, large enough to read at 46 px.
    const bits = [["#3fd0e8", 0.17, 0.2, 0.5], ["#ff5f9e", 0.84, 0.17, -0.5], ["#ffd23f", 0.86, 0.85, 0.4]];
    for (const [color, x, y, a] of bits) {
      g.save(); g.translate(x * n, y * n); g.rotate(a);
      g.beginPath(); g.roundRect(-n * 0.055, -n * 0.022, n * 0.11, n * 0.044, n * 0.022);
      g.fillStyle = color; g.fill(); g.restore();
    }
    // The letter's drop shadow, then the letter with its open face.
    const drop = NX.shadow("O", "yellow", true, ${FS}, n);
    g.globalAlpha = 0.55; g.drawImage(drop, 0, n * 0.03); g.globalAlpha = 1;
    g.drawImage(NX.letter("O", "yellow", true, "open", ${FS}, n), 0, 0);
    return c.toDataURL("image/png");
  })()`);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "nexus.png"), Uint8Array.from(atob(url.split(",")[1]!), (ch) => ch.charCodeAt(0)));
  console.log(`rendered nexus -> ${join(OUT, "nexus.png")}`);
} finally {
  chrome.stop();
}
