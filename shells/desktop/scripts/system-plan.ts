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
export const PLAN_DIR = resolve(ROOT, ".pocket/web-app");
const TARGET = "web-app";

export async function resolveDesktopSystem(): Promise<ResolvedSystemPlan> {
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
  const packages = await Promise.all(
    validated.value.applications.catalog
      .filter((entry) => installed.has(entry.package))
      .map(async (entry) => ({
        source: entry.manifest,
        manifest: readPocketManifest(resolve(REPOSITORY, entry.manifest)).manifest,
      })),
  );
  const resolved = validateAndResolveSystemPlan(input, {
    target: TARGET,
    packages,
  });
  if (!resolved.ok) {
    throw new Error(
      `Pocket Shell Desktop does not resolve against ${TARGET}: ${resolved.diagnostics
        .map((item) => `${item.path || "/"}: ${item.message}`)
        .join("; ")}`,
    );
  }
  return resolved.plan;
}

export function projectRootFor(source: string): string {
  return source.startsWith("vendor/pocketjs/") ? POCKETJS_ROOT : ROOT;
}
