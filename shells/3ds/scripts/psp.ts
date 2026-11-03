// SPDX-License-Identifier: GPL-3.0-or-later
// bun run psp [--skip-eboot] — build Pocket Shell for the PSP: one EBOOT with
// the launcher as app 0 and, embedded after it, every applet whose app
// contract resolves for the PSP's full screen (the applet full-screen
// presentation, PocketJS contracts/spec/applet.ts).
//
// The apps are the launcher and the applets of pocket-nexus/applets
// (scripts/apps.ts), each from its own project root. Each resolves against
// PocketJS's psp host contract (hosts/psp/pocket.host.json, which
// programs/psp/pocket.host.config.ts names), compiles into
// dist/psp/packages/<output>.pocket and must be admitted by that contract,
// the check the EBOOT build makes again. An app that does not resolve is left
// out with the resolver's reasons: an applet with a network declares a worker
// with an http node, which the PSP host does not run (it provides neither
// runtime.worker nor net.http), and one without the full-screen presentation
// needs a touch surface. The EBOOT links with PocketJS's tools/psp.ts and
// needs its toolchain (`pocket target add psp`); --skip-eboot stops after the
// packages.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { admissionHost, describeRejection, selectVariant } from "../../../vendor/pocketjs/contracts/spec/admission.ts";
import { decodePocketPackage } from "../../../vendor/pocketjs/contracts/spec/pocket-package.ts";
import { readPocketManifest } from "../../../vendor/pocketjs/framework/src/manifest/load.ts";
import type { ResolvedBuildPlan } from "../../../vendor/pocketjs/framework/src/manifest/plan.ts";
import { validateAndResolveBuildPlan } from "../../../vendor/pocketjs/framework/src/manifest/resolve.ts";
import { hashPocketProfile } from "../../../vendor/pocketjs/framework/src/profile.ts";
import { POCKET_PROFILES } from "../../../vendor/pocketjs/hosts/index.ts";
import { profileRegistry } from "../../../vendor/pocketjs/tools/profile-resolver.ts";
import { APPS, appContract, LAUNCHER, projectRoot } from "./apps.ts";
import { DIST_PSP, PLAN_DIR_PSP, PROJECT_ROOT, VENDOR } from "./paths.ts";

export const PSP_HOST_CONFIG = resolve(VENDOR, "programs/psp/pocket.host.config.ts");
/** The PRX tools/psp.ts links, which PSPLINK starts from the share. */
export const PSP_PRX = resolve(VENDOR, "programs/psp/target/mipsel-sony-psp/release/pocketjs-psp.prx");

/** The psp host contract (hosts/psp/pocket.host.json), as PocketJS reads
 *  its built-in hosts: the file alone is refused, its id being a command's. */
const pspProfile = () => POCKET_PROFILES["psp"];

/** `app`'s plan for the PSP, or the reasons it does not resolve. */
export function resolvePsp(app: string): { plan: ResolvedBuildPlan } | { reasons: string } {
  const profile = pspProfile();
  const resolution = validateAndResolveBuildPlan(readPocketManifest(appContract(app)).manifest, { target: profile.id }, profileRegistry(profile));
  if (!resolution.ok) return { reasons: resolution.diagnostics.map((item) => `${item.path || "/"}: ${item.message}`).join("; ") };
  return { plan: resolution.plan };
}

/** The apps the PSP build carries: the launcher first, then every applet
 *  that resolves for the PSP, with the reasons for the ones left out. */
export function pspApps(): { apps: string[]; left: { app: string; reasons: string }[] } {
  const apps: string[] = [];
  const left: { app: string; reasons: string }[] = [];
  for (const app of APPS) {
    const resolved = resolvePsp(app);
    if ("plan" in resolved) apps.push(app);
    else if (app === LAUNCHER) throw new Error(`pocket-shell psp: the launcher does not resolve for the PSP: ${resolved.reasons}`);
    else left.push({ app, reasons: resolved.reasons });
  }
  return { apps, left };
}

/** Compile `app` into `<outdir>/packages/<output>.pocket` against the psp host
 *  config and check that the psp host contract admits it. */
export async function buildPspPackage(app: string, outdir = DIST_PSP): Promise<{ path: string; plan: ResolvedBuildPlan }> {
  const resolved = resolvePsp(app);
  if ("reasons" in resolved) throw new Error(`pocket-shell psp: ${app} does not resolve for the PSP: ${resolved.reasons}`);
  const output = resolve(outdir, "packages", `${resolved.plan.app.output}.pocket`);
  mkdirSync(resolve(outdir, "packages"), { recursive: true });
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(VENDOR, "tools/cli/bin.mjs"),
      "compile",
      "--manifest",
      appContract(app),
      "--project-root",
      projectRoot(app),
      "--host-config",
      PSP_HOST_CONFIG,
      "--outdir",
      resolve(outdir, "build"),
      "--plan-dir",
      PLAN_DIR_PSP,
      "--output",
      output,
    ],
    { cwd: projectRoot(app), stdout: "pipe", stderr: "pipe", env: { ...process.env, POCKETJS_FRAMEWORK_ROOT: VENDOR } },
  );
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if ((await child.exited) !== 0) throw new Error(`pocket-shell psp: building ${app} failed\n${stdout}${stderr}`);
  const profile = pspProfile();
  const admission = selectVariant(decodePocketPackage(new Uint8Array(readFileSync(output))), admissionHost(profile, hashPocketProfile(profile)));
  if (!admission.ok) throw new Error(`pocket-shell psp: the PSP does not admit ${output}: ${describeRejection(admission)}`);
  return { path: output, plan: resolved.plan };
}

async function run(argv: string[]): Promise<void> {
  const child = Bun.spawn(argv, { cwd: VENDOR, stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`pocket-shell psp: ${argv.slice(1, 3).join(" ")} failed`);
}

export async function buildPsp(options: { eboot?: boolean } = {}): Promise<void> {
  rmSync(resolve(DIST_PSP, "packages"), { recursive: true, force: true });
  const { apps, left } = pspApps();
  for (const { app, reasons } of left) console.log(`pocket-shell psp: ${app} left out (${reasons})`);
  const rows: string[] = [];
  let launcher = "";
  for (const app of apps) {
    const { path, plan } = await buildPspPackage(app);
    console.log(`pocket-shell psp: ${app} -> ${path} (presentation ${plan.presentation?.id})`);
    if (app === LAUNCHER) launcher = path;
    else rows.push(`${plan.app.output}\t${plan.app.id}\t${plan.app.title}`);
  }
  if (options.eboot === false) return;
  // A registry embeds one package per line after the launcher; with no
  // applets the EBOOT is a table of one.
  const registry = resolve(DIST_PSP, "launcher-registry.tsv");
  if (rows.length > 0) writeFileSync(registry, `${rows.join("\n")}\n`);
  else rmSync(registry, { force: true });
  await run([
    process.execPath,
    "tools/psp.ts",
    `--pocket=${launcher}`,
    `--project-root=${PROJECT_ROOT}`,
    `--outdir=${DIST_PSP}`,
    ...(rows.length > 0 ? [`--launcher-registry=${registry}`] : []),
    "--release",
  ]);
  console.log(`pocket-shell psp: ${PSP_PRX}`);
}

if (import.meta.main) await buildPsp({ eboot: !process.argv.includes("--skip-eboot") });
