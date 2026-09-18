// SPDX-License-Identifier: GPL-3.0-only
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, realpathSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, resolve, relative, isAbsolute } from "node:path";
import { desktopNativeExtension, validatePocketManifest, type SystemPackageInput } from "@pocketjs/framework/manifest";
import type { DesktopTarget } from "./system-plan.ts";

export interface NativePackage extends SystemPackageInput {
  readonly directory: string;
  readonly manifest: any;
}

/** Install a prebuilt native package; the runtime only loads this resolved catalog. */
export async function installNativePackage(source: string, resources: string, target: DesktopTarget): Promise<NativePackage> {
  const receipt = await Bun.file(resolve(source, "native-app.json")).json();
  const checked = validatePocketManifest(receipt.manifest);
  if (receipt.format !== 1 || receipt.target !== target || !checked.ok) throw new Error(`Invalid native package: ${source}`);
  const manifest = checked.value;
  if (typeof receipt.library !== "string" || basename(receipt.library) !== receipt.library || !receipt.library.endsWith(target === "macos-app" ? ".dylib" : ".so")) throw new Error("Native package needs a local shared library");
  const sourceRoot = realpathSync(source);
  function checkFiles(directory: string) {
    for (const entry of readdirSync(directory)) {
      const path = resolve(directory, entry);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error(`Unsupported native package entry: ${path}`);
      if (stat.isDirectory()) checkFiles(path);
    }
  }
  checkFiles(sourceRoot);
  for (const file of [receipt.library, `${manifest.app.output}.js`, `${manifest.app.output}.pak`]) {
    if (!existsSync(resolve(sourceRoot, file))) throw new Error(`Native package is missing ${file}`);
  }
  const directory = resolve(resources, "native", manifest.id);
  mkdirSync(directory, { recursive: true });
  cpSync(sourceRoot, directory, { recursive: true });
  const library = resolve(directory, receipt.library);
  if (target === "macos-app") {
    const sign = Bun.spawn(["codesign", "--force", "--sign", "-", library], { stdout: "inherit", stderr: "inherit" });
    if (await sign.exited !== 0) throw new Error("Could not sign native module");
  }
  const libraryPath = relative(resources, library);
  if (isAbsolute(libraryPath) || libraryPath.startsWith("..")) throw new Error("Native module escapes bundle resources");
  return {
    source: `native/${manifest.id}/pocket.json`, manifest, directory,
    hostExtension: desktopNativeExtension({ library: libraryPath, sha256: createHash("sha256").update(readFileSync(library)).digest("hex"), config: receipt.config ?? {} }),
  };
}
