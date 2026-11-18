// SPDX-License-Identifier: GPL-3.0-or-later
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
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
// Each 3DS app's pictures (the launcher's icons are pocket-nexus/applets'
// icon family, like the applets themselves) and each app the Tab5 firmware
// bundles: the images.json beside an app's manifest names what its build
// reads, and the app contract names its package icon.
const M5STACK_APPS = "devices/m5stack/apps";
for (const apps of ["shells/3ds", M5STACK_APPS]) {
  for (const app of readdirSync(resolve(ROOT, apps), { withFileTypes: true })) {
    if (!app.isDirectory()) continue;
    const manifest = resolve(ROOT, apps, app.name, "images.json");
    if (existsSync(manifest)) {
      for (const key of Object.keys(JSON.parse(readFileSync(manifest, "utf8")))) sourceInputs.add(`${apps}/${app.name}/${key}`);
    }
    // An app contract's icon is the package's cover picture.
    const contract = resolve(ROOT, apps, app.name, "pocket.app.json");
    const icon = existsSync(contract) ? (JSON.parse(readFileSync(contract, "utf8")) as { icon?: string }).icon : undefined;
    if (icon) sourceInputs.add(relative(ROOT, resolve(dirname(contract), icon)));
  }
}
// A Tab5 app's images.json holds options for some pictures only (tab5-demo
// stores its sixteen opaque ones as PSM_5650). The PocketJS build reads
// every picture a source names in a string literal, relative to the app's
// directory (tools/build.ts), so those literals name inputs too.
for (const source of tracked.filter((path) => path.startsWith(`${M5STACK_APPS}/`) && /\.tsx?$/.test(path))) {
  const app = source.split("/").slice(0, 4).join("/");
  for (const match of readFileSync(resolve(ROOT, source), "utf8").matchAll(/["'`]([\w./-]+\.(?:png|svg))["'`]/gi)) {
    if (tracked.includes(`${app}/${match[1]}`)) sourceInputs.add(`${app}/${match[1]}`);
  }
}
const touchImages = JSON.parse(readFileSync(resolve(ROOT, "shells/touch/src/images.json"), "utf8"));
for (const key of Object.keys(touchImages)) sourceInputs.add(`shells/touch/src/${key}`);

// A picture behind a link into a submodule is committed there: the
// launcher's icons are vendor/applets/ui/art/icons, through shell/art/icons.
const realRoot = realpathSync(ROOT);
const committed = (path: string): boolean => {
  const absolute = resolve(ROOT, path);
  if (tracked.includes(path)) return true;
  if (!existsSync(absolute)) return false;
  const real = relative(realRoot, realpathSync(absolute));
  return real.startsWith("vendor/") || tracked.includes(real);
};
for (const path of sourceInputs) {
  if (!committed(path)) failures.push(`missing committed input: ${path}`);
}
// A build at raster density N reads `<name>@Nx.png` beside a declared PNG
// (PocketJS density variants), so those variants are inputs too.
for (const path of [...sourceInputs].filter((path) => path.endsWith(".png"))) {
  const variant = new RegExp(`^${path.slice(0, -4).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@[2-9]x\\.png$`);
  for (const candidate of tracked) if (variant.test(candidate)) sourceInputs.add(candidate);
}
const mediaExtensions = new Set([".svg", ".png", ".gif", ".bin", ".otf", ".ttf", ".jpg", ".jpeg", ".webp", ".wasm", ".pak", ".pocket"]);
for (const path of tracked.filter((path) => mediaExtensions.has(extname(path)))) {
  if (!referenced.has(path) && !sourceInputs.has(path)) {
    failures.push(`asset has no document, test or declared source consumer: ${path}`);
  }
}

if (failures.length) throw new Error(`Asset review failed:\n${failures.join("\n")}`);
console.log(`Asset review: ${tracked.length} tracked files, source inputs and document links checked; no ignored outputs tracked`);
