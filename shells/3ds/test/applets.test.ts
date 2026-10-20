// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/applets.test.ts — every program Home runs is a Pocket
// Applet (PocketJS docs/APPLETS.md) and meets the applet rules: the manifest
// rules and the source rules over its import graph. The bundle budgets run
// when each applet builds.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkApplet, formatAppletDiagnostics } from "../../../vendor/pocketjs/tools/applet-check.ts";
import { APPS, LAUNCHER } from "../scripts/apps.ts";
import { PROJECT_ROOT } from "../scripts/paths.ts";

const APPLETS = APPS.filter((app) => app !== LAUNCHER);

describe("Pocket Applets", () => {
  test("every app but the launcher declares itself an applet; Home does not", () => {
    for (const app of APPS) {
      const manifest = JSON.parse(readFileSync(resolve(PROJECT_ROOT, app, "pocket.json"), "utf8"));
      expect([app, manifest.applet !== undefined]).toEqual([app, app !== LAUNCHER]);
    }
  });

  for (const app of APPLETS) {
    test(`${app} meets the applet rules`, () => {
      const diagnostics = checkApplet({ manifestPath: resolve(PROJECT_ROOT, app, "pocket.json"), projectRoot: PROJECT_ROOT });
      if (diagnostics.length > 0) throw new Error(formatAppletDiagnostics(app, diagnostics));
    });
  }
});
