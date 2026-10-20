// SPDX-License-Identifier: GPL-3.0-or-later
// bun run push [home|hn] [--host <ip>] — rebuild an app's package and
// hot-push it to a paired console over the Pocket Runtime dev wire, without
// touching the native binary. Home replaces the running launcher's guest;
// any other app installs into its own slot and starts, and SELECT returns to
// Home.

import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough, plantDeviceKeys } from "../../../scripts/run.ts";
import { isShellApp, LAUNCHER, writePlan } from "./apps.ts";
import { DIST_3DS, ROOT, VENDOR } from "./paths.ts";

const args = process.argv.slice(2);
const app = isShellApp(args[0]) ? args.shift()! : LAUNCHER;
const { output } = writePlan(app as typeof LAUNCHER);

await plantDeviceKeys();
await passThrough($`bun ${resolve(import.meta.dir, "3ds.ts")} ${app} --pocket-only`.cwd(ROOT));
await passThrough($`bun ${VENDOR}/tools/3ds-dev.ts push --package ${DIST_3DS}/${output}.pocket ${args}`.cwd(ROOT));
