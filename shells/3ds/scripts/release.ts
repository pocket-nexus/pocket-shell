// SPDX-License-Identifier: GPL-3.0-or-later
// bun run release [--version YYYY.MM.DD] [--sign <identity>] [--notarize <profile>]
//
// What Pocket Studio offers for download, built from this checkout into
// dist/release/:
//
//   pocket-shell-<version>.3dsx             the console binary, which embeds Home
//   pocket-companion-<version>-macos.zip    Pocket Companion for Apple silicon and
//                                           Intel, with every applet in it
//   SHA256SUMS, build-info.json
//
// The applets are built here and handed to PocketJS's app build
// (tools/companion-app.ts --apps), so the Companion offers the applets built
// with the same runtime as the console binary. `--sign` takes a Developer ID
// Application identity and `--notarize` a notarytool keychain profile; without
// them the Companion is signed ad hoc and opens only on the Mac that built it.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";
import { passThrough } from "../../../scripts/run.ts";
import { releaseVersion, validateBinary } from "../../../scripts/release-3ds.ts";
import { APPS, LAUNCHER, writePlan } from "./apps.ts";
import { DIST_3DS, ROOT, VENDOR } from "./paths.ts";

const argv = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const version = option("--version") ?? releaseVersion(new Date().toISOString());
if (!/^\d{4}\.\d{2}\.\d{2}$/.test(version)) throw new Error("release: --version takes YYYY.MM.DD");
const identity = option("--sign");
const notary = option("--notarize");

const output = resolve(ROOT, "dist/release");
const applets = resolve(output, "applets");
rmSync(output, { recursive: true, force: true });
mkdirSync(applets, { recursive: true });

console.log("release: the console binary");
await passThrough($`bun ${resolve(import.meta.dir, "3ds.ts")} ${LAUNCHER}`.cwd(ROOT));
const shellName = `pocket-shell-${version}.3dsx`;
const binary = readFileSync(resolve(DIST_3DS, `${writePlan(LAUNCHER).output}.3dsx`));
validateBinary("3dsx", binary);
writeFileSync(resolve(output, shellName), binary);

console.log("release: the applets");
for (const app of APPS.filter((name) => name !== LAUNCHER)) {
  await passThrough($`bun ${resolve(import.meta.dir, "3ds.ts")} ${app} --pocket-only`.cwd(ROOT));
  const { output: name } = writePlan(app);
  renameSync(resolve(DIST_3DS, `${name}.pocket`), resolve(applets, `${name}.pocket`));
}

console.log("release: Pocket Companion");
const companionName = `pocket-companion-${version}-macos.zip`;
const companionArgs = [
  "--outdir", resolve(ROOT, ".pocket-build/companion"),
  "--release", "--universal",
  "--version", version.split(".").map(Number).join("."),
  "--apps", applets,
  "--zip", resolve(output, companionName),
  ...(identity ? ["--sign", identity] : []),
  ...(notary ? ["--notarize", notary] : []),
];
await passThrough($`bun ${VENDOR}/tools/companion-app.ts ${companionArgs}`.cwd(VENDOR));

const files = [shellName, companionName].map((name) => ({
  name,
  sha256: createHash("sha256").update(readFileSync(resolve(output, name))).digest("hex"),
}));
writeFileSync(resolve(output, "SHA256SUMS"), files.map((file) => `${file.sha256}  ${file.name}\n`).join(""));
const git = async (...args: string[]) => (await $`git ${args}`.cwd(ROOT).text()).trim();
writeFileSync(resolve(output, "build-info.json"), `${JSON.stringify({
  product: "pocket-shell",
  version,
  source: await git("rev-parse", "HEAD"),
  runtime: await git("-C", "vendor/pocketjs", "rev-parse", "HEAD"),
  dirty: (await git("status", "--porcelain", "--untracked-files=no")) !== "",
  signed: identity ?? "ad hoc",
  notarized: notary !== undefined,
  applets: APPS.filter((name) => name !== LAUNCHER),
  files,
}, null, 2)}\n`);
console.log(`release: ${output}`);
