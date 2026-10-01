// SPDX-License-Identifier: GPL-3.0-or-later
// bun run deploy [--host <ip>] [--no-launch] — build the console binary and
// install it over the Pocket Runtime dev wire at sdmc:/3ds/pocketshell-main.3dsx,
// then restart into it. The running shell receives the file, so ftpd is not
// involved; a Runtime older than this needs one copy through ftpd first:
// bun run deploy --ftp --host <ip>, with ftpd open.

import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough, plantDeviceKeys } from "../../../scripts/run.ts";
import { DIST_3DS, ROOT, VENDOR } from "./paths.ts";

await plantDeviceKeys();
await passThrough($`bun ${resolve(import.meta.dir, "3ds.ts")}`.cwd(ROOT));
await passThrough(
  $`bun ${VENDOR}/tools/3ds-dev.ts install --file ${DIST_3DS}/pocketshell-main.3dsx ${process.argv.slice(2)}`
    .cwd(ROOT),
);
