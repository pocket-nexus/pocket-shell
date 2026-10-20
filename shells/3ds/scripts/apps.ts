// SPDX-License-Identifier: GPL-3.0-or-later
// The shell's apps and their resolved build plans.
//
// Home is the launcher: the console binary embeds it, and every other app is
// a package the launcher installs from the linked Mac. Each manifest's entry
// is relative to this shell's directory, which is the build's project root.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolve3dsBuildPlan } from "../../../vendor/pocketjs/tools/3ds-profile.ts";
import { PLAN_DIR, PROJECT_ROOT } from "./paths.ts";

/** Every directory here with a pocket.json is an app, Home first. */
export const APPS: readonly string[] = readdirSync(PROJECT_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(PROJECT_ROOT, entry.name, "pocket.json")))
  .map((entry) => entry.name)
  .sort((a, b) => (a === "home" ? -1 : b === "home" ? 1 : a.localeCompare(b)));
export type ShellApp = string;
export const LAUNCHER: ShellApp = "home";

export function isShellApp(name: string | undefined): name is ShellApp {
  return APPS.includes(name ?? "");
}

/** Resolve `app`'s manifest against the 3ds-dev profile and write the plan
 *  the vendored toolchain reads. */
export function writePlan(app: ShellApp): { path: string; output: string } {
  const manifest = JSON.parse(readFileSync(resolve(PROJECT_ROOT, app, "pocket.json"), "utf8"));
  const plan = resolve3dsBuildPlan(manifest);
  mkdirSync(PLAN_DIR, { recursive: true });
  const path = resolve(PLAN_DIR, `${plan.app.output}.3ds.plan.json`);
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  return { path, output: plan.app.output };
}
