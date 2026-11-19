// SPDX-License-Identifier: GPL-3.0-or-later
// bun run psp [--skip-eboot] [--capture] — build Pocket Shell for the PSP:
// one EBOOT of Pocket Shell's own program crate (devices/psp/program) with the
// launcher as app 0 and, embedded after it, every applet whose app contract
// resolves for the PSP.
//
// The apps are the launcher and, when a checkout of pocket-nexus/applets is
// at hand, its applets (scripts/apps.ts), each from its own project root.
// Each resolves against the program's host contract
// (devices/psp/pocket-shell-psp.host.json, host id pocket-shell-psp: PocketJS's
// psp contract plus link.companion and media.playback, which the program
// implements), compiles with this repository's CLI (cli/pocket-shell.ts
// compile) into dist/psp/packages/<output>.pocket and must be admitted by that
// contract. The admitted variant goes into the EBOOT as a PocketJS bundle,
// dist/psp/bundles/<output>.pkb (runtime/package/bundle.ts). An app that does
// not resolve is left out with the resolver's reasons: an applet with a
// network declares a worker with an http node, which the PSP does not run (it
// provides neither runtime.worker nor net.http), and one without the
// full-screen presentation needs a touch surface.
//
// The EBOOT is PocketJS's buildPspProgram() (tools/psp.ts) over
// devices/psp/program, with the applets' table (dist/psp/registry.tsv), their
// bundles and the veil's mark (devices/psp/veil-logo.ts) in the crate's
// environment. It needs PocketJS's PSP toolchain (`pocket target add psp`);
// --skip-eboot stops after the packages, and --capture builds the
// PPSSPPHeadless frame-dump EBOOT (POCKETJS_CAPTURE_INPUT, POCKETJS_CAP_START
// and POCKETJS_CAP_N reach it from the environment).

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { admissionHost, describeRejection, selectVariant } from "../../../runtime/spec/admission.ts";
import { decodePocketPackage } from "../../../runtime/spec/pocket-package.ts";
import { readPocketManifest } from "../../../runtime/manifest/load.ts";
import type { ResolvedBuildPlan } from "../../../runtime/manifest/plan.ts";
import { validateAndResolveBuildPlan } from "../../../runtime/manifest/resolve.ts";
import { bundleOfVariant } from "../../../runtime/package/bundle.ts";
import { bakeVeilLogo } from "../../../devices/psp/veil-logo.ts";
import { POCKET_BINDING_GENERATION } from "../../../vendor/pocketjs/contracts/spec/binding-generation.ts";
import { hashPocketProfile } from "../../../vendor/pocketjs/framework/src/profile.ts";
import { prepareApplication } from "../../../vendor/pocketjs/tools/build/inputs.ts";
import { loadProfileDocument, profileRegistry } from "../../../vendor/pocketjs/tools/profile-resolver.ts";
import { buildPspProgram } from "../../../vendor/pocketjs/tools/psp.ts";
import { APPS, appContract, LAUNCHER, projectRoot } from "./apps.ts";
import { DIST_PSP, PLAN_DIR_PSP, POCKET_SHELL_CLI, PROJECT_ROOT, ROOT } from "./paths.ts";

/** Pocket Shell's PSP program: the crate, its host config and contract. */
export const PSP_DEVICE = resolve(ROOT, "devices/psp");
export const PSP_PROGRAM = resolve(PSP_DEVICE, "program");
export const PSP_HOST_CONFIG = resolve(PSP_DEVICE, "pocket.host.config.ts");
export const PSP_HOST_CONTRACT = resolve(PSP_DEVICE, "pocket-shell-psp.host.json");

/** The program's host contract, pocket-shell-psp. */
export const pspProfile = () => loadProfileDocument(PSP_HOST_CONTRACT);

/** The plan of the app contract at `contract` for the PSP, or the reasons
 *  it does not resolve. */
export function resolvePspContract(contract: string): { plan: ResolvedBuildPlan } | { reasons: string } {
  const profile = pspProfile();
  const resolution = validateAndResolveBuildPlan(readPocketManifest(contract).manifest, { target: profile.id }, profileRegistry(profile));
  if (!resolution.ok) return { reasons: resolution.diagnostics.map((item) => `${item.path || "/"}: ${item.message}`).join("; ") };
  return { plan: resolution.plan };
}

