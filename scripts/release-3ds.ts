// SPDX-License-Identifier: GPL-3.0-or-later
// bun scripts/release-3ds.ts stage — copy the built .3dsx into dist/release
// under the repository's version, with SHA256SUMS and build-info.json.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fromTree, git, sharedVersion } from "./release/version.ts";

const root = resolve(import.meta.dir, "..");
// The release is the console binary, which embeds Pocket Shell, the launcher.
const binaryName = "pocket-shell";
const product = "pocket-shell";

export function validateBinary(extension: string, bytes: Buffer): void {
  if (extension !== "3dsx") throw new Error("Unsupported release binary: the console takes .3dsx files only");
  if (bytes.length < 32 || bytes.toString("ascii", 0, 4) !== "3DSX") {
    throw new Error("Invalid 3DSX header");
  }
}

if (import.meta.main) {
  const [command] = process.argv.slice(2);
  if (command !== "stage") throw new Error("Usage: release-3ds.ts stage");
  const version = sharedVersion(fromTree(root));
  const source = git(root, "rev-parse", "HEAD");
  const runtime = git(root, "-C", "vendor/pocketjs", "rev-parse", "HEAD");
  const output = resolve(root, "dist/release");
  const files = ["3dsx"].map((extension) => {
    const path = resolve(root, `dist/3ds/${binaryName}.${extension}`);
    const bytes = readFileSync(path);
    validateBinary(extension, bytes);
    return { path, name: `${product}-v${version}.${extension}`, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  mkdirSync(output, { recursive: true });
  for (const file of files) copyFileSync(file.path, resolve(output, file.name));
  writeFileSync(resolve(output, "SHA256SUMS"), files.map((file) => `${file.sha256}  ${file.name}\n`).join(""));
  writeFileSync(resolve(output, "build-info.json"), `${JSON.stringify({
    product, version, manifestVersion: version, source, runtime,
    run: process.env.GITHUB_RUN_ID ?? null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    files: files.map(({ name, sha256 }) => ({ name, sha256 })),
  }, null, 2)}\n`);
  console.log(`Staged ${files.map((file) => file.name).join(", ")} in dist/release`);
}
