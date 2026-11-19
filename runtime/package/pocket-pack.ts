#!/usr/bin/env bun
// SPDX-License-Identifier: GPL-3.0-or-later

// `.pocket` packaging (docs/POCKET-PACKAGE.md; format in runtime/spec/pocket-package.ts).
//
//   bun runtime/package/pocket-pack.ts inspect <file.pocket>
//   bun runtime/package/pocket-pack.ts thin <file.pocket> --target 3ds-dev -o out.pocket
//   bun runtime/package/pocket-pack.ts verify <file.pocket>
//
// `makeVariant` assembles one target's sections from a compiled bundle and
// its plan; `pocket-shell compile` (cli/pocket-shell.ts) and the 3DS build
// (devices/3ds/build.ts) encode the package from it. A package with several
// variants is the merge of single-variant packages whose manifests agree.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { POCKET_BINDING_GENERATION } from "../../vendor/pocketjs/contracts/spec/binding-generation.ts";
import { shellRegistry } from "../manifest/registry.ts";
import {
  canonicalJson,
  planProfileDocument,
  verifyPlanHash,
  verifyPlanProfile,
  type ResolvedBuildPlan,
} from "../manifest/plan.ts";
import { validateAndResolveBuildPlan } from "../manifest/resolve.ts";
import {
  POCKET_SECTION,
  decodeBytecodeEnvelope,
  decodePocketPackage,
  decodeHostInputs,
  encodeHostInputs,
  encodeIdentity,
  encodePocketPackage,
  findSection,
  fnv1a64,
  thinPocketPackage,
  type PocketPackageSection,
  type PocketPackageVariant,
} from "../spec/pocket-package.ts";

function usage(message?: string): never {
  if (message) console.error(`pocket-pack: ${message}`);
  console.error(
    "usage:\n" +
      "  bun runtime/package/pocket-pack.ts inspect <file.pocket>\n" +
      "  bun runtime/package/pocket-pack.ts thin <file.pocket> --target <t> [-o <file>]\n" +
      "  bun runtime/package/pocket-pack.ts verify <file.pocket>",
  );
  process.exit(1);
}

/** Assemble one variant from prebuilt pieces. */
export function makeVariant(input: {
  target: string;
  hostAbi: number;
  planJson: string;
  identity: { output: string; id: string; title: string };
  js: Uint8Array;
  workerJs?: Uint8Array;
  pak: Uint8Array;
  cover?: Uint8Array;
}): PocketPackageVariant {
  if (input.hostAbi !== POCKET_BINDING_GENERATION) {
    throw new Error(`pocket-pack: binding generation ${input.hostAbi} is unsupported; rebuild for ${POCKET_BINDING_GENERATION}`);
  }
  const plan = JSON.parse(input.planJson) as ResolvedBuildPlan;
  if (!verifyPlanHash(plan) || !verifyPlanProfile(plan) || plan.target.id !== input.target ||
    plan.target.hostAbi !== input.hostAbi || plan.app.output !== input.identity.output ||
    plan.app.id !== input.identity.id || plan.app.title !== input.identity.title) {
    throw new Error(`pocket-pack: ${input.target} plan and variant identity differ`);
  }
  // The js section carries the QuickJS NUL (zero-copy device eval rule).
  const js = new Uint8Array(input.js.length + 1);
  js.set(input.js, 0);
  const sections: PocketPackageSection[] = [
    { kind: POCKET_SECTION.identity, bytes: encodeIdentity(input.identity) },
    { kind: POCKET_SECTION.plan, bytes: new TextEncoder().encode(input.planJson) },
    { kind: POCKET_SECTION.js, bytes: js },
    { kind: POCKET_SECTION.pak, bytes: input.pak },
  ];
  if (input.cover) sections.push({ kind: POCKET_SECTION.cover, bytes: input.cover });
  if (!!plan.domains?.worker !== !!input.workerJs) throw new Error("pocket-pack: worker declaration and worker bundle must both be present");
  if (input.workerJs) {
    if (!input.workerJs.length) throw new Error("pocket-pack: worker bundle is empty");
    const worker = new Uint8Array(input.workerJs.length + 1);
    worker.set(input.workerJs);
    sections.push({ kind: POCKET_SECTION.workerJs, bytes: worker });
  }
  if (plan.profile.platform === "esp-idf") {
    sections.push({
      kind: POCKET_SECTION.hostInputs,
      bytes: encodeHostInputs({
        hostAbi: input.hostAbi,
        tickHz: plan.profile.tickHz,
        logicalWidth: plan.viewport.logical[0],
        logicalHeight: plan.viewport.logical[1],
        physicalWidth: plan.viewport.physical[0],
        physicalHeight: plan.viewport.physical[1],
        rasterDensity: plan.viewport.rasterDensity,
        presentation: plan.viewport.presentation,
        profileHash: plan.profileHash,
        planHash: plan.planHash,
      }),
    });
  }
  return { target: input.target, hostAbi: input.hostAbi, profileHash: plan.profileHash, sections };
}

