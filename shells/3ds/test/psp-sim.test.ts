// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/psp-sim.test.ts — what the PSP build carries, on the PSP's
// full screen (test/psp.ts): 480x272, no auxiliary surface, no touch, the
// link over the USB share. The build is Pocket Shell plus every applet of
// pocket-nexus/applets that resolves for the psp host contract
// (scripts/psp.ts). At this PocketJS none does: an applet with a network
// fetches through a worker, which the PSP host does not run, and one without
// the full-screen presentation needs touch. So the launcher is all there is
// to drive. The tests read every page by buttons alone, through the button
// legend along the bottom (ui/legend.tsx).
//
// POCKET_PSP_SHOTS=<dir> also writes the screens as PNGs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BTN } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import { appContract, LAUNCHER } from "../scripts/apps.ts";
import { pspApps } from "../scripts/psp.ts";
import { bootPsp, buildPspGuest, PSP, pspShot, USB_LINK } from "./psp.ts";

const OUT = mkdtempSync(join(tmpdir(), "pocket-psp-"));
let GUEST = "";
const GLOBALS = ["ui", "__pak", "__simHz", "frame", "link", "wifi", "camera", "net", "agent", "fs", "__pocketApp"] as const;
const saved = new Map(GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]));

beforeAll(async () => {
  GUEST = await buildPspGuest(LAUNCHER, OUT);
}, 120_000);

afterAll(() => {
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  rmSync(OUT, { recursive: true, force: true });
});

describe("the PSP build", () => {
  // When PocketJS gives the PSP a worker with an http node, the applets with
  // the full-screen presentation resolve and this fails: they then join the
  // journeys below.
  test("carries the launcher; the resolver leaves out what the PSP cannot run", () => {
    const { apps, left } = pspApps();
    expect(apps).toEqual([LAUNCHER]);
    expect(left.length).toBeGreaterThan(0);
    for (const { app, reasons } of left) {
      const contract = JSON.parse(readFileSync(appContract(app), "utf8"));
      if (contract.domains?.worker) expect([app, reasons]).toEqual([app, expect.stringContaining("does not provide runtime.worker, which the worker declaration requires")]);
      if (!contract.app.presentations) expect([app, reasons]).toEqual([app, expect.stringContaining("does not provide input.touch.auxiliary")]);
    }
  });

  test("Pocket Shell: the first icon holds the focus, □ edits, ○ opens Settings", async () => {
    const shell = await bootPsp(GUEST);
    await shell.run(40);
    expect(shell.world.viewport.auxiliary).toBeNull();
    expect([shell.world.viewport.width, shell.world.viewport.height]).toEqual(PSP);
    pspShot(shell, "shell");
    // No store over USB: the board holds Settings and says where applets come from.
    expect(shell.texts()).toEqual(expect.arrayContaining(["Settings", "No applets yet", "This console's applets come with its build.", "Open", "Edit"]));
    expect(shell.texts()).not.toContain("Mac");
    await shell.press(BTN.SQUARE, 20);
    pspShot(shell, "shell-edit");
    expect(shell.texts()).toEqual(expect.arrayContaining(["Remove", "Done"]));
    await shell.press(BTN.CROSS, 20);
    expect(shell.texts()).toEqual(expect.arrayContaining(["Open", "Edit"]));
    await shell.press(BTN.CIRCLE, 60);
    pspShot(shell, "shell-settings");
    expect(shell.texts()).toEqual(expect.arrayContaining(["Companion", "CardputerZero", "Open", "Home"]));
    expect(shell.link?.log.filter((call) => call.startsWith("catalog")) ?? []).toEqual([]);
  }, 120_000);

  test("Settings > Companion: linked over USB, or searching for the computer", async () => {
    for (const linked of [USB_LINK.linked, null]) {
      const shell = await bootPsp(GUEST, { link: { ...USB_LINK, linked } });
      await shell.run(40);
      await shell.press(BTN.CIRCLE, 60);
      await shell.press(BTN.DOWN, 10);
      await shell.press(BTN.CIRCLE, 60);
      pspShot(shell, `shell-companion-${linked ? "linked" : "searching"}`);
      const texts = shell.texts();
      expect(texts).toContain("Status");
      expect(texts).toContain(linked ? "Linked" : "Searching");
      expect(texts.join(" ")).toContain(linked ? "Linked to CardputerZero over USB." : "Run Pocket Hub there with --usb on the share.");
    }
  }, 120_000);
});
