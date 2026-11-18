// SPDX-License-Identifier: GPL-3.0-or-later
// The 3DS program's package storage (devices/3ds/src/runtime.c), compiled for
// this machine: staging, immutable blobs, generations and slot removal.

import { POCKET_BINDING_GENERATION } from "../../../vendor/pocketjs/contracts/spec/binding-generation.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** devices/3ds: the product's sources and headers. */
const PRODUCT = resolve(import.meta.dir, "..");
/** devices/services: the portable host services. */
const SERVICES = resolve(import.meta.dir, "../../services");
/** PocketJS, for the generated contract headers. */
const POCKETJS = resolve(import.meta.dir, "../../../vendor/pocketjs");
const FIXTURES = join(import.meta.dir, "fixtures");
const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Nintendo 3DS Pocket Runtime storage", () => {
  test("stages immutable packages and appends active/last-good generations", () => {
    const directory = mkdtempSync(join(tmpdir(), "pocketjs-3ds-runtime-"));
    temporary.push(directory);
    const binary = join(directory, "runtime-state-test");
    const compiler = Bun.which("cc");
    expect(compiler).not.toBeNull();
    const compile = Bun.spawnSync([
      compiler!,
      "-std=c11",
      "-D_POSIX_C_SOURCE=200809L",
      '-DPOCKETJS_TARGET_ID="3ds-dev"',
      `-DPOCKETJS_HOST_ABI=${POCKET_BINDING_GENERATION}`,
      `-I${join(PRODUCT, "include")}`,
      `-I${join(POCKETJS, "contracts/generated")}`,
      `-I${join(PRODUCT, "src")}`,
      `-I${SERVICES}`,
      join(FIXTURES, "3ds-runtime-state.c"),
      join(PRODUCT, "src/runtime.c"),
      // runtime_slot_remove deletes a slot with fs.c's tree removal.
      join(SERVICES, "fs.c"),
      join(SERVICES, "jscan.c"),
      "-o",
      binary,
    ]);
    expect(compile.success, `exit=${compile.exitCode}, signal=${compile.signalCode}\n${compile.stderr}`).toBe(true);

    const run = Bun.spawnSync([binary, directory]);
    expect(run.success, `exit=${run.exitCode}, signal=${run.signalCode}\n${run.stderr}`).toBe(true);
  });
});
