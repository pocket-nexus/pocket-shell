// SPDX-License-Identifier: GPL-3.0-or-later
// bun run tab5 [app…] — build packages for the M5Stack Tab5 (ESP-IDF).
//
// The Tab5 firmware in PocketJS (hosts/esp-idf/examples/m5stack-tab5, app
// "home") embeds Home and installs the applets from the linked Mac, like the
// 3DS. Every package resolves against that firmware's host profile, so its
// admission hash matches. Outputs go to dist/tab5.
//
//   bun run tab5            -> every app
//   bun run tab5 home hn    -> the named apps

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodePocketPackage } from "../../../vendor/pocketjs/contracts/spec/pocket-package.ts";
import {
  hashPocketIdfHostProfile,
  pocketIdfHostExtension,
  pocketIdfHostRegistry,
  validatePocketIdfHostProfile,
} from "../../../vendor/pocketjs/framework/src/manifest/idf-host.ts";
import { canonicalJson } from "../../../vendor/pocketjs/framework/src/manifest/plan.ts";
import { validateAndResolveBuildPlan } from "../../../vendor/pocketjs/framework/src/manifest/resolve.ts";
import { makeVariant } from "../../../vendor/pocketjs/tools/pocket-pack.ts";
import { APPS, isShellApp } from "./apps.ts";
import { DIST_TAB5, PLAN_DIR_TAB5 as PLAN_DIR, PROJECT_ROOT, VENDOR } from "./paths.ts";

export const TAB5_PROFILE = resolve(VENDOR, "hosts/esp-idf/examples/m5stack-tab5/home.host.json");

/** Build `app` into dist/tab5/<output>.pocket and return its path. */
export async function buildTab5(app: string): Promise<string> {
  const validated = validatePocketIdfHostProfile(JSON.parse(readFileSync(TAB5_PROFILE, "utf8")));
  if (!validated.ok) throw new Error(`pocket-shell tab5: ${TAB5_PROFILE} is not a valid host profile`);
  const profile = validated.value;
  const manifestPath = resolve(PROJECT_ROOT, app, "pocket.json");
  const resolution = validateAndResolveBuildPlan(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    { target: profile.id, hostExtension: pocketIdfHostExtension(hashPocketIdfHostProfile(profile), profile.tickHz) },
    pocketIdfHostRegistry(profile),
  );
  if (!resolution.ok) {
    const reasons = resolution.diagnostics.map((item) => `${item.path || "/"}: ${item.message}`).join("; ");
    throw new Error(`pocket-shell tab5: ${app} did not resolve: ${reasons}`);
  }
  const plan = resolution.plan;
  mkdirSync(PLAN_DIR, { recursive: true });
  const planPath = resolve(PLAN_DIR, `${plan.app.output}.tab5.plan.json`);
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

  const outdir = resolve(DIST_TAB5, "build");
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(VENDOR, "tools/build.ts"),
      `--plan=${planPath}`,
      `--project-root=${PROJECT_ROOT}`,
      `--outdir=${outdir}`,
      `--hz=${profile.tickHz}`,
    ],
    { cwd: PROJECT_ROOT, stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0) throw new Error(`pocket-shell tab5: building ${app} failed`);

  const js = new Uint8Array(readFileSync(resolve(outdir, `${plan.app.output}.js`)));
  const pak = new Uint8Array(readFileSync(resolve(outdir, `${plan.app.output}.pak`)));
  const variant = makeVariant({
    target: profile.id,
    hostAbi: plan.target.hostAbi,
    planJson: canonicalJson(plan),
    identity: { output: plan.app.output, id: plan.app.id, title: plan.app.title },
    js,
    pak,
  });
  const output = resolve(DIST_TAB5, `${plan.app.output}.pocket`);
  writeFileSync(output, encodePocketPackage({ manifest: new Uint8Array(readFileSync(manifestPath)), variants: [variant] }));
  console.log(`pocket-shell: ${output} (js ${js.length} B, pak ${pak.length} B)`);
  return output;
}

if (import.meta.main) {
  const named = process.argv.slice(2);
  for (const app of named) if (!isShellApp(app)) throw new Error(`pocket-shell tab5: no app named ${app}`);
  for (const app of named.length > 0 ? named : APPS) await buildTab5(app);
}
