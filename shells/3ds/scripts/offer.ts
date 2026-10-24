// SPDX-License-Identifier: GPL-3.0-or-later
// bun run offer [--3ds | --tab5] — build every app but the launcher as
// packages into dist/3ds/apps/ and point the running Pocket Companion at that
// folder. Each app gets a 3DS package (<output>.pocket) and a Tab5 package
// (<output>.tab5.pocket); the companion lists to each console the files with
// a variant for its target. Home's store then lists them, and an install or
// update goes over the Pocket Link.

import { copyFileSync, mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough } from "../../../scripts/run.ts";
import { APPS, LAUNCHER, writePlan } from "./apps.ts";
import { DIST_3DS, ROOT, VENDOR } from "./paths.ts";
import { buildTab5 } from "./tab5.ts";

const only = process.argv.slice(2);
const threeDs = !only.includes("--tab5");
const tab5 = !only.includes("--3ds");
const offered = resolve(DIST_3DS, "apps");
mkdirSync(offered, { recursive: true });
for (const app of APPS.filter((name) => name !== LAUNCHER)) {
  const { output } = writePlan(app);
  if (threeDs) {
    await passThrough($`bun ${resolve(import.meta.dir, "3ds.ts")} ${app} --pocket-only`.cwd(ROOT));
    renameSync(resolve(DIST_3DS, `${output}.pocket`), resolve(offered, `${output}.pocket`));
  }
  if (tab5) copyFileSync(await buildTab5(app), resolve(offered, `${output}.tab5.pocket`));
}
await passThrough($`bun ${VENDOR}/tools/companion.ts apps-dir ${offered}`.cwd(ROOT));
