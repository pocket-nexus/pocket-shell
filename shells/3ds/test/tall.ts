// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/tall.ts — the portrait surface the sims also run each
// program on: the M5Stack Tab5's 360x592 (home.host.json in PocketJS's
// m5stack-tab5 example). POCKET_TALL_SHOTS=<dir> writes its PNGs, one
// logical pixel per pixel (half the panel's size).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Console3ds } from "../../../vendor/pocketjs/hosts/sim/console-3ds.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";

export const TALL: [number, number] = [360, 592];

const SHOTS = process.env.POCKET_TALL_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

export function tallShot(console3ds: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = console3ds.world.pixels("auxiliary");
  writeFileSync(join(SHOTS, `${name}.png`), encodePNG(rgba, width, height));
}
