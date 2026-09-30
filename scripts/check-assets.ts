// SPDX-License-Identifier: GPL-3.0-or-later
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { TAPES } from "../shells/3ds/film/tape.ts";
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

const goldens = new Set(TAPES.flatMap((tape) => tape.capture.flatMap((frame) =>
  ["", ".auxiliary"].map((surface) =>
    `shells/3ds/test/goldens/3ds/${tape.name}.${frame}${surface}.png`),
)));
const sourceInputs = new Set([
  "shells/desktop/assets/fonts/W95FA.otf",
  "shells/ipod/src/fonts/SymbolsNerdFont-subset.otf",
]);
const images3ds = JSON.parse(readFileSync(resolve(ROOT, "shells/3ds/src/images.json"), "utf8"));
// src/icons/ is gen-icons.ts output: ignored and regenerated, never an input.
for (const key of Object.keys(images3ds)) if (!key.startsWith("icons/")) sourceInputs.add(`shells/3ds/src/${key}`);
const touchImages = JSON.parse(readFileSync(resolve(ROOT, "shells/touch/src/images.json"), "utf8"));
for (const key of Object.keys(touchImages)) sourceInputs.add(`shells/touch/src/${key}`);

for (const path of [...goldens, ...sourceInputs]) {
  if (!tracked.includes(path)) failures.push(`missing committed input or golden: ${path}`);
}
const mediaExtensions = new Set([".svg", ".png", ".gif", ".bin", ".otf", ".ttf", ".jpg", ".jpeg", ".webp", ".wasm", ".pak", ".pocket"]);
for (const path of tracked.filter((path) => mediaExtensions.has(extname(path)))) {
  if (!referenced.has(path) && !goldens.has(path) && !sourceInputs.has(path)) {
    failures.push(`asset has no document, test or declared source consumer: ${path}`);
  }
}

if (failures.length) throw new Error(`Asset review failed:\n${failures.join("\n")}`);
console.log(`Asset review: ${tracked.length} tracked files, ${goldens.size} pinned frames, source inputs and document links checked; no ignored outputs tracked`);
