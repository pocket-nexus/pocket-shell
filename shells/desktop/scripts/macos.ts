// SPDX-License-Identifier: GPL-3.0-only
import { resolve, delimiter } from "node:path";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { installNativePackage } from "./native-apps.ts";
import { packageOpenStrike } from "./openstrike.ts";
import { buildDesktopSystem } from "./build-system.ts";
import { DIST, POCKETJS_ROOT, ROOT } from "./system-plan.ts";

async function run(command: string[], env = process.env): Promise<number> {
  const child = Bun.spawn(command, {
    cwd: ROOT,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const buildOnly = args.includes("--build-only");
const hostArgs = args.filter((arg) => arg !== "--build-only");
const bundle = resolve(DIST, "Pocket Shell.app");
const contents = resolve(bundle, "Contents");
const executables = resolve(contents, "MacOS");
const resources = resolve(contents, "Resources");
rmSync(bundle, { recursive: true, force: true });
mkdirSync(executables, { recursive: true });
mkdirSync(resolve(resources, "dist"), { recursive: true });
const nativePackages = [];
const openStrike = await packageOpenStrike(resources);
if (openStrike) nativePackages.push(openStrike);
for (const path of (process.env.POCKET_NATIVE_APPS ?? "").split(delimiter).filter(Boolean)) {
  nativePackages.push(await installNativePackage(path, resources, "macos-app"));
}
const receipt = await buildDesktopSystem({ nativePackages });
const manifest = resolve(POCKETJS_ROOT, "hosts/desktop/Cargo.toml");
const buildCode = await run([
  "cargo",
  "build",
  "--release",
  "--locked",
  "--manifest-path",
  manifest,
]);
if (buildCode !== 0) process.exit(buildCode);

const host = resolve(
  POCKETJS_ROOT,
  "hosts/desktop/target/release/pocket-desktop-host",
);
const system = await Bun.file(receipt.systemPlanPath).json();
for (const entry of [system.systemUI, ...system.applications]) {
  for (const extension of ["js", "pak"]) {
    const name = `${entry.plan.app.output}.${extension}`;
    cpSync(resolve(DIST, name), resolve(resources, "dist", name));
  }
}
cpSync(receipt.systemPlanPath, resolve(resources, "pocket-desktop.system.plan.json"));
cpSync(host, resolve(executables, "pocket-shell-runtime"));
cpSync(resolve(ROOT, "assets/macos/AppIcon.icns"), resolve(resources, "AppIcon.icns"));
cpSync(resolve(ROOT, "LICENSE"), resolve(resources, "LICENSE"));
cpSync(resolve(ROOT, "THIRD_PARTY.md"), resolve(resources, "THIRD_PARTY.md"));
cpSync(resolve(ROOT, "assets/fonts/LICENSE-W95FA.txt"), resolve(resources, "LICENSE-W95FA.txt"));
cpSync(resolve(POCKETJS_ROOT, "assets/fonts/LICENSE.txt"), resolve(resources, "LICENSE-Inter.txt"));
const binary = resolve(executables, "PocketShell");
const launcherCode = await run([
  "xcrun", "swiftc", "-O", "-warnings-as-errors", "-framework", "IOKit",
  "-target", `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macosx12.0`,
  resolve(ROOT, "macos/Launcher.swift"), resolve(ROOT, "macos/Files.swift"), "-o", binary,
]);
if (launcherCode !== 0) process.exit(launcherCode);
await Bun.write(resolve(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Pocket Shell</string>
  <key>CFBundleDisplayName</key><string>Pocket Shell</string>
  <key>CFBundleIdentifier</key><string>dev.pocket-stack.desktop</string>
  <key>CFBundleExecutable</key><string>PocketShell</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
for (const command of [
  [binary, "--self-test"],
  ["plutil", "-lint", resolve(contents, "Info.plist")],
  ["codesign", "--force", "--sign", "-", resolve(executables, "pocket-shell-runtime")],
  ["codesign", "--force", "--sign", "-", binary],
  ["codesign", "--force", "--sign", "-", bundle],
  ["codesign", "--verify", "--strict", bundle],
]) {
  const code = await run(command);
  if (code !== 0) process.exit(code);
}
console.log(`Pocket Shell: ${bundle} (Files, Devices, Minesweeper, Cards, Motions, Stats and installed native packages)`);
if (buildOnly) process.exit(0);
const code = await run(
  [binary, ...hostArgs],
);
process.exit(code);
