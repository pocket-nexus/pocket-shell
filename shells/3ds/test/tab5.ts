// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/tab5.ts — the surfaces larger than the 3DS's that the sims
// also run each program on: the M5Stack Tab5's 592x360 landscape surface
// (home.host.json in PocketJS's m5stack-tab5 example) and a 360x592 portrait
// one. POCKET_TAB5_SHOTS=<dir> writes their PNGs, one logical pixel per
// pixel (half the Tab5 panel's size).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Console3ds } from "../../../vendor/pocketjs/hosts/sim/console-3ds.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";

export const TAB5: [number, number] = [592, 360];
export const PORTRAIT: [number, number] = [360, 592];

const SHOTS = process.env.POCKET_TAB5_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

export function tab5Shot(console3ds: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = console3ds.world.pixels("auxiliary");
  writeFileSync(join(SHOTS, `${name}.png`), encodePNG(rgba, width, height));
}
