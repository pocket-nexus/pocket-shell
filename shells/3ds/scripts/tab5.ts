// SPDX-License-Identifier: GPL-3.0-or-later
// bun run tab5 [app…] — build packages for the M5Stack Tab5 (ESP-IDF).
//
// The Tab5 program in pocket-m5 (programs/m5stack-tab5) embeds Pocket Shell
// and installs the applets from the linked Mac, like the 3DS. Every package
// compiles against that program's host config (pocket.host.config.ts, which
// names its host contract pocket.host.json, host id tab5-home), and a
// package the host contract does not admit is an error: the check is
// PocketJS's own (contracts/spec/admission.ts, the rules the firmware's
// engine applies), so a package written here installs on that firmware. The
// checkout is POCKET_M5_ROOT when set, else ../pocket-m5 beside this
// repository. Outputs go to dist/tab5.
//
//   bun run tab5            -> every app
//   bun run tab5 shell hn   -> the named apps

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admissionHost, describeRejection, selectVariant, type VariantSelection } from "../../../vendor/pocketjs/contracts/spec/admission.ts";
import { decodePocketPackage } from "../../../vendor/pocketjs/contracts/spec/pocket-package.ts";
import { hashPocketProfile, readPocketProfile } from "../../../vendor/pocketjs/framework/src/profile.ts";
import { APPS, appContract, isShellApp } from "./apps.ts";
import { DIST_TAB5, PLAN_DIR_TAB5 as PLAN_DIR, PROJECT_ROOT, ROOT, VENDOR } from "./paths.ts";

export const POCKET_M5_ROOT = process.env.POCKET_M5_ROOT ?? resolve(ROOT, "../pocket-m5");
export const TAB5_PROGRAM = resolve(POCKET_M5_ROOT, "programs/m5stack-tab5");
export const TAB5_HOST_CONFIG = resolve(TAB5_PROGRAM, "pocket.host.config.ts");
export const TAB5_HOST_CONTRACT = resolve(TAB5_PROGRAM, "pocket.host.json");

/** Whether the Tab5 host contract admits the package at `path`, and which
 *  variant: the same selection the firmware makes when it opens the file. */
export function tab5Admission(path: string): VariantSelection {
  const profile = readPocketProfile(TAB5_HOST_CONTRACT);
  return selectVariant(decodePocketPackage(new Uint8Array(readFileSync(path))), admissionHost(profile, hashPocketProfile(profile)));
}

/** Build `app` into dist/tab5/<output>.pocket, check that the Tab5 admits
 *  it, and return its path. */
export async function buildTab5(app: string): Promise<string> {
  for (const file of [TAB5_HOST_CONFIG, TAB5_HOST_CONTRACT]) {
    if (!existsSync(file)) {
      throw new Error(`pocket-shell tab5: no pocket-m5 checkout at ${POCKET_M5_ROOT} (set POCKET_M5_ROOT); it holds ${file}`);
    }
  }
  const manifestPath = appContract(app);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { app: { output: string } };
  mkdirSync(DIST_TAB5, { recursive: true });
  const output = resolve(DIST_TAB5, `${manifest.app.output}.pocket`);
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(VENDOR, "tools/cli/bin.mjs"),
      "compile",
      "--manifest",
      manifestPath,
      "--project-root",
      PROJECT_ROOT,
      "--host-config",
      TAB5_HOST_CONFIG,
      "--outdir",
      resolve(DIST_TAB5, "build"),
      "--plan-dir",
      PLAN_DIR,
      "--output",
      output,
    ],
    { cwd: PROJECT_ROOT, stdout: "inherit", stderr: "inherit", env: { ...process.env, POCKETJS_FRAMEWORK_ROOT: VENDOR } },
  );
  if ((await child.exited) !== 0) throw new Error(`pocket-shell tab5: building ${app} failed`);
  const admission = tab5Admission(output);
  if (!admission.ok) throw new Error(`pocket-shell tab5: the Tab5 does not admit ${output}: ${describeRejection(admission)}`);
  console.log(`pocket-shell: ${output} (admitted by ${admission.variant.target}, ${admission.timing.tickHz} Hz at ${admission.timing.cadenceHz} Hz)`);
  return output;
}

if (import.meta.main) {
  const named = process.argv.slice(2);
  for (const app of named) if (!isShellApp(app)) throw new Error(`pocket-shell tab5: no app named ${app}`);
  // Every app is built and checked; the failures are listed together.
  const failed: string[] = [];
  for (const app of named.length > 0 ? named : APPS) {
    try {
      await buildTab5(app);
    } catch (error) {
      failed.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const message of failed) console.error(message);
  if (failed.length > 0) process.exit(1);
}
