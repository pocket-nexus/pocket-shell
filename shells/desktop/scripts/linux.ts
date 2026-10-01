// SPDX-License-Identifier: GPL-3.0-only
import {
  chmodSync,
  cpSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { buildDesktopSystem } from "./build-system.ts";
import { POCKETJS_ROOT, ROOT } from "./system-plan.ts";

async function run(command: string[], cwd = ROOT, env = process.env): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`command failed (${code}): ${command.join(" ")}`);
}

if (process.platform !== "linux") {
  throw new Error("Pocket Shell Desktop Linux builds run on Linux; use the CI artifact from macOS");
}

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const buildOnly = args.includes("--build-only");
const packageArchive = args.includes("--package");
const hostArgs = args.filter(
  (argument) => argument !== "--build-only" && argument !== "--package",
);
const outputRoot = resolve(ROOT, "dist/linux-app");
const artifactDir = resolve(outputRoot, "artifacts");
const planDir = resolve(ROOT, ".pocket/linux-app");
const receipt = await buildDesktopSystem({
  target: "linux-app",
  dist: artifactDir,
  planDir,
});
const manifest = resolve(POCKETJS_ROOT, "hosts/desktop/Cargo.toml");
await run(["cargo", "build", "--release", "--locked", "--manifest-path", manifest]);
const binary = resolve(
  POCKETJS_ROOT,
  "hosts/desktop/target/release/pocket-desktop-host",
);

if (packageArchive) {
  const bundle = resolve(outputRoot, "PocketDesktop");
  rmSync(bundle, { recursive: true, force: true });
  const binDir = resolve(bundle, "bin");
  const libexecDir = resolve(bundle, "libexec");
  const shareDir = resolve(bundle, "share/pocket-desktop");
  const appsDir = resolve(bundle, "share/applications");
  const iconDir = resolve(bundle, "share/icons/hicolor/scalable/apps");
  for (const directory of [binDir, libexecDir, shareDir, appsDir, iconDir]) {
    mkdirSync(directory, { recursive: true });
  }
  cpSync(binary, resolve(libexecDir, "pocket-desktop-host"));
  cpSync(artifactDir, resolve(shareDir, "dist"), { recursive: true });
  cpSync(receipt.systemPlanPath, resolve(shareDir, "pocket-desktop.system.plan.json"));
  cpSync(resolve(ROOT, "LICENSE"), resolve(shareDir, "LICENSE"));
  cpSync(resolve(ROOT, "THIRD_PARTY.md"), resolve(shareDir, "THIRD_PARTY.md"));
  cpSync(
    resolve(ROOT, "src/system-ui/icons/computer.svg"),
    resolve(iconDir, "pocket-desktop.svg"),
  );
  const launcher = resolve(binDir, "pocket-desktop");
  await Bun.write(
    launcher,
    `#!/bin/sh\nset -eu\nAPP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexport POCKETJS_DIST="$APP_ROOT/share/pocket-desktop/dist"\nexec "$APP_ROOT/libexec/pocket-desktop-host" --system-plan "$APP_ROOT/share/pocket-desktop/pocket-desktop.system.plan.json" "$@"\n`,
  );
  chmodSync(launcher, 0o755);
  await Bun.write(
    resolve(appsDir, "dev.pocket-nexus.desktop.desktop"),
    `[Desktop Entry]\nType=Application\nName=Pocket Shell Desktop\nComment=Run isolated Pocket applications in one native desktop process\nExec=pocket-desktop\nIcon=pocket-desktop\nTerminal=false\nCategories=Utility;\nStartupNotify=true\n`,
  );
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  const archive = resolve(outputRoot, `pocket-desktop-linux-${arch}.tar.gz`);
  rmSync(archive, { force: true });
  await run(["tar", "-czf", archive, "-C", outputRoot, basename(bundle)]);
  console.log(`Pocket Shell Desktop Linux distribution: ${archive}`);
}

if (buildOnly || packageArchive) {
  console.log(
    `Pocket Shell Desktop: built linux-app System UI + ${receipt.applicationCount} applications + release host`,
  );
  process.exit(0);
}

await run(
  [binary, "--system-plan", receipt.systemPlanPath, ...hostArgs],
  ROOT,
  { ...process.env, POCKETJS_DIST: artifactDir, RUST_LOG: process.env.RUST_LOG ?? "info" },
);
