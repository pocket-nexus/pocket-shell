// SPDX-License-Identifier: GPL-3.0-or-later
// devices/3ds/test/3ds-soc.test.ts — the SOC service's shared initializer
// (devices/3ds/platform/soc.c), compiled for the build machine against a fake
// libctru (fixtures/3ds-soc): concurrent initialization, the cooldown after a
// failure, recovery and shutdown.

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** devices/3ds: the platform sources and the test fixtures. */
const PRODUCT = resolve(import.meta.dir, "..");

test("3DS transports share SOC without waiting on a competing initializer", () => {
  const scratch = mkdtempSync(join(tmpdir(), "pocket-soc-"));
  try {
    const binary = join(scratch, "soc");
    const compile = Bun.spawnSync(["cc", "-std=c11", "-O2", "-pthread", "-fsanitize=address,undefined",
      `-I${PRODUCT}/test/fixtures/3ds-soc`, `${PRODUCT}/test/fixtures/3ds-soc/harness.c`,
      `${PRODUCT}/platform/soc.c`, "-o", binary]);
    expect(compile.exitCode, compile.stderr.toString()).toBe(0);
    const run = Bun.spawnSync([binary], { timeout: 10000 });
    expect(run.exitCode, run.stderr.toString()).toBe(0);
    expect(run.stdout.toString()).toContain("SOC concurrent init, cooldown, recovery and shutdown verified");
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
