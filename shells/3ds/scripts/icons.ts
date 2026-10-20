// SPDX-License-Identifier: GPL-3.0-or-later
// bun run icons [--only hn,mac] — re-render Home's icons in Blender and bake
// them into the textures the build reads (home/art/icons/*.png).
//
// home/art/icons/icons.py models and renders each icon at 512 px into
// .pocket-build/home-icons/render; home/art/icons/bake.ts adds the shared
// finish (mask, gloss, rim, shadow), writes the PNGs and a contact sheet in
// .pocket-build/validation/home-icons. Builds use the committed PNGs and
// never need Blender.

import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough } from "../../../scripts/run.ts";
import { PROJECT_ROOT, ROOT } from "./paths.ts";

const BLENDER = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const out = resolve(ROOT, ".pocket-build/home-icons/render");
const script = resolve(PROJECT_ROOT, "home/art/icons/icons.py");

await passThrough($`${BLENDER} -b --factory-startup --python ${script} -- --out ${out} ${process.argv.slice(2)}`.cwd(ROOT));
await passThrough($`bun ${resolve(PROJECT_ROOT, "home/art/icons/bake.ts")} ${out}`.cwd(ROOT));
