// SPDX-License-Identifier: GPL-3.0-or-later
// Bundle one of the shell's apps for the sim: the vendored 3DS toolchain with
// --pocket-only, the app's resolved plan and this shell as the project root.

import { join } from "node:path";
import { type ShellApp, writePlan } from "../scripts/apps.ts";
import { PROJECT_ROOT, VENDOR } from "../scripts/paths.ts";

/** Build `app` into `out`; returns the guest's path without extension. */
export function buildGuest(app: ShellApp, out: string): string {
  const plan = writePlan(app);
  const build = Bun.spawnSync(
    [
      process.execPath,
      "tools/3ds.ts",
      `--plan=${plan.path}`,
      `--project-root=${PROJECT_ROOT}`,
      "--pocket-only",
      `--outdir=${join(out, "guest")}`,
      `--package-outdir=${out}`,
    ],
    { cwd: VENDOR, stdout: "pipe", stderr: "pipe" },
  );
  if (build.exitCode !== 0) throw new Error(`${app} build failed\n${build.stdout}${build.stderr}`);
  return join(out, "guest", plan.output);
}
