// SPDX-License-Identifier: GPL-3.0-or-later
// bun run psp [--skip-eboot] — build Home and the applets for the PSP: one
// multi-app EBOOT with Home as app 0 (the launcher) and every other program
// whose manifest serves the PSP's full screen (the applet full-screen
// presentation, contracts/spec/applet.ts). Programs that only serve a touch
// surface (Camera, Photos) do not resolve for the PSP and are left out.
//
// Each program resolves against the stock psp profile, builds with the
// vendored toolchain, and is packed as dist/psp/packages/<output>.pocket; the
// EBOOT embeds the packages (docs/LAUNCHER.md). Over PSPLINK the PRX runs from
// the share the tethered computer serves, the same share its companion
// answers the PSP's net requests in (docs/POCKET-LINK.md "USB carrier").

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { encodePocketPackage } from "../../../vendor/pocketjs/contracts/spec/pocket-package.ts";
import { canonicalJson, type ResolvedBuildPlan } from "../../../vendor/pocketjs/framework/src/manifest/plan.ts";
import { validateAndResolveBuildPlan } from "../../../vendor/pocketjs/framework/src/manifest/resolve.ts";
import { makeVariant } from "../../../vendor/pocketjs/tools/pocket-pack.ts";
import { APPS, LAUNCHER } from "./apps.ts";
import { DIST_PSP, PLAN_DIR_PSP, PROJECT_ROOT, VENDOR } from "./paths.ts";

/** The PRX tools/psp.ts links, which PSPLINK starts from the share. */
export const PSP_PRX = resolve(VENDOR, "programs/psp/target/mipsel-sony-psp/release/pocketjs-psp.prx");
export const PSP_EBOOT = resolve(VENDOR, "programs/psp/target/mipsel-sony-psp/release/EBOOT.PBP");

/** `app`'s plan for the psp profile, or the reasons it does not resolve. */
export function resolvePsp(app: string): { plan: ResolvedBuildPlan } | { reasons: string } {
  const manifest = JSON.parse(readFileSync(resolve(PROJECT_ROOT, app, "pocket.json"), "utf8"));
  const resolution = validateAndResolveBuildPlan(manifest, { target: "psp" });
  if (!resolution.ok) return { reasons: resolution.diagnostics.map((item) => `${item.path || "/"}: ${item.message}`).join("; ") };
  return { plan: resolution.plan };
}

function writePlan(plan: ResolvedBuildPlan): string {
  mkdirSync(PLAN_DIR_PSP, { recursive: true });
  const path = resolve(PLAN_DIR_PSP, `${plan.app.output}.psp.plan.json`);
  writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`);
  return path;
}

async function run(argv: string[]): Promise<void> {
  const child = Bun.spawn(argv, { cwd: VENDOR, stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`pocket-shell psp: ${argv.slice(1, 3).join(" ")} failed`);
}

/** Build and pack one program; returns its registry row. */
async function buildPackage(app: string, plan: ResolvedBuildPlan): Promise<string> {
  const planPath = writePlan(plan);
  await run([process.execPath, "tools/build.ts", `--plan=${planPath}`, `--project-root=${PROJECT_ROOT}`, `--outdir=${DIST_PSP}`]);
  const js = new Uint8Array(readFileSync(resolve(DIST_PSP, `${plan.app.output}.js`)));
  const pak = new Uint8Array(readFileSync(resolve(DIST_PSP, `${plan.app.output}.pak`)));
  const variant = makeVariant({
    target: "psp",
    hostAbi: plan.target.hostAbi,
    planJson: canonicalJson(plan),
    identity: { output: plan.app.output, id: plan.app.id, title: plan.app.title },
    js,
    pak,
  });
  mkdirSync(resolve(DIST_PSP, "packages"), { recursive: true });
  const manifest = new Uint8Array(readFileSync(resolve(PROJECT_ROOT, app, "pocket.json")));
  writeFileSync(resolve(DIST_PSP, "packages", `${plan.app.output}.pocket`), encodePocketPackage({ manifest, variants: [variant] }));
  console.log(`pocket-shell psp: ${app} -> ${plan.app.output} (presentation ${plan.presentation?.id}, js ${js.length} B, pak ${pak.length} B)`);
  return `${plan.app.output}\t${plan.app.id}\t${plan.app.title}`;
}

export async function buildPsp(options: { eboot?: boolean } = {}): Promise<void> {
  const launcher = resolvePsp(LAUNCHER);
  if ("reasons" in launcher) throw new Error(`pocket-shell psp: ${LAUNCHER} does not resolve for the PSP: ${launcher.reasons}`);
  await buildPackage(LAUNCHER, launcher.plan);
  const rows: string[] = [];
  for (const app of APPS) {
    if (app === LAUNCHER) continue;
    const resolved = resolvePsp(app);
    if ("reasons" in resolved) {
      console.log(`pocket-shell psp: ${app} left out (${resolved.reasons})`);
      continue;
    }
    rows.push(await buildPackage(app, resolved.plan));
  }
  const registry = resolve(DIST_PSP, "launcher-registry.tsv");
  writeFileSync(registry, `${rows.join("\n")}\n`);
  if (options.eboot === false) return;
  await run([
    process.execPath,
    "tools/psp.ts",
    `--pocket=${resolve(DIST_PSP, "packages", `${launcher.plan.app.output}.pocket`)}`,
    `--project-root=${PROJECT_ROOT}`,
    `--outdir=${DIST_PSP}`,
    `--launcher-registry=${registry}`,
    "--release",
  ]);
  console.log(`pocket-shell psp: ${PSP_PRX}`);
}

if (import.meta.main) await buildPsp({ eboot: !process.argv.includes("--skip-eboot") });
