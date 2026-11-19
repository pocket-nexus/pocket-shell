// SPDX-License-Identifier: GPL-3.0-or-later
// tests/package.test.ts — the firmware's package glue
// (programs/m5stack-tab5/components/pocket_system/src/package.c) with the
// shared .pocket reader (devices/services/pocket_container.c), built under
// ASan and UBSan by tests/package.c against the host contract that
// tools/pocket exports from programs/m5stack-tab5/pocket.host.config.ts.
// tests/package-admission.c stands in for PocketJS's admission and decides
// each variant by its plan.
//
// - an admitted package is read in place: its hashes, its slot, two features
//   by id, the sections of the variant admission took, its worker sections
//   and every callback of the package source the runtime boots;
// - variants are offered in the order runtime/spec/admission.ts selects them;
// - a refused or damaged package gets the message the store logs and an
//   install reports.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPocketProfile, readPocketProfile } from "../../../vendor/pocketjs/framework/src/profile.ts";
import {
  decodePocketPackage,
  encodeIdentity,
  encodePocketPackage,
  fnv1a64,
  POCKET_SECTION,
  type PocketPackageVariant,
} from "../../../runtime/spec/pocket-package.ts";

const ROOT = join(import.meta.dir, "..");
const POCKETJS = join(ROOT, "../../vendor/pocketjs");
const SHARED = join(ROOT, "../services");
const SYSTEM = join(ROOT, "programs/m5stack-tab5/components/pocket_system/src");
const ID = "dev.test.package";

// The packages below are built when the file loads, against the exported
// contract's binding generation and profile hash.
const scratch = mkdtempSync(join(tmpdir(), "pocket-m5-package-"));
const probe = join(scratch, "package");
const profile = join(scratch, "profile");
const exported = Bun.spawnSync(["sh", join(ROOT, "tools/pocket"), "host", "export",
  "--config", join(ROOT, "programs/m5stack-tab5/pocket.host.config.ts"), "--out", profile]);
if (exported.exitCode !== 0) throw new Error(`host export failed: ${exported.stderr.toString()}`);
const hostAbi = (JSON.parse(readFileSync(join(profile, "pocket.host.json"), "utf8")) as { hostAbi: number }).hostAbi;
const profileHash = hashPocketProfile(readPocketProfile(join(profile, "pocket.host.json")));

beforeAll(() => {
  const compile = Bun.spawnSync([
    process.env.CC ?? "cc", "-std=gnu11", "-O1", "-g", "-Wall", "-Wextra", "-Werror",
    "-fsanitize=address,undefined", "-fno-sanitize-recover=all",
    `-I${SYSTEM}`, `-I${SHARED}`, `-I${profile}`,
    `-I${join(POCKETJS, "platforms/esp-idf/pocket_runtime/include")}`, `-I${join(POCKETJS, "contracts/generated")}`,
    join(ROOT, "tests/package.c"), join(ROOT, "tests/package-admission.c"), join(SYSTEM, "package.c"),
    join(SHARED, "pocket_container.c"), join(SHARED, "sha256.c"), "-o", probe,
  ]);
  expect(compile.exitCode, compile.stderr.toString()).toBe(0);
}, 120_000);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

let files = 0;
/** package.c's report on `bytes`; `hash` is the profile hash argument. */
function open(bytes: Uint8Array, hash = "profile"): any {
  const path = join(scratch, `package-${files++}.pocket`);
  writeFileSync(path, bytes);
  const result = Bun.spawnSync([probe, path, hash]);
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return JSON.parse(result.stdout.toString());
}

const text = (value: string) => new TextEncoder().encode(value);
// Every plan turns camera.photo on and data.fs off; the probe reads both.
const plan = (admit: number, id: string | null = ID) =>
  text(JSON.stringify({ ...(id === null ? {} : { app: { id } }), admit, features: { "camera.photo": true, "data.fs": false } }));
const otherHash = `sha256:${"ee".repeat(32)}`;

/** A variant with every section the firmware reads; `admit` is what the
 *  stand-in admission answers for it. */
function variant(target: string, admit: number, options: Partial<PocketPackageVariant> = {}): PocketPackageVariant {
  return {
    target, hostAbi, profileHash,
    sections: [
      { kind: POCKET_SECTION.identity, bytes: encodeIdentity({ output: "package", id: ID, title: "Package" }) },
      { kind: POCKET_SECTION.plan, bytes: plan(admit) },
      { kind: POCKET_SECTION.js, bytes: text("globalThis.frame=()=>{};\0") },
      { kind: POCKET_SECTION.pak, bytes: new Uint8Array(37).fill(4) },
      { kind: POCKET_SECTION.cover, bytes: new Uint8Array(19).fill(5) },
      { kind: POCKET_SECTION.bytecode, bytes: new Uint8Array(70).fill(6) },
      { kind: POCKET_SECTION.hostInputs, bytes: new Uint8Array(104).fill(7) },
      { kind: POCKET_SECTION.workerJs, bytes: text("self.x=1;\0") },
      { kind: POCKET_SECTION.workerBytecode, bytes: new Uint8Array(33).fill(9) },
    ],
    ...options,
  };
}

const manifest = text(JSON.stringify({ pocket: 2, id: ID }));
const pocket = (...variants: PocketPackageVariant[]) => encodePocketPackage({ manifest, variants });

/** Where `variant`'s plan lies in `bytes`. */
function planOffset(bytes: Uint8Array, target: string): number {
  const found = decodePocketPackage(bytes).variants.find((item) => item.target === target)!;
  return found.sections.find((section) => section.kind === POCKET_SECTION.plan)!.bytes.byteOffset;
}

