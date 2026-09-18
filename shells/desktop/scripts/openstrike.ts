// SPDX-License-Identifier: GPL-3.0-only
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { installNativePackage, type NativePackage } from "./native-apps.ts";

/** Product integration supplies a package to the generic native installer. */
export async function packageOpenStrike(resources: string): Promise<NativePackage | undefined> {
  const root = resolve(process.env.OPENSTRIKE_ROOT ?? resolve(homedir(), "code/open-strike"));
  if (!existsSync(root)) return undefined;
  if (!existsSync(resolve(root, "scripts/native-module.ts"))) {
    throw new Error(`OpenStrike at ${root} needs native-module support. Update that checkout or set OPENSTRIKE_ROOT to one with it.`);
  }
  const build = Bun.spawn([process.execPath, "scripts/native-module.ts"], {
    cwd: root, env: { ...process.env, CARGO_TARGET_DIR: resolve(root, "target") }, stdout: "inherit", stderr: "inherit",
  });
  if (await build.exited !== 0) throw new Error("OpenStrike native module build failed");
  return installNativePackage(resolve(root, "dist/native/macos-app"), resources, "macos-app");
}
