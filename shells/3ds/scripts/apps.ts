// SPDX-License-Identifier: GPL-3.0-or-later
// The shell's apps and their resolved build plans.
//
// Pocket Shell is the launcher: the console binary embeds it, and every other
// app is a Pocket Applet the launcher installs from the linked Mac. The
// launcher lives here (shell/, project root shells/3ds) and builds from this
// repository alone. The applets are pocket-nexus/applets, a checkout outside
// this repository with its own project root (APPLETS_ROOT, scripts/paths.ts:
// POCKET_APPLETS_ROOT, else ../applets beside this repository), the source
// Omarchy Pocket builds too. Without a checkout the launcher is the only app,
// and a command that names an applet stops with one line (takeApp,
// requireApplets). An app contract's entry is relative to its project root.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readPocketManifest } from "../../../runtime/manifest/load.ts";
import { resolve3dsBuildPlan } from "../../../devices/3ds/tools/profile.ts";
import { APPLETS_ROOT, APPLETS_ROOT_DEFAULT, PLAN_DIR, PROJECT_ROOT } from "./paths.ts";

export type ShellApp = string;
export const LAUNCHER: ShellApp = "shell";

/** Whether an applets checkout is at APPLETS_ROOT. */
export const HAS_APPLETS = existsSync(APPLETS_ROOT) && statSync(APPLETS_ROOT).isDirectory();

/** The applets built for some devices only, as pocket-nexus/applets names
 *  them (`ONLY` in its tools/apps.ts). A checkout without that module names
 *  none, and every applet in it is then built for every device. */
type DeviceLimits = Readonly<Record<string, { readonly devices: readonly string[] }>>;
async function deviceLimits(): Promise<DeviceLimits> {
  const module = resolve(APPLETS_ROOT, "tools/apps.ts");
  if (!existsSync(module)) return {};
  return ((await import(module)) as { ONLY?: DeviceLimits }).ONLY ?? {};
}
const ONLY = await deviceLimits();

/** The applets a 3DS and a Tab5 take: every applet of the checkout but those
 *  built for other devices alone. None without a checkout. */
const APPLETS: readonly string[] = !HAS_APPLETS ? [] : readdirSync(APPLETS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(resolve(APPLETS_ROOT, entry.name, "pocket.app.json")))
  .map((entry) => entry.name)
  .filter((name) => !ONLY[name] || ONLY[name]!.devices.some((device) => device === "3ds" || device === "tab5"))
  .sort();

/** The launcher first, then the applets. */
export const APPS: readonly ShellApp[] = [LAUNCHER, ...APPLETS];

export function isShellApp(name: string | undefined): name is ShellApp {
  return APPS.includes(name ?? "");
}

function stop(line: string): never {
  console.error(line);
  process.exit(1);
}

/** Stop `command` with one line unless an applets checkout is at
 *  APPLETS_ROOT; `needs` names what the command asked for. */
export function requireApplets(command: string, needs: string): void {
  if (HAS_APPLETS) return;
  stop(`pocket-shell ${command}: ${needs} needs a pocket-nexus/applets checkout and none is at ${APPLETS_ROOT} (POCKET_APPLETS_ROOT, default ${APPLETS_ROOT_DEFAULT} beside this repository)`);
}

/** Stop `command` with one line: `name` is no app here. Without an applets
 *  checkout the line says where one is looked for. */
export function unknownApp(command: string, name: string): never {
  requireApplets(command, name);
  return stop(`pocket-shell ${command}: no app named ${name} (the launcher is ${LAUNCHER}; the applets are the directories of ${APPLETS_ROOT} with a pocket.app.json)`);
}

/** The app a command names in its first argument, taken out of `args`; the
 *  launcher when the first argument is an option or absent. A name that is no
 *  app stops the command. */
export function takeApp(command: string, args: string[]): ShellApp {
  const name = args[0];
  if (name === undefined || name.startsWith("-")) return LAUNCHER;
  if (!isShellApp(name)) unknownApp(command, name);
  args.shift();
  return name;
}

/** The directory `app`'s entry and imports are relative to. */
export function projectRoot(app: ShellApp): string {
  return app === LAUNCHER ? PROJECT_ROOT : APPLETS_ROOT;
}

/** `app`'s app contract. */
export function appContract(app: ShellApp): string {
  return resolve(projectRoot(app), app, "pocket.app.json");
}

/** Resolve `app`'s app contract against the 3ds-dev host contract
 *  (devices/3ds/pocket.host.json) and write the plan the build reads. */
export function writePlan(app: ShellApp): { path: string; output: string } {
  const plan = resolve3dsBuildPlan(readPocketManifest(appContract(app)).manifest);
  mkdirSync(PLAN_DIR, { recursive: true });
  const path = resolve(PLAN_DIR, `${plan.app.output}.3ds.plan.json`);
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  return { path, output: plan.app.output };
}
