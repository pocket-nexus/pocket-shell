// SPDX-License-Identifier: GPL-3.0-or-later
// bun run 3ds [shell|hn] [--pocket-only] — build a console binary or package.
//
// The 3DS program is devices/3ds: its build (devices/3ds/build.ts) is driven
// by a resolved plan (scripts/apps.ts) with the app's own project root,
// compiles the guest with PocketJS's toolchain and writes into dist/3ds.
//
//   bun run 3ds                  -> dist/3ds/pocket-shell.3dsx (the launcher)
//   bun run 3ds --pocket-only    -> dist/3ds/pocket-shell.pocket (hot push)
//   bun run 3ds hn --pocket-only -> dist/3ds/hn-main.pocket (the launcher installs it)
//
// An applet is built from the pocket-nexus/applets checkout (scripts/apps.ts).

import { build3ds } from "../../../devices/3ds/build.ts";
import { projectRoot, takeApp, writePlan } from "./apps.ts";

const args = process.argv.slice(2);
const app = takeApp("3ds", args);
if (args.includes("--cia")) throw new Error("pocket-shell 3ds: the console takes .3dsx files only");
const plan = writePlan(app);

// The build names the package it wrote; this is the .3dsx, or the package
// under --pocket-only.
const built = await build3ds([`--plan=${plan.path}`, `--project-root=${projectRoot(app)}`, ...args]);
console.log(`pocket-shell: ${built}`);
