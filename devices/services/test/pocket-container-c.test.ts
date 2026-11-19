// SPDX-License-Identifier: GPL-3.0-or-later
// devices/services/pocket_container.c, the `.pocket` reader of the device
// programs, compiled for the build machine under ASan and UBSan
// (fixtures/pocket-container.c):
//
// - for packages the TypeScript encoder writes (runtime/spec/pocket-package.ts)
//   and the admission corpus (runtime/test/fixtures/admission), the reader
//   states the same manifest, variants and section spans the TypeScript
//   decoder reads;
// - a damaged package gets the code of the check the decoder fails first;
// - variants are offered in the order runtime/spec/admission.ts selects
//   them: the host's profile hash first, then file order.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  decodePocketPackage,
  encodeIdentity,
  encodePocketPackage,
  fnv1a64,
  POCKET_SECTION,
  type PocketPackage,
} from "../../../runtime/spec/pocket-package.ts";

const SERVICES = resolve(import.meta.dir, "..");
const ROOT = resolve(SERVICES, "../..");
const CORPUS = resolve(ROOT, "runtime/test/fixtures/admission/package.pocket");
const OPEN = {
  ok: 0, truncated: 1, badMagic: 2, badVersion: 3, hashMismatch: 4, badUtf8: 5, viewport: 22, badLayout: 17, source: 27,
} as const;

let scratch = "";
let probe = "";

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "pocket-container-"));
  probe = join(scratch, "probe");
  const compile = Bun.spawnSync([
    "cc", "-std=gnu11", "-O1", "-g", "-Wall", "-Wextra", "-Werror", "-fsanitize=address,undefined",
    "-fno-sanitize-recover=all", `-I${SERVICES}`, `-I${resolve(ROOT, "vendor/pocketjs/contracts/generated")}`,
    resolve(import.meta.dir, "fixtures/pocket-container.c"), resolve(SERVICES, "pocket_container.c"), "-o", probe,
  ]);
  expect(compile.exitCode, compile.stderr.toString()).toBe(0);
}, 120_000);

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

let files = 0;
function run(bytes: Uint8Array, ...args: string[]): any {
  const path = join(scratch, `package-${files++}.pocket`);
  writeFileSync(path, bytes);
  const result = Bun.spawnSync([probe, args[0]!, path, ...args.slice(1)]);
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return JSON.parse(result.stdout.toString());
}

const text = (value: string) => new TextEncoder().encode(value);
const hash = (byte: string) => `sha256:${byte.repeat(32)}`;

/** Three variants with every section kind between them, an unknown kind,
 *  an empty payload and a manifest whose length is not a multiple of 16. */
function richPackage(): PocketPackage {
  const plan = (target: string) => text(JSON.stringify({ target: { id: target }, app: { id: "dev.test.rich" } }));
  return {
    manifest: text('{"pocket":2,"id":"dev.test.rich"}'),
    variants: [
      {
        target: "tab5-home", hostAbi: 12, profileHash: hash("aa"),
        sections: [
          { kind: POCKET_SECTION.identity, bytes: encodeIdentity({ output: "rich", id: "dev.test.rich", title: "Rich" }) },
          { kind: POCKET_SECTION.plan, bytes: plan("tab5-home") },
          { kind: POCKET_SECTION.pak, bytes: new Uint8Array(37).fill(4) },
          { kind: POCKET_SECTION.cover, bytes: new Uint8Array(19).fill(5) },
          { kind: POCKET_SECTION.bytecode, bytes: new Uint8Array(70).fill(6) },
          { kind: POCKET_SECTION.hostInputs, bytes: new Uint8Array(104).fill(7) },
          { kind: POCKET_SECTION.workerBytecode, bytes: new Uint8Array(33).fill(9) },
          { kind: 12, bytes: new Uint8Array(3).fill(12) },
        ],
      },
      {
        target: "3ds-dev", hostAbi: 12, profileHash: hash("bb"),
        sections: [
          { kind: POCKET_SECTION.identity, bytes: encodeIdentity({ output: "rich", id: "dev.test.rich", title: "Rich" }) },
          { kind: POCKET_SECTION.plan, bytes: plan("3ds-dev") },
          { kind: POCKET_SECTION.js, bytes: text("globalThis.frame=()=>{};\0") },
          { kind: POCKET_SECTION.pak, bytes: new Uint8Array(0) },
          { kind: POCKET_SECTION.workerJs, bytes: text("self.x=1;\0") },
        ],
      },
      {
        target: "psp", hostAbi: 11, profileHash: hash("cc"),
        sections: [{ kind: POCKET_SECTION.plan, bytes: plan("psp") }, { kind: POCKET_SECTION.js, bytes: text("1;\0") }],
      },
    ],
  };
}

