// SPDX-License-Identifier: GPL-3.0-or-later
import { resolve } from "node:path";
import { ROOT, VENDOR } from "../../../scripts/paths.ts";

export { ROOT, VENDOR };
export const PROJECT_ROOT = resolve(import.meta.dir, "..");
// Console outputs and pairing keys stay at the repository root.
export const DIST_3DS = resolve(ROOT, "dist/3ds");
export const PLAN_DIR = resolve(ROOT, ".pocket/plans/3ds");
