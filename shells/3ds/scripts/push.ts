// SPDX-License-Identifier: GPL-3.0-or-later
// bun run push [shell|hn] [--host <ip>] — rebuild an app's package and
// hot-push it to a paired console over the Pocket Link (link/3ds-dev.ts
// push, the reference Hub's runtime.push), without
// touching the native binary. The launcher's package replaces the running
// launcher's guest; any other app installs into its own slot and starts, and
// SELECT returns to the home screen. The console dials this computer;
// --host adds its address as a beacon target.

import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough } from "../../../scripts/run.ts";
import { takeApp, writePlan } from "./apps.ts";
import { DIST_3DS, LINK_TOOL, ROOT } from "./paths.ts";

const args = process.argv.slice(2);
const app = takeApp("push", args);
const { output } = writePlan(app);

await passThrough($`bun ${resolve(import.meta.dir, "3ds.ts")} ${app} --pocket-only`.cwd(ROOT));
await passThrough($`bun ${LINK_TOOL} push --package ${DIST_3DS}/${output}.pocket ${args}`.cwd(ROOT));