/** What the reader must state for `bytes`, from the TypeScript decoder. */
function expected(bytes: Uint8Array) {
  const decoded = decodePocketPackage(bytes);
  const at = (part: Uint8Array) => part.byteOffset - bytes.byteOffset;
  const footer = new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(bytes.length - 8, true);
  return {
    code: OPEN.ok,
    hash: footer.toString(16).padStart(16, "0"),
    manifest: [decoded.manifest.length ? at(decoded.manifest) : 32, decoded.manifest.length],
    variants: decoded.variants.map((variant) => {
      const spans: Record<string, [number, number]> = {};
      for (let kind = 1; kind <= 9; kind++) {
        const section = variant.sections.find((item) => item.kind === kind);
        spans[String(kind)] = section ? [section.bytes.length ? at(section.bytes) : expectOffset(bytes, variant.target, kind), section.bytes.length] : [0, 0];
      }
      return {
        target: variant.target,
        hostAbi: variant.hostAbi,
        hash: fnv1a64(...variant.sections.map((section) => section.bytes)).toString(16).padStart(16, "0"),
        profile: variant.profileHash.slice("sha256:".length),
        sectionsAbi: variant.hostAbi,
        structSize: true,
        ...spans,
      };
    }),
  };
}

/** The table offset of an empty section, which subarray() does not keep. */
function expectOffset(bytes: Uint8Array, target: string, kind: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const manifest = view.getUint32(8, true);
  const table = Math.ceil((32 + manifest) / 16) * 16;
  for (let v = 0; v < view.getUint32(12, true); v++) {
    const entry = table + v * 64;
    const name = new TextDecoder().decode(bytes.subarray(view.getUint32(entry, true), view.getUint32(entry, true) + view.getUint32(entry + 4, true)));
    if (name !== target) continue;
    for (let s = 0; s < view.getUint32(entry + 12, true); s++) {
      const section = view.getUint32(entry + 16, true) + s * 16;
      if (view.getUint32(section, true) === kind) return view.getUint32(section + 8, true);
    }
  }
  throw new Error("no such section");
}

/** `bytes` with `edit` applied and the footer rewritten, so the check after
 *  the footer's is the one that fails. */
function resealed(bytes: Uint8Array, edit: (view: DataView, copy: Uint8Array) => void): Uint8Array {
  const copy = bytes.slice();
  const view = new DataView(copy.buffer);
  edit(view, copy);
  view.setBigUint64(copy.length - 8, fnv1a64(copy.subarray(0, copy.length - 8)), true);
  return copy;
}

describe("the .pocket reader states what the TypeScript decoder reads", () => {
  test("the admission corpus", () => {
    const bytes = new Uint8Array(readFileSync(CORPUS));
    expect(run(bytes, "open")).toEqual(expected(bytes));
  });

  test("every section kind, an unknown kind, an empty payload and three variants", () => {
    const bytes = encodePocketPackage(richPackage());
    expect(run(bytes, "open")).toEqual(expected(bytes));
  });

  test("an empty manifest and no variants", () => {
    const bytes = encodePocketPackage({ manifest: new Uint8Array(0), variants: [] });
    expect(run(bytes, "open")).toEqual(expected(bytes));
    expect(run(bytes, "select", "-", "anything")).toEqual({ offered: [], code: OPEN.source, chosen: -1 });
  });
});

