// SPDX-License-Identifier: GPL-3.0-or-later
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { ROOT } from "./paths.ts";

const gitFiles = (...args: string[]): string[] =>
  execFileSync("git", ["ls-files", "-z", ...args], { cwd: ROOT, encoding: "utf8" })
    .split("\0").filter(Boolean);
const tracked = gitFiles();
const failures = gitFiles("-ci", "--exclude-standard")
  .map((path) => `ignored output is still tracked: ${path}`);
const referenced = new Set<string>();

// Resolve actual document links, not basename matches that confuse e.g.
// media/empty.png with another shell's screenshot of the same name.
for (const path of tracked.filter((path) => path.endsWith(".md"))) {
  const file = resolve(ROOT, path);
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/(?:\]\(|src=")([^\s)"#]+)/g)) {
    const target = match[1]!;
    if (target.includes(":") || target.startsWith("/")) continue;
    const absolute = resolve(dirname(file), target);
    if (!existsSync(absolute)) failures.push(`${path}: missing link ${target}`);
    referenced.add(relative(ROOT, absolute));
  }
}

const sourceInputs = new Set([
  "shells/desktop/assets/fonts/W95FA.otf",
]);
// Each 3DS app's pictures (Home's Blender-baked icons, X's action icons):
// the images.json beside an app's manifest names what its build reads.
for (const app of readdirSync(resolve(ROOT, "shells/3ds"), { withFileTypes: true })) {
  const manifest = resolve(ROOT, "shells/3ds", app.name, "images.json");
  if (!app.isDirectory() || !existsSync(manifest)) continue;
  for (const key of Object.keys(JSON.parse(readFileSync(manifest, "utf8")))) sourceInputs.add(`shells/3ds/${app.name}/${key}`);
}
const touchImages = JSON.parse(readFileSync(resolve(ROOT, "shells/touch/src/images.json"), "utf8"));
for (const key of Object.keys(touchImages)) sourceInputs.add(`shells/touch/src/${key}`);

for (const path of sourceInputs) {
  if (!tracked.includes(path)) failures.push(`missing committed input: ${path}`);
}
const mediaExtensions = new Set([".svg", ".png", ".gif", ".bin", ".otf", ".ttf", ".jpg", ".jpeg", ".webp", ".wasm", ".pak", ".pocket"]);
for (const path of tracked.filter((path) => mediaExtensions.has(extname(path)))) {
  if (!referenced.has(path) && !sourceInputs.has(path)) {
    failures.push(`asset has no document, test or declared source consumer: ${path}`);
  }
}

if (failures.length) throw new Error(`Asset review failed:\n${failures.join("\n")}`);
console.log(`Asset review: ${tracked.length} tracked files, source inputs and document links checked; no ignored outputs tracked`);
