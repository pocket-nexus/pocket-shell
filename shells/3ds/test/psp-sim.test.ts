// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/psp-sim.test.ts — Home and the applets on the PSP's full
// screen (test/psp.ts): 480x272, no auxiliary surface, no touch. Each program
// is the same entry as on the 3DS, built for the psp profile's full-screen
// presentation. The tests drive every page by buttons alone and read the
// button legend along the bottom (ui/legend.tsx).
//
// POCKET_PSP_SHOTS=<dir> also writes the screens as PNGs.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BTN } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import { discordFixture } from "./discord-fixture.ts";
import { hnRoutes } from "./hn-fixture.ts";
import { bootPsp, buildPspGuest, PSP, pspShot } from "./psp.ts";
import { xRoutes } from "./x-fixture.ts";

const OUT = mkdtempSync(join(tmpdir(), "pocket-psp-"));
const GLOBALS = ["ui", "__pak", "__simHz", "frame", "link", "wifi", "camera", "net", "agent", "fs", "__pocketApp"] as const;
const saved = new Map(GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]));
afterAll(() => {
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  rmSync(OUT, { recursive: true, force: true });
});

const APPS = [
  { output: "hn-main", id: "dev.pocket-nexus.hn", title: "Hacker News", version: "0.1.0", bytes: 61_440 },
  { output: "youtube-main", id: "dev.pocket-nexus.youtube", title: "YouTube", version: "0.1.0", bytes: 61_440 },
  { output: "x-main", id: "dev.pocket-nexus.x", title: "X", version: "0.1.0", bytes: 61_440 },
  { output: "discord-main", id: "dev.pocket-nexus.discord", title: "Discord", version: "0.1.0", bytes: 61_440 },
];

describe("the PSP's full screen", () => {
  test("Home: the first icon holds the focus, ○ opens it, □ edits", async () => {
    const home = await bootPsp(buildPspGuest("home", OUT), { apps: APPS, current: "home-main" });
    await home.run(40);
    expect(home.world.viewport.auxiliary).toBeNull();
    expect([home.world.viewport.width, home.world.viewport.height]).toEqual(PSP);
    pspShot(home, "home");
    expect(home.texts()).toEqual(expect.arrayContaining(["Hacker News", "YouTube", "X", "Discord", "Open", "Edit"]));
    await home.press(BTN.SQUARE, 20);
    pspShot(home, "home-edit");
    expect(home.texts()).toEqual(expect.arrayContaining(["Remove", "Done"]));
    await home.press(BTN.CROSS, 20);
    await home.press(BTN.RIGHT, 10);
    await home.press(BTN.CIRCLE, 40);
    expect(home.launches).toEqual(["youtube-main"]);
  }, 120_000);

  test("Home over the USB carrier: no store icon; Settings names the companion", async () => {
    const zero = { id: "1e992d21f442aba3", name: "CardputerZero", address: "usb", port: 0 };
    const home = await bootPsp(buildPspGuest("home", OUT), {
      apps: APPS,
      current: "home-main",
      link: { device: { id: "000004766e7535b5", name: "PSP", model: "PSP", address: "usb" }, paired: [zero], linked: zero.id },
    });
    await home.run(40);
    expect(home.texts()).toEqual(expect.arrayContaining(["Settings", "Hacker News"]));
    expect(home.texts()).not.toContain("Mac");
    await home.press(BTN.DOWN, 20);
    await home.press(BTN.CIRCLE, 60);
    pspShot(home, "home-settings-usb");
    expect(home.texts()).toEqual(expect.arrayContaining(["Companion", "CardputerZero"]));
    expect(home.link?.log.filter((call) => call.startsWith("catalog")) ?? []).toEqual([]);
  }, 120_000);

  test("Hacker News: the legend follows the page, ○ opens a thread, × comes back", async () => {
    const hn = await bootPsp(buildPspGuest("hn", OUT), { current: "hn-main", net: hnRoutes() });
    await hn.run(90);
    pspShot(hn, "hn-list");
    expect(hn.texts()).toEqual(expect.arrayContaining(["Open", "Feed", "Reload", "Home"]));
    await hn.press(BTN.CIRCLE, 120);
    pspShot(hn, "hn-thread");
    expect(hn.texts()).toEqual(expect.arrayContaining(["Fold", "Stories", "Page"]));
    await hn.press(BTN.CROSS, 40);
    expect(hn.texts()).toEqual(expect.arrayContaining(["Feed"]));
  }, 120_000);

  test("X: L and R change the timeline", async () => {
    const x = await bootPsp(buildPspGuest("x", OUT), { current: "x-main", net: xRoutes({ calls: { actions: [], replies: [], glyphs: [] } }) });
    await x.run(120);
    pspShot(x, "x-home");
    expect(x.texts()).toEqual(expect.arrayContaining(["Following", "For You", "Timeline", "Reload"]));
  }, 120_000);

  test("Discord: the empty channel names △, which opens the grid keyboard and its chords", async () => {
    const fixture = discordFixture();
    const discord = await bootPsp(buildPspGuest("discord", OUT), { current: "discord-main", net: fixture.routes });
    await discord.run(90);
    await discord.press(BTN.CIRCLE, 60);
    await discord.press(BTN.CIRCLE, 90);
    pspShot(discord, "discord-chat");
    expect(discord.texts().join(" ")).toContain("Press △ to write");
    expect(discord.texts()).toEqual(expect.arrayContaining(["Channels", "Write", "Reload"]));
    await discord.press(BTN.TRIANGLE, 40);
    pspShot(discord, "discord-compose");
    expect(discord.texts()).toEqual(expect.arrayContaining(["Delete", "Space", "Shift", "Send", "Close"]));
    expect(discord.texts()).not.toContain("Home");
  }, 120_000);
});
