// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/applets.test.ts — every program Pocket Shell runs is a Pocket
// Applet (PocketJS docs/APPLETS.md) and meets the applet rules: the manifest
// rules and the source rules over its import graph. The bundle budgets run
// when each applet builds. An applet's network is the worker in
// ui/net-worker.ts, which every applet with net.http declares alike.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkApplet, formatAppletDiagnostics } from "../../../vendor/pocketjs/tools/applet-check.ts";
import { APPS, appContract, LAUNCHER } from "../scripts/apps.ts";
import { PROJECT_ROOT } from "../scripts/paths.ts";
import { NET_WORKER } from "../ui/net-wire.ts";

const APPLETS = APPS.filter((app) => app !== LAUNCHER);

describe("Pocket Applets", () => {
  test("every app but the launcher declares itself an applet; the launcher does not", () => {
    for (const app of APPS) {
      const manifest = JSON.parse(readFileSync(appContract(app), "utf8"));
      expect([app, manifest.applet !== undefined]).toEqual([app, app !== LAUNCHER]);
    }
  });

  test("an applet that declares net.http fetches through the shared worker, and only then has one", () => {
    for (const app of APPLETS) {
      const manifest = JSON.parse(readFileSync(appContract(app), "utf8"));
      const network = [...manifest.engine.capabilities.requires, ...(manifest.engine.capabilities.enhances ?? [])].includes("net.http");
      expect([app, manifest.domains?.worker ?? null]).toEqual([app, network ? NET_WORKER : null]);
    }
  });

  for (const app of APPLETS) {
    test(`${app} meets the applet rules`, () => {
      const diagnostics = checkApplet({ manifestPath: appContract(app), projectRoot: PROJECT_ROOT });
      if (diagnostics.length > 0) throw new Error(formatAppletDiagnostics(app, diagnostics));
    });
  }
});