describe("an admitted package is read in place", () => {
  test("hashes, slot, the admitted variant's sections and the package source", () => {
    const bytes = pocket(variant("tab5-home", 0));
    const decoded = decodePocketPackage(bytes).variants[0]!;
    const span = (kind: number): [number, number] => {
      const section = decoded.sections.find((item) => item.kind === kind)!.bytes;
      return [section.byteOffset, section.length];
    };
    const footer = new DataView(bytes.buffer).getBigUint64(bytes.length - 8, true);
    expect(open(bytes)).toEqual({
      ok: true,
      offered: [span(POCKET_SECTION.plan)[0]],
      hash: footer.toString(16).padStart(16, "0"),
      variantHash: fnv1a64(...decoded.sections.map((section) => section.bytes)).toString(16).padStart(16, "0"),
      slot: createHash("sha256").update(ID).digest("hex").slice(0, 16),
      hostAbi,
      features: { "camera.photo": true, "data.fs": false },
      inPlace: true,
      sections: {
        plan: span(POCKET_SECTION.plan),
        js: span(POCKET_SECTION.js),
        pak: span(POCKET_SECTION.pak),
        bytecode: span(POCKET_SECTION.bytecode),
        workerJs: span(POCKET_SECTION.workerJs),
        workerBytecode: span(POCKET_SECTION.workerBytecode),
      },
      factsPlan: span(POCKET_SECTION.plan),
      worker: [span(POCKET_SECTION.workerJs)[0], span(POCKET_SECTION.workerJs)[1] - 1],
      workerBytecode: span(POCKET_SECTION.workerBytecode),
      source: "ok",
    });
  });

  test("absent sections are stated as absent; a worker source without its NUL is none", () => {
    const bare = variant("tab5-home", 0);
    bare.sections = bare.sections.filter((section) =>
      section.kind !== POCKET_SECTION.workerJs && section.kind !== POCKET_SECTION.workerBytecode && section.kind !== POCKET_SECTION.js);
    const result = open(pocket(bare));
    expect(result.ok).toBe(true);
    expect([result.sections.js, result.sections.workerJs, result.sections.workerBytecode]).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect([result.worker, result.workerBytecode, result.source]).toEqual([null, null, "ok"]);
    const unterminated = variant("tab5-home", 0);
    unterminated.sections = unterminated.sections.map((section) =>
      section.kind === POCKET_SECTION.workerJs ? { kind: section.kind, bytes: text("self.x=1;") } : section);
    expect(open(pocket(unterminated)).worker).toBeNull();
  });
});

describe("variants are offered in admission order", () => {
  // File order is a-other, b-own; b-own carries the host's profile hash.
  const bytes = pocket(variant("a-other", 0, { profileHash: otherHash }), variant("b-own", 0));
  const other = planOffset(bytes, "a-other");
  const own = planOffset(bytes, "b-own");

  test("the host's profile hash first", () => {
    const result = open(bytes);
    expect([result.ok, result.offered, result.sections.plan[0]]).toEqual([true, [own], own]);
  });

  test("file order without a profile hash", () => {
    const result = open(bytes, "-");
    expect([result.ok, result.offered, result.sections.plan[0]]).toEqual([true, [other], other]);
  });

  test("a refused variant passes admission to the next", () => {
    const refused = pocket(variant("a-other", 0, { profileHash: otherHash }), variant("b-own", 22));
    const result = open(refused);
    expect([result.ok, result.offered, result.sections.plan[0]]).toEqual([
      true, [planOffset(refused, "b-own"), planOffset(refused, "a-other")], planOffset(refused, "a-other")]);
  });
});

describe("a package the firmware refuses gets a message", () => {
  const admitted = pocket(variant("tab5-home", 0));
  const resealed = (edit: (view: DataView, copy: Uint8Array) => void) => {
    const copy = admitted.slice();
    const view = new DataView(copy.buffer);
    edit(view, copy);
    view.setBigUint64(copy.length - 8, fnv1a64(copy.subarray(0, copy.length - 8)), true);
    return copy;
  };
  const cases: [string, Uint8Array, string][] = [
    ["the first offered variant's first missing item",
      pocket(variant("a-other", 24, { profileHash: otherHash }), variant("b-own", 22)),
      "tab5-home does not provide the package's viewport"],
    ["another binding generation", pocket(variant("tab5-home", 0, { hostAbi: hostAbi + 1 })),
      "the package was built for another binding generation"],
    ["no variant", pocket(), "the package has no variant"],
    ["a plan without an app id", pocket({ ...variant("tab5-home", 0), sections: [{ kind: POCKET_SECTION.plan, bytes: plan(0, null) }] }),
      "the package is damaged (8)"],
    ["a variant without a plan", pocket({ ...variant("tab5-home", 0), sections: [{ kind: POCKET_SECTION.js, bytes: text("1;\0") }] }),
      "the package is damaged (27)"],
    ["a bundle", resealed((view) => view.setUint32(0, 0x4442_4b50, true)), "the file is not a .pocket package (2)"],
    ["format 1", resealed((view) => view.setUint32(4, 1, true)), "the file is not a .pocket package (3)"],
    ["a footer that does not match", (() => { const copy = admitted.slice(); copy[copy.length - 1] ^= 1; return copy; })(),
      "the package is damaged (4)"],
    ["a payload changed under its variant hash", resealed((_, copy) => { copy[planOffset(admitted, "tab5-home")] ^= 1; }),
      "the package is damaged (4)"],
    ["a truncated file", admitted.subarray(0, 20), "the package is damaged (1)"],
  ];
  for (const [name, bytes, error] of cases) {
    test(name, () => {
      const result = open(bytes);
      expect([result.ok, result.error]).toEqual([false, error]);
    });
  }
});
