// SPDX-License-Identifier: GPL-3.0-only
import { resolve } from "node:path";
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
const receipt = await buildDesktopSystem();
const manifest = resolve(POCKETJS_ROOT, "programs/desktop/Cargo.toml");
const buildCode = await run([
  "cargo",
  "build",
  "--release",
  "--locked",
  "--manifest-path",
  manifest,
]);
if (buildCode !== 0) process.exit(buildCode);

if (buildOnly) {
  console.log(
    `Pocket Shell Desktop: built System UI + ${receipt.applicationCount} applications + release host`,
  );
  process.exit(0);
}

const binary = resolve(
  POCKETJS_ROOT,
  "target/release/pocket-desktop-host",
);
const code = await run(
  [binary, "--system-plan", receipt.systemPlanPath, ...hostArgs],
  { ...process.env, POCKETJS_DIST: DIST, RUST_LOG: process.env.RUST_LOG ?? "info" },
);
process.exit(code);
