// SPDX-License-Identifier: GPL-3.0-or-later
// Bundle one of the shell's apps for the sim: the 3DS build
// (devices/3ds/build.ts) with --pocket-only, the app's resolved plan and the
// app's project root.

import { join, resolve } from "node:path";
import { projectRoot, type ShellApp, writePlan } from "../scripts/apps.ts";
import { ROOT } from "../scripts/paths.ts";

/** Build `app` into `out`; returns the guest's path without extension. */
export function buildGuest(app: ShellApp, out: string): string {
  const plan = writePlan(app);
  const build = Bun.spawnSync(
    [
      process.execPath,
      resolve(ROOT, "devices/3ds/build.ts"),
      `--plan=${plan.path}`,
      `--project-root=${projectRoot(app)}`,
      "--pocket-only",
      `--outdir=${join(out, "guest")}`,
      `--package-outdir=${out}`,
    ],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
  );
  if (build.exitCode !== 0) throw new Error(`${app} build failed\n${build.stdout}${build.stderr}`);
  return join(out, "guest", plan.output);
}
