// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/psp.ts — the PSP's full screen in the sims: each program's
// plan for the stock psp profile (the applet full-screen presentation), built
// with the vendored toolchain and booted on a 480x272 primary display with no
// auxiliary surface and no touch, the way the PSP host presents it.
// POCKET_PSP_SHOTS=<dir> writes the screens as PNGs.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bootConsole3ds, type Console3ds, type Console3dsOptions } from "../../../vendor/pocketjs/hosts/sim/console-3ds.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { PROJECT_ROOT, VENDOR } from "../scripts/paths.ts";
import { resolvePsp } from "../scripts/psp.ts";

export const PSP: [number, number] = [480, 272];

const SHOTS = process.env.POCKET_PSP_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** Build `app` for the PSP into `out`; returns the guest's path without extension. */
export function buildPspGuest(app: string, out: string): string {
  const resolved = resolvePsp(app);
  if ("reasons" in resolved) throw new Error(`${app} does not resolve for the PSP: ${resolved.reasons}`);
  const planPath = join(out, `${resolved.plan.app.output}.psp.plan.json`);
  mkdirSync(out, { recursive: true });
  writeFileSync(planPath, `${JSON.stringify(resolved.plan, null, 2)}\n`);
  const build = Bun.spawnSync(
    [process.execPath, "tools/build.ts", `--plan=${planPath}`, `--project-root=${PROJECT_ROOT}`, `--outdir=${join(out, "guest")}`],
    { cwd: VENDOR, stdout: "pipe", stderr: "pipe" },
  );
  if (build.exitCode !== 0) throw new Error(`${app} PSP build failed\n${build.stdout}${build.stderr}`);
  return join(out, "guest", resolved.plan.app.output);
}

/** Boot a PSP guest: one 480x272 screen, buttons only. */
export function bootPsp(guest: string, options: Partial<Console3dsOptions> = {}): Promise<Console3ds> {
  return bootConsole3ds({
    js: `${guest}.js`,
    pak: `${guest}.pak`,
    link: null,
    wifi: null,
    camera: false,
    primary: PSP,
    auxiliary: null,
    ...options,
  });
}

export function pspShot(console3ds: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = console3ds.world.pixels("primary");
  writeFileSync(join(SHOTS, `${name}.png`), encodePNG(rgba, width, height));
}
