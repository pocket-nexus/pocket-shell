// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/applets.test.ts — every program Pocket Shell runs is a Pocket
// Applet (PocketJS docs/APPLETS.md) and meets the applet rules: the manifest
// rules and the source rules over its import graph. The bundle budgets run
// when each applet builds.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkApplet, formatAppletDiagnostics } from "../../../vendor/pocketjs/tools/applet-check.ts";
import { APPS, appContract, LAUNCHER } from "../scripts/apps.ts";
import { PROJECT_ROOT } from "../scripts/paths.ts";

const APPLETS = APPS.filter((app) => app !== LAUNCHER);

describe("Pocket Applets", () => {
  test("every app but the launcher declares itself an applet; the launcher does not", () => {
    for (const app of APPS) {
      const manifest = JSON.parse(readFileSync(appContract(app), "utf8"));
      expect([app, manifest.applet !== undefined]).toEqual([app, app !== LAUNCHER]);
    }
  });

  for (const app of APPLETS) {
    test(`${app} meets the applet rules`, () => {
      const diagnostics = checkApplet({ manifestPath: appContract(app), projectRoot: PROJECT_ROOT });
      if (diagnostics.length > 0) throw new Error(formatAppletDiagnostics(app, diagnostics));
    });
  }
});
