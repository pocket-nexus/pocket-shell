// SPDX-License-Identifier: GPL-3.0-only
import type { NativePackage } from "./native-apps.ts";
import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { prepareAssets } from "./prepare-assets.ts";
import {
  DIST,
  PLAN_DIR,
  POCKETJS_ROOT,
  ROOT,
  projectRootFor,
  resolveDesktopSystem,
  type DesktopTarget,
} from "./system-plan.ts";

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`command failed (${code}): ${command.join(" ")}`);
}

export interface BuildDesktopSystemOptions {
  target?: DesktopTarget;
  nativePackages?: readonly NativePackage[];
  dist?: string;
  planDir?: string;
}

export async function buildDesktopSystem(
  options: BuildDesktopSystemOptions = {},
): Promise<{
  systemPlanPath: string;
  applicationCount: number;
}> {
  const target = options.target ?? "macos-app";
  const dist = options.dist ?? DIST;
  const planDir = options.planDir ?? PLAN_DIR;
  const system = await resolveDesktopSystem(target, options.nativePackages);
  await prepareAssets();
  mkdirSync(planDir, { recursive: true });
  mkdirSync(dist, { recursive: true });
  const packages = [system.systemUI, ...system.applications];
  for (const entry of packages) {
    const planPath = resolve(planDir, `${entry.plan.app.output}.plan.json`);
    await Bun.write(planPath, JSON.stringify(entry.plan, null, 2) + "\n");
    const native = options.nativePackages?.find(pkg => pkg.source === entry.source);
    if (native) {
      for (const extension of ["js", "pak"]) cpSync(resolve(native.directory, `${entry.plan.app.output}.${extension}`), resolve(dist, `${entry.plan.app.output}.${extension}`));
      continue;
    }
    await run([
      process.execPath,
      resolve(POCKETJS_ROOT, "tools/build.ts"),
      `--plan=${planPath}`,
      `--project-root=${projectRootFor(entry.source)}`,
      `--outdir=${dist}`,
    ]);
  }

  const systemPlanPath = resolve(planDir, "pocket-desktop.system.plan.json");
  await Bun.write(systemPlanPath, JSON.stringify(system, null, 2) + "\n");
  return { systemPlanPath, applicationCount: system.applications.length };
}

if (import.meta.main) {
  const receipt = await buildDesktopSystem();
  console.log(
    `Pocket Shell Desktop: built System UI + ${receipt.applicationCount} applications`,
  );
}
