#!/usr/bin/env bun
// SPDX-License-Identifier: GPL-3.0-or-later
// cli/pocket-shell.ts — Pocket Shell's command line (cli/README.md).
//
//   bun cli/pocket-shell.ts check   --manifest pocket.app.json --target <id|pocket.host.json>
//   bun cli/pocket-shell.ts compile --manifest pocket.app.json --host-config pocket.host.config.ts --output app.pocket
//   bun cli/pocket-shell.ts host export --config pocket.host.config.ts --out <dir>
//
// `check` and `compile` run here: the app contract (pocket.app.json) is read,
// validated and resolved by runtime/manifest, the applet rules are
// runtime/package/applet-check.ts and the `.pocket` file is encoded by
// runtime/package and runtime/spec/pocket-package.ts. PocketJS supplies the
// host contract (tools/profile-resolver.ts), the type check
// (framework/compiler/app-check.ts) and the compiler: this program writes the
// resolved plan to a file and runs `tools/build.ts --plan=<file>`, with a
// `--layer` for each system layer the plan gets
// (runtime/manifest/system-layers.ts), which writes the JavaScript bundle and
// the asset pack. Every other command is PocketJS's own and runs in
// vendor/pocketjs/tools/pocket.ts with the same arguments.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { checkAppTypes } from "../vendor/pocketjs/framework/compiler/app-check.ts";
import { BuildInputs, depfile } from "../vendor/pocketjs/framework/compiler/build-inputs.ts";
import { runtimeVersionMismatch } from "../vendor/pocketjs/framework/compiler/runtime-packages.ts";
import { resolveProfile } from "../vendor/pocketjs/tools/profile-resolver.ts";
import { shellRegistry } from "../runtime/manifest/registry.ts";
import { readAuthoredManifest } from "../runtime/manifest/load.ts";
import { canonicalJson } from "../runtime/manifest/plan.ts";
import { validateAndResolveBuildPlan } from "../runtime/manifest/resolve.ts";
import { systemLayerArguments } from "../runtime/manifest/system-layers.ts";
import { checkAppletBundle, checkAppletSources, formatAppletDiagnostics } from "../runtime/package/applet-check.ts";
import { makeVariant } from "../runtime/package/pocket-pack.ts";
import { encodePocketPackage } from "../runtime/spec/pocket-package.ts";

/** This repository's root. */
const ROOT = resolve(import.meta.dir, "..");
/** The pinned PocketJS: the type check reads its declarations from here. */
const POCKETJS = resolve(ROOT, "vendor/pocketjs");
/** PocketJS's CLI: every command but check and compile runs in it. */
const POCKETJS_CLI = resolve(ROOT, "vendor/pocketjs/tools/pocket.ts");
/** PocketJS's compiler: a resolved plan in, a bundle and an asset pack out. */
const POCKETJS_COMPILER = resolve(ROOT, "vendor/pocketjs/tools/build.ts");

const USAGE =
  "usage: pocket-shell check|compile [--manifest pocket.app.json] [--target <id|pocket.host.json>] [--host-config FILE] [--project-root DIR]\n" +
  "       pocket-shell compile [--outdir DIR] [--plan-dir DIR] [--output app.pocket] [--depfile FILE] [--compiler-receipt FILE]\n" +
  "       pocket-shell <command> [...]   any other command runs PocketJS's CLI (vendor/pocketjs/tools/pocket.ts):\n" +
  "                                      host export, host fetch, build, pack, target, sdk, doctor, catalog, project, status";

class UsageError extends Error {}

/** Run PocketJS's CLI with `argv`, this process's directory and environment,
 *  and end with its exit code. */
