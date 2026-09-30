// SPDX-License-Identifier: GPL-3.0-or-later
// bun run 3ds [--pocket-only] [--capture] [--cia] — build the console binary.
//
// The toolchain lives in the submodule and is driven by a resolved plan: this
// script resolves pocket.json against the out-of-registry "3ds-dev" profile,
// writes the plan, and hands it to vendor/pocketjs/tools/3ds.ts with this
// repository as the project root. The build writes into the submodule's own
// dist/3ds (that is where the Rust core, QuickJS and the container's bind
// mount already are), so the artefacts are copied back here afterwards.
//
//   bun run 3ds                 -> dist/3ds/pocketshell-main.3dsx
//   bun run 3ds --cia           -> plus the installable CIA
//   bun run 3ds --pocket-only   -> dist/3ds/pocketshell-main.pocket (hot push)
//
// --capture bakes the film tape into the binary and parks the guest after the
// dump; scripts/film.ts drives that path and this one stays the plain build.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { resolve3dsBuildPlan } from "../../../vendor/pocketjs/tools/3ds-profile.ts";
import { build3ds } from "../../../vendor/pocketjs/tools/3ds.ts";
import { DIST_3DS, PLAN_DIR, PROJECT_ROOT, VENDOR } from "./paths.ts";
import { writeIcons } from "../src/gen-icons.ts";

// The deck's icons are generated, never committed (docs/ASSETS.md).
writeIcons();

const manifest = JSON.parse(readFileSync(resolve(PROJECT_ROOT, "pocket.json"), "utf8"));
const plan = resolve3dsBuildPlan(manifest);

mkdirSync(PLAN_DIR, { recursive: true });
const planPath = resolve(PLAN_DIR, `${plan.app.output}.3ds.plan.json`);
writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

await build3ds([`--plan=${planPath}`, `--project-root=${PROJECT_ROOT}`, ...process.argv.slice(2)]);

mkdirSync(DIST_3DS, { recursive: true });
const produced = [
  resolve(VENDOR, `dist/3ds/${plan.app.output}.pocket`),
  resolve(VENDOR, `dist/3ds/${plan.app.output}.3dsx`),
  resolve(VENDOR, `dist/3ds/${plan.app.output}.cia`),
].filter((path) => existsSync(path));
for (const path of produced) {
  const destination = resolve(DIST_3DS, basename(path));
  copyFileSync(path, destination);
  console.log(`pocket-shell: ${destination}`);
}
