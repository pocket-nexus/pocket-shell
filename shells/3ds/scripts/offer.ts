// SPDX-License-Identifier: GPL-3.0-or-later
// bun run offer — build every app but the launcher as a package into
// dist/3ds/apps/ and point the running Pocket Companion at that folder. Home's
// store then lists them, and an install or update goes over the Pocket Link.

import { mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough } from "../../../scripts/run.ts";
import { APPS, LAUNCHER, writePlan } from "./apps.ts";
import { DIST_3DS, ROOT, VENDOR } from "./paths.ts";

const offered = resolve(DIST_3DS, "apps");
mkdirSync(offered, { recursive: true });
for (const app of APPS.filter((name) => name !== LAUNCHER)) {
  await passThrough($`bun ${resolve(import.meta.dir, "3ds.ts")} ${app} --pocket-only`.cwd(ROOT));
  const { output } = writePlan(app);
  renameSync(resolve(DIST_3DS, `${output}.pocket`), resolve(offered, `${output}.pocket`));
}
await passThrough($`bun ${VENDOR}/tools/companion.ts apps-dir ${offered}`.cwd(ROOT));
