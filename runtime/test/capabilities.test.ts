// SPDX-License-Identifier: GPL-3.0-or-later
// runtime/test/capabilities.test.ts — the capability ids Pocket Shell defines
// (runtime/spec/capabilities.ts) beside PocketJS's registry, the host
// contracts that list them, and an app contract resolved with them.

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { POCKET_CAPABILITIES } from "../../vendor/pocketjs/contracts/spec/capabilities.ts";
import { readPocketProfile } from "../../vendor/pocketjs/framework/src/profile.ts";
import { readPocketManifest } from "../manifest/load.ts";
import { shellRegistry } from "../manifest/registry.ts";
import { validateAndResolveBuildPlan, validatePlatformContractRegistry } from "../manifest/resolve.ts";
import { SHELL_CAPABILITIES, SHELL_CAPABILITY_REGISTRY } from "../spec/capabilities.ts";
import type { PocketManifestV2 } from "../spec/pocket-manifest.ts";

const path = (relative: string) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));
const HOSTS = {
  "3ds-dev": readPocketProfile(path("devices/3ds/pocket.host.json")),
  "tab5-home": readPocketProfile(path("devices/m5stack/programs/m5stack-tab5/pocket.host.json")),
  "pocket-shell-psp": readPocketProfile(path("devices/psp/pocket-shell-psp.host.json")),
};
const LAUNCHER = readPocketManifest(path("shells/3ds/shell/pocket.app.json")).manifest as PocketManifestV2;

describe("Pocket Shell's capability ids", () => {
  test("PocketJS registers none of them", () => {
    for (const id of SHELL_CAPABILITIES) expect(POCKET_CAPABILITIES as readonly string[]).not.toContain(id);
  });

  test("every id a Pocket Shell host lists is PocketJS's or Pocket Shell's", () => {
    for (const profile of Object.values(HOSTS)) {
      expect(validatePlatformContractRegistry(shellRegistry(profile))).toEqual([]);
      for (const id of profile.capabilities) expect(SHELL_CAPABILITY_REGISTRY as readonly string[], `${profile.id} ${id}`).toContain(id);
    }
  });

  test("the launcher's enhancements resolve on every host, true where the host lists them", () => {
    const enhances = LAUNCHER.engine.capabilities.enhances ?? [];
    expect(enhances).toContain("system.agent");
    for (const profile of Object.values(HOSTS)) {
      const result = validateAndResolveBuildPlan(LAUNCHER, { target: profile.id }, shellRegistry(profile));
      if (!result.ok) throw new Error(`${profile.id}: ${JSON.stringify(result.diagnostics)}`);
      for (const id of enhances) {
        expect(result.plan.features[id], `${profile.id} ${id}`).toBe((profile.capabilities as readonly string[]).includes(id));
      }
    }
  });
});
