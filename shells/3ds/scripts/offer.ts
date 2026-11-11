// SPDX-License-Identifier: GPL-3.0-or-later
// bun run offer [--3ds | --tab5] [serve options] — build every app but the
// launcher as packages into dist/3ds/apps/, then serve that folder as the
// catalog of the reference Pocket Link 2 Hub (PocketJS tools/3ds-dev.ts
// serve --apps, with its net.http), which stays in the foreground until it is
// stopped. Each app gets a 3DS package (<output>.pocket) and a Tab5 package
// (<output>.tab5.pocket); the Hub lists to each console the files with a
// variant for its target. A paired 3DS's store then lists them, and an install
// or update goes over the Pocket Link. The reference Hub speaks version 2
// only, so a Tab5, whose firmware speaks version 1, does not link to it; its
// packages stay in the folder for a Hub that does. Other options (--daemon,
// --resolve, --panel, --host…) go to serve unchanged.

import { copyFileSync, mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough } from "../../../scripts/run.ts";
import { APPS, LAUNCHER, writePlan } from "./apps.ts";
import { DIST_3DS, ROOT, VENDOR } from "./paths.ts";
import { buildTab5 } from "./tab5.ts";

const args = process.argv.slice(2);
const threeDs = !args.includes("--tab5");
const tab5 = !args.includes("--3ds");
const serve = args.filter((argument) => argument !== "--3ds" && argument !== "--tab5");
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
await passThrough($`bun ${VENDOR}/tools/3ds-dev.ts serve --apps ${offered} ${serve}`.cwd(ROOT));
