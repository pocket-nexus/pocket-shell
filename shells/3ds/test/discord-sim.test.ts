// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/discord-sim.test.ts — the Discord app headless on the wasm
// core with the 3DS geometry and the companion's discord service as NET
// routes (test/discord-fixture.ts): setup, servers, channels, a channel's
// messages newest at the bottom, the live poll, earlier pages and sending
// with the system keyboard. The app draws nothing on the top screen.
//
// POCKET_DISCORD_SHOTS=<dir> writes bottom-screen PNGs of each state.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BTN } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import { bootConsole3ds, type Console3ds } from "../../../vendor/pocketjs/hosts/sim/console-3ds.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { buildGuest } from "./build.ts";
import { discordFixture, type DiscordFixture } from "./discord-fixture.ts";

const OUT = mkdtempSync(join(tmpdir(), "pocket-discord-"));
let GUEST = join(OUT, "guest", "discord-main");
const SHOTS = process.env.POCKET_DISCORD_SHOTS;
const GLOBALS = ["ui", "__pak", "__simHz", "frame", "link", "wifi", "camera", "net", "__pocketApp"] as const;
const saved = new Map(GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]));

beforeAll(() => {
  GUEST = buildGuest("discord", OUT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}, 120_000);

afterAll(() => {
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  rmSync(OUT, { recursive: true, force: true });
});

async function boot(fixture: DiscordFixture): Promise<Console3ds> {
  const app = await bootConsole3ds({ js: `${GUEST}.js`, pak: `${GUEST}.pak`, current: "discord-main", link: null, wifi: null, camera: false, net: fixture.routes });
  await app.run(30);
  return app;
}

function shot(app: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = app.world.pixels("auxiliary");
  writeFileSync(join(SHOTS, `discord-${name}.png`), encodePNG(rgba, width, height));
}

const started = (app: Console3ds) => app.net!.log.filter((line) => line.startsWith("start ")).map((line) => line.split(" ")[3]!);
const visible = (app: Console3ds, text: string) => {
  const box = app.locate(text);
  return box !== null && box[1] >= 36 && box[1] + box[3] <= 240;
};

async function openGeneral(fixture: DiscordFixture): Promise<Console3ds> {
  const app = await boot(fixture);
  await app.tapText("Pocket Lab");
  await app.run(40);
  await app.tapText("general");
  await app.run(60);
  return app;
}

describe("discord", () => {
  test("without a bot on the Mac it says how to set one up", async () => {
    const fixture = discordFixture({ setup: false });
    const app = await boot(fixture);
    const texts = app.texts("auxiliary").join(" ");
    expect(texts).toContain("Set up Discord on your Mac");
    expect(texts).toContain("service discord token");
    shot(app, "setup");
    fixture.setup = true;
    await app.tapText("Try Again");
    await app.run(20);
    expect(app.texts("auxiliary")).toContain("Pocket Lab");
  });

  test("servers, then channels under their categories, nothing on the top screen", async () => {
    const fixture = discordFixture();
    const app = await boot(fixture);
    expect(app.texts("auxiliary")).toEqual(expect.arrayContaining(["Servers", "Pocket Lab", "Retro Handhelds"]));
    expect(app.texts("primary").filter((text) => text.trim())).toEqual([]);
    expect(started(app).some((url) => url.endsWith("/icon/100/i1"))).toBe(true);
    shot(app, "servers");
    await app.tapText("Pocket Lab");
    await app.run(40);
    const texts = app.texts("auxiliary");
    expect(texts).toEqual(expect.arrayContaining(["welcome", "TEXT CHANNELS", "general", "3ds-dev"]));
    expect(app.locate("welcome")![1]).toBeLessThan(app.locate("TEXT CHANNELS")![1]);
    shot(app, "channels");
  });

  test("the bar's back button leaves a channel, then the channel list", async () => {
    const fixture = discordFixture();
    const app = await openGeneral(fixture);
    expect(app.texts("auxiliary")).toContain("#general");
    await app.tapText("Channels");
    await app.run(40);
    expect(app.texts("auxiliary")).toEqual(expect.arrayContaining(["TEXT CHANNELS", "general"]));
    await app.tapText("Servers");
    await app.run(40);
    expect(app.texts("auxiliary")).toEqual(expect.arrayContaining(["Pocket Lab", "Retro Handhelds"]));
  });

  test("a channel opens at its newest message, grouped by author, with replies", async () => {
    const fixture = discordFixture();
    const app = await openGeneral(fixture);
    expect(visible(app, "Newest: the bot says hello.")).toBe(true);
    const texts = app.texts("auxiliary");
    expect(texts).toContain("#general");
    expect(texts).toContain("pocketbot");
    expect(texts.some((text) => text.startsWith("@Alice Has anyone tried"))).toBe(true);
    expect(started(app).some((url) => url.includes("/avatar/303/b0"))).toBe(true);
    shot(app, "chat");
  });

  test("the live poll appends a new message and follows it to the bottom", async () => {
    const fixture = discordFixture();
    const app = await openGeneral(fixture);
    expect(fixture.polls).toBeGreaterThan(0);
    fixture.push("A message that arrived live.");
    await app.run(200);
    expect(visible(app, "A message that arrived live.")).toBe(true);
    shot(app, "live");
  });

  test("X opens the composer; typed text is sent with START and shows up", async () => {
    const fixture = discordFixture();
    const app = await openGeneral(fixture);
    await app.press(BTN.TRIANGLE, 10);
    expect(app.texts("auxiliary")).toEqual(expect.arrayContaining(["Cancel", "Send"]));
    for (const key of ["h", "i"]) await app.tapText(key);
    shot(app, "compose");
    await app.press(BTN.START, 30);
    expect(fixture.posted).toEqual([{ channel: "201", content: "hi" }]);
    expect(app.texts("auxiliary")).not.toContain("Cancel");
    expect(visible(app, "hi")).toBe(true);
  });

  test("B keeps the draft; the bar's Send and Cancel answer the stylus; B leaves the channel and stops the poll", async () => {
    const fixture = discordFixture();
    const app = await openGeneral(fixture);
    await app.press(BTN.TRIANGLE, 10);
    await app.tapText("o");
    await app.press(BTN.CROSS, 10);
    expect(app.texts("auxiliary")).not.toContain("Cancel");
    await app.press(BTN.TRIANGLE, 10);
    expect(app.texts("auxiliary").some((text) => text.startsWith("o"))).toBe(true);
    await app.tapText("k");
    await app.tapText("Send");
    await app.run(30);
    expect(fixture.posted).toEqual([{ channel: "201", content: "ok" }]);
    expect(app.texts("auxiliary")).not.toContain("Cancel");
    await app.press(BTN.TRIANGLE, 10);
    await app.tapText("Cancel");
    await app.run(10);
    expect(app.texts("auxiliary")).not.toContain("Cancel");
    await app.press(BTN.CROSS, 40);
    expect(app.texts("auxiliary")).toContain("general");
    const polls = fixture.polls;
    await app.run(300);
    expect(fixture.polls).toBeLessThanOrEqual(polls + 1);
  });

  test("scrolling to the top pages in earlier messages and keeps the place", async () => {
    const fixture = discordFixture({ history: 60 });
    const app = await openGeneral(fixture);
    expect(app.texts("auxiliary").join(" ")).not.toContain("Message number 1 in the backlog.");
    for (let swipe = 0; swipe < 30 && !app.texts("auxiliary").includes("Load earlier messages") && !app.texts("auxiliary").includes("Loading..."); swipe++) {
      await app.drag(160, 70, 160, 230, 8);
      await app.run(10);
    }
    await app.run(60);
    expect(started(app).some((url) => url.includes("before="))).toBe(true);
    for (let swipe = 0; swipe < 30 && !app.texts("auxiliary").includes("Message number 1 in the backlog."); swipe++) {
      await app.drag(160, 70, 160, 230, 8);
      await app.run(10);
    }
    expect(app.texts("auxiliary")).toContain("Message number 1 in the backlog.");
  });
});
