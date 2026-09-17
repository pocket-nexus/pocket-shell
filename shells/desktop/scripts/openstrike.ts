// SPDX-License-Identifier: GPL-3.0-only
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

/** Optional local game integration. Only the desktop host, its UI, the
 * default cooked map and the model it actually loads enter the app bundle.
 * User-supplied maps and generated binaries never enter this repository. */
export async function packageOpenStrike(resources: string): Promise<string | undefined> {
  const root = resolve(process.env.OPENSTRIKE_ROOT ?? resolve(homedir(), "code/open-strike"));
  if (!existsSync(root)) return undefined;
  if (!existsSync(resolve(root, "scripts/desktop.ts"))) {
    throw new Error(`OpenStrike at ${root} needs desktop-target UI and cooked-map support. Update it before packaging.`);
  }
  const target = resolve(root, "target");
  const build = Bun.spawn([process.execPath, "run", "build:desktop"], {
    cwd: root, env: { ...process.env, CARGO_TARGET_DIR: target }, stdout: "inherit", stderr: "inherit",
  });
  if (await build.exited !== 0) throw new Error("OpenStrike desktop build failed");
  const maps = resolve(process.env.OPENSTRIKE_MAPS ?? resolve(root, "dist/maps"));
  const map = [resolve(maps, "de_dust2.p3d"), resolve(maps, "maps/de_dust2.p3d")].find(existsSync);
  if (!map) throw new Error(`OpenStrike needs the cooked de_dust2.p3d map in ${maps}`);
  const destination = resolve(resources, "OpenStrike");
  const inputs = [
    [resolve(target, "release/openstrike"), "target/release/openstrike"],
    [resolve(root, "dist/pocket/macos-app/openstrike.js"), "dist/pocket/macos-app/openstrike.js"],
    [resolve(root, "dist/pocket/macos-app/openstrike.pak"), "dist/pocket/macos-app/openstrike.pak"],
    [resolve(root, "assets/characters/police/officer.glb"), "assets/characters/police/officer.glb"],
    [resolve(root, "LICENSE"), "LICENSE"],
    [map, "dist/maps/de_dust2.p3d"],
  ];
  for (const [source, relative] of inputs) {
    const output = resolve(destination, relative);
    mkdirSync(dirname(output), { recursive: true });
    cpSync(source, output);
  }
  return resolve(destination, "target/release/openstrike");
}
