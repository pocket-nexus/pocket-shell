// SPDX-License-Identifier: GPL-3.0-or-later
// devices/3ds/test/3ds-transition.test.ts — the 3DS host's app-switch overlay
// (devices/3ds/src/transition.c), compiled for the build machine: the phases'
// timing, the scrim's opacity, and the indicator's dots.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** devices/3ds: the product's sources. */
const PRODUCT = resolve(import.meta.dir, "..");
const FIXTURES = join(import.meta.dir, "fixtures");
const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Nintendo 3DS switch transition", () => {
  test("leaves, loads and arrives with the scrim and indicator it promises", () => {
    const directory = mkdtempSync(join(tmpdir(), "pocketjs-3ds-transition-"));
    temporary.push(directory);
    const binary = join(directory, "transition-test");
    const compiler = Bun.which("cc");
    expect(compiler).not.toBeNull();
    const compile = Bun.spawnSync([
      compiler!,
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      `-I${join(PRODUCT, "src")}`,
      join(FIXTURES, "3ds-transition.c"),
      join(PRODUCT, "src/transition.c"),
      "-lm",
      "-o",
      binary,
    ]);
    expect(compile.exitCode, compile.stderr.toString()).toBe(0);
    const run = Bun.spawnSync([binary]);
    expect(run.exitCode, run.stderr.toString()).toBe(0);
  });
});
