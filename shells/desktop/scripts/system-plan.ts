// SPDX-License-Identifier: GPL-3.0-only
import { resolve } from "node:path";
import macApps from "../macos-apps.json";
import {
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

export async function resolveDesktopSystem(
  target: DesktopTarget = "macos-app",
): Promise<ResolvedSystemPlan> {
  const systemPath = resolve(ROOT, "pocket.system.json");
  const input = await Bun.file(systemPath).json();
  // macOS keeps the desktop System UI and its small set of built-in apps.
  // Linux and the website also install the demonstration catalog.
  if (target === "macos-app") {
    input.title = "Pocket Shell";
    input.applications.catalog = input.applications.catalog.filter((entry: { package: string }) =>
      entry.package === input.roles.systemUI || macApps.includes(entry.package));
    input.installation.installedPackages = [input.roles.systemUI, ...macApps];
  }
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
        manifest: await Bun.file(resolve(REPOSITORY, entry.manifest)).json(),
      })),
  );
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
