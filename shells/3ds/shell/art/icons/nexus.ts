// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/shell/art/icons/nexus.ts — Pocket Nexus's icon picture: the
// PocketJS mark on a light lavender plate.
//
//   bun shells/3ds/shell/art/icons/nexus.ts <render dir>
//
// The mark is PocketJS's own drawing (the yellow shell, plum screen, pink
// dot and cyan and pink keys; vendor/pocketjs/skills/pocketjs-video-outro/
// assets/pocketjs-mark.svg), drawn flat at four fifths of the tile with a
// soft drop shadow, at the size of a Blender render, so bake.ts finishes it
// like every other icon.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createCanvas, Image } from "@napi-rs/canvas";

const MARK_SVG = resolve(import.meta.dir, "../../../../../vendor/pocketjs/skills/pocketjs-video-outro/assets/pocketjs-mark.svg");
const OUT = resolve(process.argv[2] ?? ".pocket-build/shell-icons/render");
const RES = 512;
/** The mark's side as a fraction of the tile. */
const MARK = 0.8;

// The SVG names only a viewBox: give it a drawn size so it rasterizes sharp.
const svg = readFileSync(MARK_SVG, "utf8").replace("<svg ", `<svg width="${RES}" height="${RES}" `);
const mark = new Image();
mark.src = Buffer.from(svg);

const canvas = createCanvas(RES, RES);
const g = canvas.getContext("2d");
const plate = g.createLinearGradient(0, 0, 0, RES);
plate.addColorStop(0, "#fbf8ff");
plate.addColorStop(1, "#d8cdea");
g.fillStyle = plate;
g.fillRect(0, 0, RES, RES);
const side = RES * MARK;
g.save();
g.shadowColor = "rgba(23, 18, 38, 0.42)";
g.shadowBlur = 26;
g.shadowOffsetY = 16;
g.drawImage(mark, (RES - side) / 2, (RES - side) / 2 + 4, side, side);
g.restore();

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "nexus.png"), canvas.toBuffer("image/png"));
console.log(`rendered nexus -> ${join(OUT, "nexus.png")}`);
