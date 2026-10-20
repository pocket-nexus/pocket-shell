// SPDX-License-Identifier: GPL-3.0-or-later
// bun run deploy [--host <ip>] [--no-launch] — build the console binary with
// Home embedded and install it over the Pocket Runtime dev wire at
// sdmc:/3ds/home-main.3dsx, then restart into it. A Runtime too old to take
// an install needs one copy through ftpd first: bun run deploy --ftp --host
// <ip>, with ftpd open.

import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough, plantDeviceKeys } from "../../../scripts/run.ts";
import { DIST_3DS, ROOT, VENDOR } from "./paths.ts";

await plantDeviceKeys();
await passThrough($`bun ${resolve(import.meta.dir, "3ds.ts")} home`.cwd(ROOT));
await passThrough(
  $`bun ${VENDOR}/tools/3ds-dev.ts install --file ${DIST_3DS}/home-main.3dsx ${process.argv.slice(2)}`.cwd(ROOT),
);
