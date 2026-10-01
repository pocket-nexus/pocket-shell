// SPDX-License-Identifier: GPL-3.0-or-later
// bun run push [--host <ip>] — rebuild the guest package and hot-push it to a
// paired console over the Pocket Runtime dev wire, without touching the native
// binary. This is the loop for app changes; a change under
// vendor/pocketjs/hosts/3ds is a native one, for `bun run deploy`.

import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough, plantDeviceKeys } from "../../../scripts/run.ts";
import { DIST_3DS, ROOT, VENDOR } from "./paths.ts";

await plantDeviceKeys();
await passThrough($`bun ${resolve(import.meta.dir, "3ds.ts")} --pocket-only`.cwd(ROOT));
await passThrough(
  $`bun ${VENDOR}/tools/3ds-dev.ts push --package ${DIST_3DS}/pocketshell-main.pocket ${process.argv.slice(2)}`
    .cwd(ROOT),
);
