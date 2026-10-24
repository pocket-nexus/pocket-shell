// SPDX-License-Identifier: GPL-3.0-only
import { resolve } from "node:path";
import {
  readPocketManifest,
  validateAndResolveSystemPlan,
  validatePocketSystem,
  type ResolvedSystemPlan,
} from "@pocketjs/framework/manifest";

export const ROOT = resolve(import.meta.dir, "..");
export const REPOSITORY = resolve(ROOT, "../..");
export const POCKETJS_ROOT = resolve(ROOT, "../../vendor/pocketjs");
export const DIST = resolve(ROOT, "dist");
export const PLAN_DIR = resolve(ROOT, ".pocket/macos-app");
export type DesktopTarget = "macos-app" | "linux-app" | "web-app";

/**
 * Build the release desktop host for `target` and return its path. The host
 * compiles in the profile `pocket profile export` writes for the target
 * (POCKETJS_PROFILE_RS); a host built without one stops at startup. Cargo
 * puts it in the PocketJS workspace's shared target directory.
 */
export async function buildDesktopHost(target: "macos-app" | "linux-app"): Promise<string> {
  const profileDir = resolve(ROOT, `.pocket/${target}-profile`);
  const run = async (command: string[], env: Record<string, string | undefined> = process.env) => {
    const child = Bun.spawn(command, { cwd: POCKETJS_ROOT, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    const code = await child.exited;
    if (code !== 0) throw new Error(`command failed (${code}): ${command.join(" ")}`);
  };
  await run(["bun", "tools/pocket.ts", "profile", "export", "--target", target, "--out", profileDir]);
  await run(
    ["cargo", "build", "--release", "--locked", "--manifest-path", resolve(POCKETJS_ROOT, "Cargo.toml"), "-p", "pocket-desktop-host"],
    { ...process.env, POCKETJS_PROFILE_RS: resolve(profileDir, "pocket_profile.rs") },
  );
  return resolve(POCKETJS_ROOT, "target/release/pocket-desktop-host");
}

/**
 * The installed packages' manifests as the resolver reads them: through
 * readPocketManifest, which loads a manifest's `app.theme` module in place.
 */
export function packageManifests(
  catalog: ReadonlyArray<{ package: string; manifest: string }>,
  installed: ReadonlySet<string>,
): Array<{ source: string; manifest: unknown }> {
  return catalog
    .filter((entry) => installed.has(entry.package))
    .map((entry) => ({
      source: entry.manifest,
      manifest: readPocketManifest(resolve(REPOSITORY, entry.manifest)).manifest,
    }));
}

export async function resolveDesktopSystem(
  target: DesktopTarget = "macos-app",
): Promise<ResolvedSystemPlan> {
  const systemPath = resolve(ROOT, "pocket.system.json");
  const input = await Bun.file(systemPath).json();
  const validated = validatePocketSystem(input);
  if (!validated.ok) {
    throw new Error(
      `Pocket Shell Desktop System is invalid: ${validated.diagnostics
        .map((item) => `${item.path || "/"}: ${item.message}`)
        .join("; ")}`,
    );
  }

  const installed = new Set(validated.value.installation.installedPackages);
  const packages = packageManifests(validated.value.applications.catalog, installed);
  const resolved = validateAndResolveSystemPlan(input, {
    target,
    packages,
  });
  if (!resolved.ok) {
    throw new Error(
      `Pocket Shell Desktop does not resolve against ${target}: ${resolved.diagnostics
        .map((item) => `${item.path || "/"}: ${item.message}`)
        .join("; ")}`,
    );
  }
  return resolved.plan;
}

export function projectRootFor(source: string): string {
  return source.startsWith("vendor/pocketjs/") ? POCKETJS_ROOT : ROOT;
}
