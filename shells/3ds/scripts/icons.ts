// SPDX-License-Identifier: GPL-3.0-or-later
// bun run icons [--only hn,mac] — re-render Home's icons in Blender and bake
// them into the textures the build reads (shell/art/icons/*.png).
//
// shell/art/icons/icons.py models and renders each icon at 512 px into
// .pocket-build/shell-icons/render, and shell/art/icons/nexus.ts draws Pocket
// Nexus's (the wordmark's O, in headless Chrome); shell/art/icons/bake.ts
// sharpens each downsample, adds the shared finish (mask, gloss, rim,
// shadow), writes the PNGs and a contact sheet in
// .pocket-build/validation/shell-icons. Builds use the committed PNGs and
// never need Blender or Chrome.

import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough } from "../../../scripts/run.ts";
import { PROJECT_ROOT, ROOT } from "./paths.ts";

const BLENDER = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const out = resolve(ROOT, ".pocket-build/shell-icons/render");
const script = resolve(PROJECT_ROOT, "shell/art/icons/icons.py");

await passThrough($`${BLENDER} -b --factory-startup --python ${script} -- --out ${out} ${process.argv.slice(2)}`.cwd(ROOT));
await passThrough($`bun ${resolve(PROJECT_ROOT, "shell/art/icons/nexus.ts")} ${out}`.cwd(ROOT));
await passThrough($`bun ${resolve(PROJECT_ROOT, "shell/art/icons/bake.ts")} ${out}`.cwd(ROOT));
