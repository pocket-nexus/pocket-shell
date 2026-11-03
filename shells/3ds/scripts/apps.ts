// SPDX-License-Identifier: GPL-3.0-or-later
// The shell's apps and their resolved build plans.
//
// Pocket Shell is the launcher: the console binary embeds it, and every other
// app is a Pocket Applet the launcher installs from the linked Mac. The
// launcher lives here (shell/, project root shells/3ds); the applets come from
// pocket-nexus/applets (vendor/applets, its own project root), the source
// Omarchy Pocket builds too. An app contract's entry is relative to its project
// root.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readPocketManifest } from "../../../vendor/pocketjs/framework/src/manifest/load.ts";
import { resolve3dsBuildPlan } from "../../../vendor/pocketjs/tools/3ds-profile.ts";
// the applets built for some devices only, as pocket-nexus/applets names them
import { ONLY } from "../../../vendor/applets/tools/apps.ts";
import { APPLETS_ROOT, PLAN_DIR, PROJECT_ROOT } from "./paths.ts";

export type ShellApp = string;
export const LAUNCHER: ShellApp = "shell";


/** The applets a 3DS and a Tab5 take: every applet of the submodule but those
 *  built for other devices alone. */
const APPLETS: readonly string[] = readdirSync(APPLETS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(APPLETS_ROOT, entry.name, "pocket.app.json")))
  .map((entry) => entry.name)
  .filter((name) => !ONLY[name] || ONLY[name]!.devices.some((device) => device === "3ds" || device === "tab5"))
  .sort();

/** The launcher first, then the applets. */
export const APPS: readonly ShellApp[] = [LAUNCHER, ...APPLETS];

export function isShellApp(name: string | undefined): name is ShellApp {
  return APPS.includes(name ?? "");
}

/** The directory `app`'s entry and imports are relative to. */
export function projectRoot(app: ShellApp): string {
  return app === LAUNCHER ? PROJECT_ROOT : APPLETS_ROOT;
}

/** `app`'s app contract. */
export function appContract(app: ShellApp): string {
  return resolve(projectRoot(app), app, "pocket.app.json");
}

/** Resolve `app`'s app contract against the 3ds-dev host contract and write
 *  the plan the vendored toolchain reads. */
export function writePlan(app: ShellApp): { path: string; output: string } {
  const plan = resolve3dsBuildPlan(readPocketManifest(appContract(app)).manifest);
  mkdirSync(PLAN_DIR, { recursive: true });
  const path = resolve(PLAN_DIR, `${plan.app.output}.3ds.plan.json`);
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  return { path, output: plan.app.output };
}
