// SPDX-License-Identifier: GPL-3.0-or-later
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
// The release is the console binary, which embeds Home, the launcher.
const manifestPath = "shells/3ds/home/pocket.json";
const binaryName = "home-main";
const product = "pocket-home";

export function releaseVersion(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid release timestamp");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}.${value("month")}.${value("day")}`;
}

export function manifestVersion(version: string): string {
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(version)) throw new Error("Expected YYYY.MM.DD");
  const date = new Date(`${version.replaceAll(".", "-")}T00:00:00+08:00`);
  if (!Number.isFinite(date.getTime()) || releaseVersion(date.toISOString()) !== version) {
    throw new Error("Invalid calendar date");
  }
  // Pocket manifests use SemVer, which prohibits zero-padded components.
  return version.split(".").map(Number).join(".");
}

export function validateBinary(extension: string, bytes: Buffer): void {
  if (extension !== "3dsx") throw new Error("Unsupported release binary: the console takes .3dsx files only");
  if (bytes.length < 32 || bytes.toString("ascii", 0, 4) !== "3DSX") {
    throw new Error("Invalid 3DSX header");
  }
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

if (import.meta.main) {
  const [command, argument] = process.argv.slice(2);
  if (command === "version") {
    console.log(releaseVersion(argument ?? new Date().toISOString()));
  } else if (command === "prepare") {
    const version = manifestVersion(argument ?? "");
    const path = resolve(root, manifestPath);
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.version = version;
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  } else if (command === "stage") {
    const version = argument ?? "";
    const appVersion = manifestVersion(version);
    const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), "utf8"));
    if (manifest.version !== appVersion) throw new Error("Manifest version does not match release");
    const source = git("rev-parse", "HEAD");
    const runtime = git("-C", "vendor/pocketjs", "rev-parse", "HEAD");
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
      product, version, manifestVersion: appVersion, source, runtime,
      run: process.env.GITHUB_RUN_ID ?? null,
      attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      files: files.map(({ name, sha256 }) => ({ name, sha256 })),
    }, null, 2)}\n`);
  } else throw new Error("Usage: release-3ds.ts version [timestamp] | prepare YYYY.MM.DD | stage YYYY.MM.DD");
}