/** `app`'s plan for the PSP, or the reasons it does not resolve. */
export function resolvePsp(app: string): { plan: ResolvedBuildPlan } | { reasons: string } {
  return resolvePspContract(appContract(app));
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

/** Compile `app` into `<outdir>/packages/<output>.pocket` against the PSP
 *  program's host config, check that its host contract admits it, and write
 *  the admitted variant as `<outdir>/bundles/<output>.pkb`. */
export async function buildPspPackage(app: string, outdir = DIST_PSP): Promise<{ path: string; bundle: string; plan: ResolvedBuildPlan }> {
  const resolved = resolvePsp(app);
  if ("reasons" in resolved) throw new Error(`pocket-shell psp: ${app} does not resolve for the PSP: ${resolved.reasons}`);
  const output = resolve(outdir, "packages", `${resolved.plan.app.output}.pocket`);
  mkdirSync(resolve(outdir, "packages"), { recursive: true });
  const child = Bun.spawn(
    [
      process.execPath,
      POCKET_SHELL_CLI,
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
    { cwd: projectRoot(app), stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if ((await child.exited) !== 0) throw new Error(`pocket-shell psp: building ${app} failed\n${stdout}${stderr}`);
  const profile = pspProfile();
  const admission = selectVariant(decodePocketPackage(new Uint8Array(readFileSync(output))), admissionHost(profile, hashPocketProfile(profile)));
  if (!admission.ok) throw new Error(`pocket-shell psp: the PSP does not admit ${output}: ${describeRejection(admission)}`);
  const bundle = resolve(outdir, "bundles", `${resolved.plan.app.output}.pkb`);
  mkdirSync(resolve(outdir, "bundles"), { recursive: true });
  writeFileSync(bundle, bundleOfVariant(admission.variant));
  return { path: output, bundle, plan: resolved.plan };
}

export async function buildPsp(options: { eboot?: boolean; capture?: boolean } = {}): Promise<string | undefined> {
  for (const directory of ["packages", "bundles"]) rmSync(resolve(DIST_PSP, directory), { recursive: true, force: true });
  const { apps, left } = pspApps();
  for (const { app, reasons } of left) console.log(`pocket-shell psp: ${app} left out (${reasons})`);
  const rows: string[] = [];
  let launcher = "";
  for (const app of apps) {
    const { bundle, plan } = await buildPspPackage(app);
    console.log(`pocket-shell psp: ${app} -> ${bundle} (presentation ${plan.presentation?.id})`);
    if (app === LAUNCHER) launcher = bundle;
    else rows.push(`${plan.app.output}\t${plan.app.id}\t${plan.app.title}`);
  }
  if (options.eboot === false) return undefined;

  // The table after the launcher, one guest per line; with no applets the
  // EBOOT is a table of one.
  const registry = resolve(DIST_PSP, "registry.tsv");
  writeFileSync(registry, rows.length > 0 ? `${rows.join("\n")}\n` : "");
  const veilLogo = resolve(DIST_PSP, "veil-logo.raw");
  writeFileSync(veilLogo, bakeVeilLogo());
  const profile = pspProfile();
  const application = prepareApplication(
    { profile, profileHash: hashPocketProfile(profile), hostAbi: POCKET_BINDING_GENERATION, dependencies: [] },
    launcher,
    resolve(DIST_PSP, "build"),
  );
  const built = await buildPspProgram({
    program: {
      directory: PSP_PROGRAM,
      package: "pocket-shell-psp",
      env: {
        POCKET_SHELL_REGISTRY: rows.length > 0 ? registry : "",
        POCKET_SHELL_BUNDLES: rows.length > 0 ? resolve(DIST_PSP, "bundles") : "",
        POCKET_SHELL_VEIL_LOGO: veilLogo,
      },
      xmb: resolve(PSP_DEVICE, "xmb/Psp.toml"),
    },
    profile,
    application,
    projectRoot: PROJECT_ROOT,
    capture: options.capture === true,
    cargoArgs: ["--release"],
    outputDirectory: DIST_PSP,
  });
  console.log(`pocket-shell psp: ${built.eboot} (app 0 ${built.output}${rows.length > 0 ? `, ${rows.length} applet(s)` : ""})`);
  return built.eboot;
}

if (import.meta.main) {
  await buildPsp({ eboot: !process.argv.includes("--skip-eboot"), capture: process.argv.includes("--capture") });
}
