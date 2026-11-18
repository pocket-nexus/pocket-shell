// SPDX-License-Identifier: GPL-3.0-or-later
// The 3DS program's .3dsx installation (devices/3ds/src/native.c), compiled
// for this machine: staging, the length, CRC-32 and magic checks, the swap and
// the deferred file of the running program.

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

describe("Nintendo 3DS .3dsx installation", () => {
  test("stages, verifies and swaps .3dsx files, deferring the running one to its own file", () => {
    const directory = mkdtempSync(join(tmpdir(), "pocketjs-3ds-native-"));
    temporary.push(directory);
    const binary = join(directory, "native-install-test");
    const compiler = Bun.which("cc");
    expect(compiler).not.toBeNull();
    const compile = Bun.spawnSync([
      compiler!,
      "-std=c11",
      "-D_POSIX_C_SOURCE=200809L",
      `-I${join(PRODUCT, "include")}`,
      `-I${join(POCKETJS, "contracts/generated")}`,
      `-I${join(PRODUCT, "src")}`,
      `-I${SERVICES}`,
      join(FIXTURES, "3ds-native-install.c"),
      join(PRODUCT, "src/native.c"),
      join(SERVICES, "link2_proto.c"),
      join(SERVICES, "jscan.c"),
      join(SERVICES, "sha256.c"),
      "-o",
      binary,
    ]);
    expect(compile.success, `exit=${compile.exitCode}, signal=${compile.signalCode}\n${compile.stderr}`).toBe(true);

    const run = Bun.spawnSync([binary, directory]);
    expect(run.success, `exit=${run.exitCode}, signal=${run.signalCode}\n${run.stderr}`).toBe(true);
  });
});
