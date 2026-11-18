// SPDX-License-Identifier: GPL-3.0-or-later
// The admission corpus: one package and the hosts that admit or refuse its
// variants. PocketJS commits the generated files beside its device reader
// (vendor/pocketjs/engine/package/tests/fixtures/admission: package.pocket,
// cases.json), which reads them in its own tests; package-admission.test.ts
// checks that this generator, with the encoder of runtime/spec, writes the
// same bytes and that the selection of runtime/spec/admission.ts gives every
// recorded result. From PocketJS tools/package-corpus.ts (`admissionCorpus`).

import { POCKET_BINDING_GENERATION } from "../../vendor/pocketjs/contracts/spec/binding-generation.ts";
import type { AdmissionHost, AdmissionItem, AdmissionTiming } from "../spec/admission.ts";
import { encodeIdentity, encodePocketPackage, POCKET_SECTION } from "../spec/pocket-package.ts";

/** One admission case: a host and the variant it admits, or the closest
 * variant and the items it fails. */
export interface AdmissionCase {
  readonly name: string;
  readonly host: AdmissionHost;
  readonly admitted?: { readonly variant: number; readonly timing: AdmissionTiming };
  readonly rejected?: { readonly variant: number; readonly items: readonly AdmissionItem[]; readonly capability?: string };
}

const HASH_A = `sha256:${"aa".repeat(32)}`;
const HASH_B = `sha256:${"bb".repeat(32)}`;
const HASH_OTHER = `sha256:${"cc".repeat(32)}`;

/** Two variants: `a` compiled for profile A at 60 Hz, `b` for profile B at
 * 30 Hz with net.http and integer-fit presentation. */
export function admissionCorpus(): { package: Uint8Array; cases: AdmissionCase[] } {
  const plan = (target: string, tickHz: number, presentation: string, features: Record<string, boolean>) => new TextEncoder().encode(JSON.stringify({
    animation: "composited", features, profile: { id: target, tickHz },
    target: { hostAbi: POCKET_BINDING_GENERATION, id: target },
    viewport: { logical: [480, 272], physical: [480, 272], policy: "fixed", presentation, rasterDensity: 1 },
  }));
  const variant = (target: string, profileHash: string, tickHz: number, presentation: string, features: Record<string, boolean>) => ({
    target, hostAbi: POCKET_BINDING_GENERATION, profileHash,
    sections: [
      { kind: POCKET_SECTION.identity, bytes: encodeIdentity({ output: "admission", id: "dev.pocketjs.admission", title: "Admission" }) },
      { kind: POCKET_SECTION.plan, bytes: plan(target, tickHz, presentation, features) },
      { kind: POCKET_SECTION.js, bytes: new TextEncoder().encode("globalThis.frame=()=>{};\0") },
    ],
  });
  const bytes = encodePocketPackage({ manifest: new TextEncoder().encode("{}"), variants: [
    variant("a", HASH_A, 60, "native", { "input.buttons": true, "io.offload": false, "text.glyphs.baked": true }),
    variant("b", HASH_B, 30, "integer-fit", { "input.buttons": true, "net.http": true, "text.glyphs.baked": true }),
  ] });
  const host: AdmissionHost = {
    bindingGeneration: POCKET_BINDING_GENERATION, profileHash: HASH_A, rasterDensity: 1, animation: "composited",
    cadences: [60], logicalViewports: [[480, 272]], presentations: ["native", "integer-fit"],
    capabilities: ["input.buttons", "text.glyphs.baked"], auxiliaryLogical: [],
  };
  const a = (cadenceHz = 60) => ({ variant: 0, timing: { tickHz: 60, cadenceHz } });
  const cases: AdmissionCase[] = [
    { name: "compiled-profile", host, admitted: a() },
    { name: "added-capability", host: { ...host, profileHash: HASH_OTHER, capabilities: [...host.capabilities, "audio.pcm"] }, admitted: a() },
    { name: "added-viewport", host: { ...host, profileHash: HASH_OTHER, logicalViewports: [[960, 544], [480, 272]] }, admitted: a() },
    { name: "changed-id", host: { ...host, profileHash: HASH_OTHER }, admitted: a() },
    { name: "reordered-capabilities", host: { ...host, profileHash: HASH_OTHER, capabilities: [...host.capabilities].reverse() }, admitted: a() },
    { name: "dynamic-range", host: { ...host, profileHash: HASH_OTHER, logicalViewports: [[720, 480]], dynamicViewport: { min: [320, 240], max: [1024, 768] } }, admitted: a() },
    { name: "slower-cadence", host: { ...host, profileHash: HASH_OTHER, cadences: [30, 20] }, admitted: a(30) },
    { name: "equal-hash-first", host: { ...host, profileHash: HASH_B, cadences: [60, 30], capabilities: [...host.capabilities, "net.http"] },
      admitted: { variant: 1, timing: { tickHz: 30, cadenceHz: 30 } } },
    { name: "equal-hash-not-admitted", host: { ...host, profileHash: HASH_B, cadences: [60, 30] }, admitted: a() },
    { name: "missing-capability", host: { ...host, profileHash: HASH_OTHER, capabilities: ["input.buttons"] },
      rejected: { variant: 0, items: ["capability"], capability: "text.glyphs.baked" } },
    { name: "raster-density", host: { ...host, profileHash: HASH_OTHER, rasterDensity: 2 }, rejected: { variant: 0, items: ["rasterDensity"] } },
    { name: "rate-not-divisible", host: { ...host, profileHash: HASH_OTHER, cadences: [25] }, rejected: { variant: 0, items: ["rate"] } },
    { name: "binding-generation", host: { ...host, profileHash: HASH_OTHER, bindingGeneration: POCKET_BINDING_GENERATION + 1 },
      rejected: { variant: 0, items: ["bindingGeneration"] } },
    { name: "animation", host: { ...host, profileHash: HASH_OTHER, animation: "repaint" }, rejected: { variant: 0, items: ["animation"] } },
    { name: "presentation", host: { ...host, profileHash: HASH_OTHER, presentations: ["integer-fit"] }, rejected: { variant: 0, items: ["presentation"] } },
    { name: "viewport", host: { ...host, profileHash: HASH_OTHER, logicalViewports: [[400, 240]] }, rejected: { variant: 0, items: ["viewport"] } },
    { name: "closest-variant", host: { ...host, profileHash: HASH_OTHER, cadences: [30], presentations: ["integer-fit"], capabilities: ["input.buttons"] },
      rejected: { variant: 1, items: ["capability"], capability: "net.http" } },
  ];
  return { package: bytes, cases };
}
