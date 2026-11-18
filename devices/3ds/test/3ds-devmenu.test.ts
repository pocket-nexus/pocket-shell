// SPDX-License-Identifier: GPL-3.0-or-later
// The 3DS program's development menu (devices/3ds/src/devmenu.c), compiled
// for this machine: its page is a list of rectangles inside the touch screen.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** devices/3ds: the product's sources and headers. */
const PRODUCT = resolve(import.meta.dir, "..");
/** PocketJS, for the generated contract headers. */
const POCKETJS = resolve(import.meta.dir, "../../../vendor/pocketjs");
const FIXTURES = join(import.meta.dir, "fixtures");
const temporary: string[] = [];
afterAll(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

describe("Nintendo 3DS development menu", () => {
  test("the native menu emits one bounded rectangle-only DrawList", () => {
    const directory = mkdtempSync(join(tmpdir(), "pocketjs-3ds-devmenu-"));
    temporary.push(directory);
    const binary = join(directory, "devmenu-test");
    const compiler = Bun.which("cc");
    expect(compiler).not.toBeNull();
    const compile = Bun.spawnSync([
      compiler!,
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      `-I${join(PRODUCT, "src")}`,
      `-I${join(PRODUCT, "include")}`,
      `-I${join(POCKETJS, "contracts/generated")}`,
      join(FIXTURES, "3ds-devmenu.c"),
      join(PRODUCT, "src/devmenu.c"),
      "-o",
      binary,
    ]);
    expect(compile.success, `exit=${compile.exitCode}, signal=${compile.signalCode}\n${compile.stderr}`).toBe(true);
    const run = Bun.spawnSync([binary]);
    expect(run.success, `exit=${run.exitCode}, signal=${run.signalCode}\n${run.stderr}`).toBe(true);
  });
});
