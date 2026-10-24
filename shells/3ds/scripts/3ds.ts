// SPDX-License-Identifier: GPL-3.0-or-later
// bun run 3ds [shell|hn] [--pocket-only] — build a console binary or package.
//
// The toolchain lives in the submodule and is driven by a resolved plan
// (scripts/apps.ts) with this shell as the project root. The build writes
// into the submodule's own dist/3ds, where the Rust core, QuickJS and the
// container's bind mount are, so the artefacts are copied back afterwards.
//
//   bun run 3ds                  -> dist/3ds/pocket-shell.3dsx (the launcher)
//   bun run 3ds --pocket-only    -> dist/3ds/pocket-shell.pocket (hot push)
//   bun run 3ds hn --pocket-only -> dist/3ds/hn-main.pocket (installed by Home)

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { build3ds } from "../../../vendor/pocketjs/tools/3ds.ts";
import { isShellApp, LAUNCHER, writePlan } from "./apps.ts";
import { DIST_3DS, PROJECT_ROOT, VENDOR } from "./paths.ts";

const args = process.argv.slice(2);
const app = isShellApp(args[0]) ? args.shift()! : LAUNCHER;
if (args.includes("--cia")) throw new Error("pocket-shell 3ds: the console takes .3dsx files only");
const plan = writePlan(app as typeof LAUNCHER);

await build3ds([`--plan=${plan.path}`, `--project-root=${PROJECT_ROOT}`, ...args]);

mkdirSync(DIST_3DS, { recursive: true });
for (const extension of ["pocket", "3dsx"]) {
  const produced = resolve(VENDOR, `dist/3ds/${plan.output}.${extension}`);
  if (!existsSync(produced)) continue;
  const destination = resolve(DIST_3DS, basename(produced));
  copyFileSync(produced, destination);
  console.log(`pocket-shell: ${destination}`);
}