async function forward(argv: readonly string[]): Promise<never> {
  const child = Bun.spawn([process.execPath, POCKETJS_CLI, ...argv], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const status = await child.exited;
  if (child.signalCode) process.kill(process.pid, child.signalCode);
  process.exit(status);
}

async function run(command: "check" | "compile", argv: string[]): Promise<void> {
  const usage = (message: string): never => { throw new UsageError(message); };
  function takeOption(name: string): string | undefined {
    const inline = argv.findIndex(value => value.startsWith(`--${name}=`));
    if (inline >= 0) {
      const value = argv.splice(inline, 1)[0]!.slice(name.length + 3);
      if (!value) usage(`--${name} requires a value`);
      return value;
    }
    const index = argv.indexOf(`--${name}`);
    if (index < 0) return;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) usage(`--${name} requires a value`);
    argv.splice(index, 2);
    return value;
  }
  if (argv.includes("--aot") || argv.some(value => value === "--out" || value.startsWith("--out="))) {
    usage("--aot and --out compile native guest sources, which this CLI does not do; run PocketJS's CLI: bun vendor/pocketjs/tools/pocket.ts compile --aot --out DIR");
  }
  const target = takeOption("target");
  const hostConfig = takeOption("host-config");
  const manifestPath = resolve(takeOption("manifest") ?? "pocket.app.json");
  const projectRoot = resolve(takeOption("project-root") ?? dirname(manifestPath));
  const outdir = resolve(projectRoot, takeOption("outdir") ?? "dist");
  const planRoot = resolve(projectRoot, takeOption("plan-dir") ?? ".pocket");
  const outputOption = takeOption("output");
  const dependencies = takeOption("depfile");
  const compilerReceipt = takeOption("compiler-receipt");
  if (argv.length) usage(`unknown option ${argv[0]}`);
  if (compilerReceipt && !existsSync(resolve(compilerReceipt))) usage("compiler receipt does not exist");
  if (!existsSync(manifestPath)) usage(`manifest not found: ${manifestPath}`);

  // The host contract: PocketJS selects it from --target, POCKET_TARGET or the host config.
  const selected = await resolveProfile({ from: dirname(manifestPath), target, hostConfig, env: process.env });
  const loaded = readAuthoredManifest(manifestPath);
  const resolution = validateAndResolveBuildPlan(loaded.manifest, { target: selected.profile.id, executionClass: "guest" }, shellRegistry(selected.profile));
  if (!resolution.ok) throw new Error(resolution.diagnostics.map(item => `${item.code} ${item.path || "/"}: ${item.message}`).join("\n"));
  const plan = resolution.plan;
  const entry = resolve(projectRoot, plan.app.entry);
  if (!existsSync(entry)) usage(`app entry not found: ${entry}`);
  const mismatch = runtimeVersionMismatch(plan.app.framework, projectRoot);
  if (mismatch) throw new Error(`the application resolves ${mismatch.name} ${mismatch.application.version} (${mismatch.application.directory}) and the compiler bundles ${mismatch.name} ${mismatch.bundled.version} (${mismatch.bundled.directory}); declare "${mismatch.name}": "${mismatch.bundled.version}" in the application's package.json`);
  const entries: [string, "ui" | "worker"][] = [[entry, "ui"], ...(plan.domains?.worker ? [[resolve(projectRoot, plan.domains.worker.entry), "worker"] as [string, "worker"]] : [])];
  for (const [source] of entries) if (!existsSync(source)) usage(`app entry not found: ${source}`);
  const typeResults = entries.map(([entry, domain]) => checkAppTypes({
    entry,
    domain,
    frameworkRoot: POCKETJS,
    tsconfigPath: existsSync(resolve(projectRoot, "tsconfig.json")) ? resolve(projectRoot, "tsconfig.json") : undefined,
    declarationFiles: [resolve(POCKETJS, "framework/src/jsx.d.ts"), resolve(POCKETJS, "framework/src/vue-sfc.d.ts")],
  }));
  const typeResult = {
    ok: typeResults.every(result => result.ok),
    diagnostics: typeResults.flatMap(result => result.diagnostics),
    checkedFiles: [...new Set(typeResults.flatMap(result => result.checkedFiles))],
  };
  if (!typeResult.ok) throw new Error(typeResult.diagnostics.filter(item => item.category === "error").map(item => `${item.file ?? "TypeScript"}${item.line ? `:${item.line}:${item.column}` : ""} TS${item.code}: ${item.message}`).join("\n"));
  console.log(`✓ pocket.app.json v2\n✓ ${plan.target.id} satisfies pocket.app.json capabilities\n✓ TypeScript (${typeResult.checkedFiles.length} app module(s))\n✓ ResolvedBuildPlan ${plan.planHash}`);
  if (command === "check") return;

  // IDs are UTF-8 protocol strings, not filesystem paths.
  const directoryName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(plan.target.id) ? plan.target.id : selected.profileHash.slice(7, 23);
  const planDirectory = resolve(planRoot, directoryName);
  const planPath = resolve(planDirectory, "plan.json");
  mkdirSync(planDirectory, { recursive: true });
  mkdirSync(outdir, { recursive: true });
  await Bun.write(planPath, JSON.stringify(plan, null, 2) + "\n");
  const extraDependencies = [...loaded.inputs, ...selected.dependencies, ...typeResult.checkedFiles.filter(file => !file.endsWith("/styles.generated.ts")), ...(compilerReceipt ? [resolve(compilerReceipt)] : [])];
  if (dependencies) {
    // This program and every module it loads, with PocketJS's lockfiles; the
    // compiler adds its own modules.
    const tools = new BuildInputs();
    await tools.compiler([resolve(ROOT, "cli/pocket-shell.ts")], POCKETJS);
    extraDependencies.push(...tools.paths());
  }

  // PocketJS compiles the plan into <output>.js, <output>.pak and, with a worker domain, <output>.worker.js;
  // the plan's system layers (the agent's overlay) go ahead of the entry.
  const inputsFile = resolve(outdir, `${plan.app.output}.inputs.json`);
  const child = Bun.spawn([process.execPath, POCKETJS_COMPILER, `--plan=${planPath}`, `--project-root=${projectRoot}`, `--outdir=${outdir}`, ...systemLayerArguments(plan), ...(dependencies ? [`--inputs-file=${inputsFile}`] : [])], { cwd: projectRoot, stdout: "inherit", stderr: "inherit" });
  const status = await child.exited;
  if (status !== 0 || child.signalCode) throw new Error(`PocketJS compiler failed: ${child.signalCode ?? status}`);
  const js = new Uint8Array(readFileSync(resolve(outdir, `${plan.app.output}.js`)));
  const pakPath = resolve(outdir, `${plan.app.output}.pak`);
  const pak = existsSync(pakPath) ? new Uint8Array(readFileSync(pakPath)) : new Uint8Array(0);

  // A Pocket Applet's code and bundle meet the applet rules (runtime/spec/applet.ts).
  if (plan.applet) {
    const diagnostics = [
      ...checkAppletSources({ projectRoot, entry: plan.app.entry, applet: plan.applet, capabilities: Object.keys(plan.features) }),
      ...checkAppletBundle({ jsBytes: js.length, pakBytes: pak.length }),
    ];
    if (diagnostics.length > 0) throw new Error(`${formatAppletDiagnostics(plan.app.output, diagnostics)}\nthe applet breaks the applet rules (docs/APPLETS.md)`);
    console.log("✓ Applet rules");
  }

  const variant = makeVariant({
    target: plan.target.id, hostAbi: plan.target.hostAbi, planJson: canonicalJson(plan),
    identity: { output: plan.app.output, id: plan.app.id, title: plan.app.title },
    js,
    ...(plan.domains?.worker ? { workerJs: new Uint8Array(readFileSync(resolve(outdir, `${plan.app.output}.worker.js`))) } : {}),
    pak,
    // The manifest's icon travels as the variant's cover section.
    ...(loaded.icon ? { cover: loaded.icon } : {}),
  });
  const output = outputOption ? resolve(projectRoot, outputOption) : resolve(outdir, `${plan.app.output}.pocket`);
  if (dependencies) {
    const inputs = await Bun.file(inputsFile).json() as string[];
    await Bun.write(resolve(projectRoot, dependencies), depfile(output, [...inputs, ...extraDependencies]));
  }
  let packaged = variant;
  if (selected.profile.bytecode) {
    // The host names the QuickJS build it embeds: its bundles ship as bytecode for it.
    const { withBytecode } = await import("../runtime/package/bytecode.ts");
    const bytecode = selected.profile.bytecode;
    packaged = withBytecode(variant, { ...bytecode, buildDirectory: resolve(outdir, "quickjs-bytecode") });
    console.log(`✓ QuickJS bytecode for ${bytecode.engine}${bytecode.source === "drop" ? " (source dropped)" : ""}`);
  }
  await Bun.write(output, encodePocketPackage({ manifest: loaded.embedded, variants: [packaged] }));
  console.log(`✓ Package: ${output}`);
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const command = argv[0];
  if (command === undefined || command === "--help" || command === "-h" || command === "help") {
    console.error(USAGE);
    process.exit(command === undefined ? 1 : 0);
  }
  if (command !== "check" && command !== "compile") await forward(argv);
  try {
    await run(command as "check" | "compile", argv.slice(1));
  } catch (error) {
    console.error(`pocket-shell: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof UsageError) console.error(USAGE);
    process.exit(1);
  }
}