function inspectCommand(file: string): void {
  const bytes = new Uint8Array(readFileSync(file));
  const pkg = decodePocketPackage(bytes);
  const manifest = JSON.parse(new TextDecoder().decode(pkg.manifest)) as {
    id?: string;
    title?: string;
  };
  console.log(`${file}: ${bytes.length}B`);
  console.log(`  manifest: ${manifest.id ?? "?"} — ${manifest.title ?? "?"}`);
  for (const v of pkg.variants) {
    const hash = fnv1a64(...v.sections.map((s) => s.bytes)).toString(16).padStart(16, "0");
    console.log(`  variant ${v.target} (abi ${v.hostAbi}) hash ${hash}`);
    console.log(`    profile ${v.profileHash}`);
    const names: Record<number, string> = {
      1: "identity",
      2: "plan",
      3: "js",
      4: "pak",
      5: "cover",
      6: "bytecode",
      7: "hostInputs",
      8: "workerJs",
      9: "workerBc",
    };
    for (const s of v.sections) {
      console.log(`    ${(names[s.kind] ?? `kind${s.kind}`).padEnd(8)} ${s.bytes.length}B`);
    }
  }
}

function thinCommand(argv: string[]): void {
  const file = argv.shift() ?? usage("thin needs a file");
  let output = "";
  const targets: string[] = [];
  while (argv.length) {
    const a = argv.shift()!;
    if (a === "--target") targets.push(argv.shift() ?? usage("--target needs a value"));
    else if (a === "-o" || a === "--output") output = resolve(argv.shift() ?? usage("-o needs a value"));
    else usage(`unknown option ${a}`);
  }
  if (targets.length === 0) usage("thin needs at least one --target");
  const pkg = decodePocketPackage(new Uint8Array(readFileSync(file)));
  const thinned = encodePocketPackage(thinPocketPackage(pkg, targets));
  const out = output || file.replace(/\.pocket$/, `.${targets.join("-")}.pocket`);
  writeFileSync(out, thinned);
  console.log(`pocket-pack: ${out} (${thinned.length}B)`);
}

function verifyCommand(file: string): void {
  const bytes = new Uint8Array(readFileSync(file));
  const pkg = decodePocketPackage(bytes); // footer hash checked here
  const manifest: unknown = JSON.parse(new TextDecoder().decode(pkg.manifest));
  for (const v of pkg.variants) {
    // Re-run the compilation claimed by the package, including external
    // profiles. This checks internal consistency; a Runtime must compare the
    // variant with its independently compiled profile hash before loading it.
    const embeddedPlan = findSection(v, POCKET_SECTION.plan);
    if (!embeddedPlan) throw new Error(`verify: variant ${v.target} plan section is missing`);
    let plan: ResolvedBuildPlan;
    try { plan = JSON.parse(new TextDecoder().decode(embeddedPlan)) as ResolvedBuildPlan; }
    catch { throw new Error(`verify: variant ${v.target} plan section is not JSON`); }
    if (!verifyPlanHash(plan) || !verifyPlanProfile(plan) || plan.target.id !== v.target ||
      plan.target.hostAbi !== v.hostAbi || plan.profileHash !== v.profileHash) {
      throw new Error(`verify: variant ${v.target} has inconsistent plan identity`);
    }
    const resolution = validateAndResolveBuildPlan(manifest, { target: v.target, hostExtension: plan.hostExtension }, shellRegistry(planProfileDocument(plan.profile)));
    if (!resolution.ok) throw new Error(`verify: variant ${v.target} is no longer admitted by its own manifest`);
    if (canonicalJson(plan) !== canonicalJson(resolution.plan)) {
      throw new Error(`verify: variant ${v.target} resolved plan drifted from its manifest`);
    }
    const hostInputs = findSection(v, POCKET_SECTION.hostInputs);
    if (Boolean(hostInputs) !== (plan.profile.platform === "esp-idf")) {
      throw new Error(`verify: variant ${v.target} host inputs do not match its platform`);
    }
    if (hostInputs) {
      const inputs = decodeHostInputs(hostInputs);
      if (inputs.hostAbi !== v.hostAbi || inputs.tickHz !== plan.profile.tickHz ||
        inputs.logicalWidth !== plan.viewport.logical[0] || inputs.logicalHeight !== plan.viewport.logical[1] ||
        inputs.physicalWidth !== plan.viewport.physical[0] || inputs.physicalHeight !== plan.viewport.physical[1] ||
        inputs.rasterDensity !== plan.viewport.rasterDensity || inputs.presentation !== plan.viewport.presentation ||
        inputs.profileHash !== plan.profileHash || inputs.planHash !== plan.planHash) {
        throw new Error(`verify: ESP-IDF variant ${v.target} host inputs drifted`);
      }
    }
    const js = findSection(v, POCKET_SECTION.js);
    if (js && js[js.length - 1] !== 0) {
      throw new Error(`verify: variant ${v.target} js section is not NUL-terminated`);
    }
    const bytecode = findSection(v, POCKET_SECTION.bytecode);
    if (!js && !bytecode) throw new Error(`verify: variant ${v.target} has neither a js nor a bytecode section`);
    for (const [kind, name] of [[POCKET_SECTION.bytecode, "bytecode"], [POCKET_SECTION.workerBytecode, "worker bytecode"]] as const) {
      const section = findSection(v, kind);
      if (!section) continue;
      try { decodeBytecodeEnvelope(section); }
      catch (error) { throw new Error(`verify: variant ${v.target} ${name} section: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  console.log(`verify: OK — footer hash, ${pkg.variants.length} variant(s) re-admitted`);
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const command = argv.shift();
  try {
    if (command === "inspect") inspectCommand(argv.shift() ?? usage("inspect needs a file"));
    else if (command === "thin") thinCommand(argv);
    else if (command === "verify") verifyCommand(argv.shift() ?? usage("verify needs a file"));
    else usage(`unknown command ${command ?? "<missing>"}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
