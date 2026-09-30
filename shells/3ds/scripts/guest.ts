// SPDX-License-Identifier: GPL-3.0-or-later
// bun run guest — bundle the guest alone (no console toolchain, no Docker),
// into the submodule's dist under the manifest's output name. That is where
// the headless sim looks for a bundle it did not build itself, so this is the
// step test/sim.test.ts needs, and it is the fastest check that the app still
// compiles: the Tailwind subset, the baked glyph set and the style table are
// all resolved here.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";
import { resolve3dsBuildPlan } from "../../../vendor/pocketjs/tools/3ds-profile.ts";
import { passThrough } from "../../../scripts/run.ts";
import { PLAN_DIR, PROJECT_ROOT, VENDOR } from "./paths.ts";
import { writeIcons } from "../src/gen-icons.ts";

// The deck's icons are generated, never committed (docs/ASSETS.md).
writeIcons();

const manifest = JSON.parse(readFileSync(resolve(PROJECT_ROOT, "pocket.json"), "utf8"));
const plan = resolve3dsBuildPlan(manifest);
mkdirSync(PLAN_DIR, { recursive: true });
const planPath = resolve(PLAN_DIR, `${plan.app.output}.3ds.plan.json`);
writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

await passThrough(
  $`bun tools/build.ts --plan=${planPath} --project-root=${PROJECT_ROOT} --outdir=${resolve(VENDOR, "dist")}`
    .cwd(VENDOR),
);
console.log(`pocket-shell: vendor/pocketjs/dist/${plan.app.output}.js`);
