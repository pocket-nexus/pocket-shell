// SPDX-License-Identifier: GPL-3.0-or-later
// bun run tab5 [app…] — build packages for the M5Stack Tab5 (ESP-IDF).
//
// The Tab5 program in PocketJS (programs/m5stack-tab5, app "home") embeds
// Home and installs the applets from the linked Mac, like the 3DS. Every
// package compiles against that program's runtime config, so its profile
// hash matches the firmware's. Outputs go to dist/tab5.
//
//   bun run tab5            -> every app
//   bun run tab5 home hn    -> the named apps

import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APPS, isShellApp } from "./apps.ts";
import { DIST_TAB5, PLAN_DIR_TAB5 as PLAN_DIR, PROJECT_ROOT, VENDOR } from "./paths.ts";

export const TAB5_RUNTIME_CONFIG = resolve(VENDOR, "programs/m5stack-tab5/home.runtime-config.ts");

/** Build `app` into dist/tab5/<output>.pocket and return its path. */
export async function buildTab5(app: string): Promise<string> {
  const manifestPath = resolve(PROJECT_ROOT, app, "pocket.json");
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
      "--runtime-config",
      TAB5_RUNTIME_CONFIG,
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
  console.log(`pocket-shell: ${output}`);
  return output;
}

if (import.meta.main) {
  const named = process.argv.slice(2);
  for (const app of named) if (!isShellApp(app)) throw new Error(`pocket-shell tab5: no app named ${app}`);
  for (const app of named.length > 0 ? named : APPS) await buildTab5(app);
}
