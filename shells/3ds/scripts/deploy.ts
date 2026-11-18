// SPDX-License-Identifier: GPL-3.0-or-later
// bun run deploy [--host <ip>] [--no-launch] — build the console binary with
// Pocket Shell embedded, install it over the Pocket Link (link/3ds-dev.ts
// install, the reference Hub's runtime.native.install) at
// sdmc:/3ds/pocket-shell.3dsx, then restart into it. A console whose program
// predates Pocket Link 2 never links: copy the .3dsx to sdmc:/3ds/ through
// ftpd once and run bun run pair --host <ip> before starting it.

import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough } from "../../../scripts/run.ts";
import { DIST_3DS, LINK_TOOL, ROOT } from "./paths.ts";

await passThrough($`bun ${resolve(import.meta.dir, "3ds.ts")} shell`.cwd(ROOT));
await passThrough(
  $`bun ${LINK_TOOL} install --file ${DIST_3DS}/pocket-shell.3dsx ${process.argv.slice(2)}`.cwd(ROOT),
);
