// SPDX-License-Identifier: GPL-3.0-or-later
import { resolve } from "node:path";
import { ROOT, VENDOR } from "../../../scripts/paths.ts";

export { ROOT, VENDOR };
export const PROJECT_ROOT = resolve(import.meta.dir, "..");
/** Where the applets checkout is looked for when POCKET_APPLETS_ROOT names
 *  none: `applets` beside this repository. */
export const APPLETS_ROOT_DEFAULT = "../applets";
/** pocket-nexus/applets, the applets' own project root: a checkout outside
 *  this repository. POCKET_APPLETS_ROOT names it, relative to this
 *  repository's root (as POCKET_M5_ROOT is, scripts/tab5.ts). The launcher
 *  builds without one (scripts/apps.ts). */
export const APPLETS_ROOT = resolve(ROOT, process.env.POCKET_APPLETS_ROOT || APPLETS_ROOT_DEFAULT);
// Console outputs stay at the repository root.
export const DIST_3DS = resolve(ROOT, "dist/3ds");
/** This repository's CLI: `check` and `compile` of an app contract (cli/README.md). */
export const POCKET_SHELL_CLI = resolve(ROOT, "cli/pocket-shell.ts");
/** The reference Pocket Link 2 Hub's command line with the 3DS steps. */
export const LINK_TOOL = resolve(ROOT, "link/3ds-dev.ts");
export const PLAN_DIR = resolve(ROOT, ".pocket/plans/3ds");
export const PLAN_DIR_TAB5 = resolve(ROOT, ".pocket/plans/tab5");
export const DIST_TAB5 = resolve(ROOT, "dist/tab5");
export const PLAN_DIR_PSP = resolve(ROOT, ".pocket/plans/psp");
export const DIST_PSP = resolve(ROOT, "dist/psp");
