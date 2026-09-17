// SPDX-License-Identifier: GPL-3.0-only
import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { POCKETJS_ROOT, ROOT } from "./system-plan.ts";
import { prepareAssets } from "./prepare-assets.ts";

// The PocketJS sim resolves bundles beside its WASM host. Keep this low-level
// test artifact in the vendored dist directory; product builds still go to
// Pocket Shell Desktop's own dist/ through build-system.ts.
const SIM_DIST = resolve(POCKETJS_ROOT, "dist");

// Sim tests boot at density 1; the screenshot capture boots at 2 like the
// macOS plan does, and needs the pak baked to match or every glyph and icon
// arrives as upscaled 1x art.
const density = process.argv.slice(2).find((a) => a.startsWith("--density="));

await prepareAssets();
const child = Bun.spawn(
  [
    process.execPath,
    resolve(POCKETJS_ROOT, "tools/build.ts"),
    resolve(ROOT, "src/system-ui/main.tsx"),
    "--framework=solid",
    `--outdir=${SIM_DIST}`,
    ...(density ? [density] : []),
  ],
  { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
);
const code = await child.exited;
if (code !== 0) process.exit(code);
for (const extension of ["js", "pak"]) {
  renameSync(
    resolve(SIM_DIST, `main.${extension}`),
    resolve(SIM_DIST, `pocket-desktop-system-ui.${extension}`),
  );
}