describe("a damaged package is refused by the first check it fails", () => {
  const bytes = encodePocketPackage(richPackage());
  const planOffset = decodePocketPackage(bytes).variants[0]!.sections[1]!.bytes.byteOffset;
  const cases: [string, Uint8Array, number][] = [
    ["too short for a magic", bytes.subarray(0, 7), OPEN.truncated],
    ["another magic", resealed(bytes, (view) => view.setUint32(0, 0x4442_4b50, true)), OPEN.badMagic],
    ["format 1", resealed(bytes, (view) => view.setUint32(4, 1, true)), OPEN.badVersion],
    ["a header without its footer", bytes.subarray(0, 39), OPEN.truncated],
    ["a payload byte changed", (() => { const copy = bytes.slice(); copy[planOffset] ^= 1; return copy; })(), OPEN.hashMismatch],
    ["a reserved header word", resealed(bytes, (view) => view.setUint32(28, 1, true)), OPEN.badLayout],
    ["a reserved variant word", resealed(bytes, (view) => view.setUint32(Math.ceil((32 + view.getUint32(8, true)) / 16) * 16 + 20, 1, true)), OPEN.badLayout],
    ["a manifest past the end", resealed(bytes, (view) => view.setUint32(8, 0x7fff_0000, true)), OPEN.badLayout],
    ["a variant count past the table", resealed(bytes, (view) => view.setUint32(12, 0x0400_0000, true)), OPEN.badLayout],
    ["a payload changed under its variant hash", resealed(bytes, (_, copy) => { copy[planOffset] ^= 1; }), OPEN.hashMismatch],
    ["one trailing payload byte", (() => {
      const copy = new Uint8Array(bytes.length + 16);
      copy.set(bytes.subarray(0, bytes.length - 8));
      copy.set(bytes.subarray(bytes.length - 8), bytes.length + 8);
      return resealed(copy, () => {});
    })(), OPEN.badLayout],
  ];
  for (const [name, damaged, code] of cases) {
    test(name, () => {
      expect(() => decodePocketPackage(damaged)).toThrow();
      expect(run(damaged, "open")).toEqual({ code });
    });
  }

  test("target ids out of order or not UTF-8", () => {
    const pkg = richPackage();
    const encoded = encodePocketPackage(pkg);
    const view = new DataView(encoded.buffer);
    const table = Math.ceil((32 + view.getUint32(8, true)) / 16) * 16;
    // Variants sort by target: 3ds-dev, psp, tab5-home. Rename psp to "o\xffp".
    const psp = view.getUint32(table + 64, true);
    const badUtf8 = resealed(encoded, (_, copy) => { copy[psp + 1] = 0xff; });
    expect(run(badUtf8, "open")).toEqual({ code: OPEN.badUtf8 });
    // "3ds-dev" renamed "zds-dev" sorts after psp.
    const unordered = resealed(encoded, (_, copy) => { copy[view.getUint32(table, true)] = 0x7a; });
    expect(run(unordered, "open")).toEqual({ code: OPEN.badLayout });
  });
});

describe("variants are offered in admission order", () => {
  const bytes = encodePocketPackage(richPackage());
  // File order is 3ds-dev (bb), psp (cc), tab5-home (aa).
  test("the host's profile hash first, then file order", () => {
    expect(run(bytes, "select", "aa".repeat(32), "psp")).toEqual({ offered: [2, 0, 1], code: OPEN.ok, chosen: 1 });
    expect(run(bytes, "select", "aa".repeat(32), "tab5-home", "psp")).toEqual({ offered: [2], code: OPEN.ok, chosen: 2 });
    expect(run(bytes, "select", "-", "tab5-home")).toEqual({ offered: [0, 1, 2], code: OPEN.ok, chosen: 2 });
  });

  test("no variant admitted: the code of the first offered", () => {
    expect(run(bytes, "select", "cc".repeat(32), "nothing")).toEqual({ offered: [1, 0, 2], code: OPEN.viewport, chosen: -1 });
  });

  test("a damaged package is not offered", () => {
    const copy = bytes.slice();
    copy[copy.length - 1] ^= 1;
    expect(run(copy, "select", "-", "psp")).toEqual({ open: OPEN.hashMismatch });
  });
});
