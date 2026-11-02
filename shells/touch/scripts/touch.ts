// SPDX-License-Identifier: GPL-3.0-or-later
// Build and deploy the touch shell through the pinned PocketJS runtime.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";
import { resolveIPodTouch4BuildPlan } from "../../../vendor/pocketjs/tools/ipodtouch4-profile.ts";
import { passThrough } from "../../../scripts/run.ts";
import { PLAN_DIR, ROOT, VENDOR } from "./paths.ts";

const DESCRIPTOR = resolve(ROOT, "ipodtouch4.json");
const MANIFEST = resolve(ROOT, "pocket.app.json");

/** Bundle the guest alone into the submodule's dist, under the manifest's
 *  output name: that is where the headless sim looks for a bundle it did not
 *  build itself, so this is what test/mounted.test.ts needs. */
async function guest(): Promise<void> {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const plan = resolveIPodTouch4BuildPlan(manifest);
  mkdirSync(PLAN_DIR, { recursive: true });
  const planPath = resolve(PLAN_DIR, `${plan.app.output}.ipod.plan.json`);
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  await passThrough(
    $`bun tools/build.ts --plan=${planPath} --project-root=${ROOT} --outdir=${resolve(VENDOR, "dist")}`.cwd(VENDOR),
  );
  console.log(`pocket-shell: vendor/pocketjs/dist/${plan.app.output}.js`);
}

const argv = process.argv.slice(2);
const command = argv[0] ?? "help";

if (command === "guest") {
  await guest();
} else {
  await passThrough(
    $`bun tools/ipodtouch4.ts ${argv}`.cwd(VENDOR).env({
      ...process.env,
      POCKETJS_IPODTOUCH4_APP_FILE: DESCRIPTOR,
    }),
  );
}
