// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/x-sim.test.ts — the X app headless on the wasm core with the
// 3DS geometry and the companion's x service as fixture NET routes
// (test/x-fixture.ts): the timeline with reposts, quotes and avatars, paging
// by cursor, the For You list, a post's thread and a reply's, the signed-out
// state. The app draws nothing on the top screen.
//
// POCKET_X_SHOTS=<dir> also writes bottom-screen PNGs of each state.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BTN } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import { bootConsole3ds, type Console3ds, type Console3dsOptions } from "../../../vendor/pocketjs/programs/sim/console-3ds.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { buildGuest } from "./build.ts";
import { CJK_NAME, X_SERVICE, xRoutes, type XCalls } from "./x-fixture.ts";
import { PORTRAIT, TAB5, tab5Shot } from "./tab5.ts";

const OUT = mkdtempSync(join(tmpdir(), "pocket-x-"));
let GUEST = join(OUT, "guest", "x-main");
const SHOTS = process.env.POCKET_X_SHOTS;
const GLOBALS = ["ui", "__pak", "__simHz", "frame", "link", "wifi", "camera", "net", "__pocketApp"] as const;
const saved = new Map(GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]));

beforeAll(() => {
  GUEST = buildGuest("x", OUT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}, 120_000);

afterAll(() => {
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  rmSync(OUT, { recursive: true, force: true });
});

function boot(options: Partial<Console3dsOptions> & { signedOut?: boolean; calls?: XCalls } = {}): Promise<Console3ds> {
  const { signedOut, calls, ...rest } = options;
  return bootConsole3ds({ js: `${GUEST}.js`, pak: `${GUEST}.pak`, current: "x-main", link: null, wifi: null, camera: false, net: xRoutes({ signedOut, calls }), ...rest });
}

const newCalls = (): XCalls => ({ actions: [], replies: [], glyphs: [] });

function shot(x: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = x.world.pixels("auxiliary");
  writeFileSync(join(SHOTS, `x-${name}.png`), encodePNG(rgba, width, height));
}

const started = (x: Console3ds) => x.net!.log.filter((line) => line.startsWith("start ")).map((line) => line.split(" ")[3]!);

function peakInflight(x: Console3ds): number {
  let open = 0;
  let peak = 0;
  for (const line of x.net!.log) {
    if (line.startsWith("start ")) peak = Math.max(peak, ++open);
    else if (line.startsWith("poll ")) open -= (JSON.parse(line.slice(5)) as unknown[]).length;
  }
  return peak;
}

/** Drag slowly (no fling) until `text` is on the bottom screen. */
async function scrollTo(x: Console3ds, text: string): Promise<[number, number, number, number]> {
  for (let step = 0; step < 30; step++) {
    const at = x.locate(text);
    if (at && at[1] > 40 && at[1] < 200) return at;
    await x.drag(160, 180, 160, 130, 40);
    await x.run(20);
  }
  throw new Error(`"${text}" never scrolled into view`);
}

describe("the timeline", () => {
  test("posts load from the Mac with names, handles, ages, reposts, quotes and counts", async () => {
    const x = await boot();
    await x.run(60);
    expect(started(x)[0]).toBe(`${X_SERVICE}/timeline?kind=following`);
    const bottom = x.texts("auxiliary");
    const all = bottom.join(" | ");
    for (const text of ["Following", "For You", "Ruth Kim", "@ruthk  25m", "Kestrel reposted", "Pocket Dev"]) expect(all).toContain(text);
    expect(bottom).toContain("Shipped a dual-screen reader for the");
    // The action bar: counts beside the reply, repost and like buttons.
    expect(bottom).toContain("1.2K");
    expect(bottom).toContain("3");
    expect(x.texts("primary")).toEqual([]);
    expect(peakInflight(x)).toBeLessThanOrEqual(2);
    shot(x, "timeline");
  });

  test("avatars arrive as textures; posts without one keep their initials", async () => {
    const x = await boot();
    await x.run(80);
    expect(started(x).some((url) => url.startsWith(`${X_SERVICE}/avatar?u=`))).toBe(true);
    // One request per face, however many rows show it.
    expect(started(x).filter((url) => url.startsWith(`${X_SERVICE}/avatar?u=`))).toHaveLength(1);
    expect(x.texts("auxiliary")).toContain("PD");
  });

  test("a quote and a reply line show in the row", async () => {
    const x = await boot();
    await x.run(60);
    await scrollTo(x, "Luis Moreno");
    const all = x.texts("auxiliary").join(" ");
    expect(all).toContain("Nina Baker @nbaker: Fonts are sprites.");
    await scrollTo(x, "Replying to @ruthk");
    expect(x.texts("auxiliary").join(" ")).toContain("[2 photos]");
    shot(x, "quote");
  });

  test("scrolling to the end reads the next page by its cursor", async () => {
    const x = await boot();
    await x.run(60);
    for (let swipe = 0; swipe < 10; swipe++) await x.drag(160, 220, 160, 60, 8);
    await x.run(60);
    expect(started(x)).toContain(`${X_SERVICE}/timeline?kind=following&cursor=PAGE-2`);
    expect(peakInflight(x)).toBeLessThanOrEqual(2);
  });

  test("R switches to For You, and the control does too", async () => {
    const x = await boot();
    await x.run(60);
    await x.press(BTN.RTRIGGER, 40);
    expect(started(x)).toContain(`${X_SERVICE}/timeline?kind=foryou`);
    await x.tapText("Following");
    await x.run(20);
    expect(x.texts("auxiliary").join(" ")).toContain("Ruth Kim");
  });
});

describe("text in any script", () => {
  test("Chinese names and posts draw from atlases the Mac renders, not as ?", async () => {
    const calls = newCalls();
    const x = await boot({ calls });
    await x.run(80);
    const regular = calls.glyphs.find((call) => call.slot === 21);
    const bold = calls.glyphs.find((call) => call.slot === 22);
    expect(regular).toMatchObject({ px: 13, bold: false });
    expect(regular!.text).toContain("你");
    expect(bold).toMatchObject({ px: 13, bold: true });
    expect(bold!.text).toContain("中");
    // The atlases ride the app's queue: never more than two requests at once.
    expect(peakInflight(x)).toBeLessThanOrEqual(2);
    await scrollTo(x, CJK_NAME);
    const all = x.texts("auxiliary").join(" | ");
    expect(all).toContain(CJK_NAME);
    expect(all).toContain("你好世界");
    shot(x, "cjk");
  });
});

describe("actions", () => {
  test("like shows at once and asks the Mac; tapping again unlikes", async () => {
    const calls = newCalls();
    const x = await boot({ calls });
    await x.run(80);
    await scrollTo(x, CJK_NAME);
    // This post is liked, with 12 likes.
    const like = await scrollTo(x, "12");
    await x.tap(like[0] - 10, like[1] + 4);
    await x.run(4);
    expect(x.texts("auxiliary")).toContain("11");
    await x.run(10);
    expect(calls.actions).toEqual(["unlike 1004"]);
    const again = await scrollTo(x, "11");
    await x.tap(again[0] - 10, again[1] + 4);
    await x.run(14);
    expect(x.texts("auxiliary")).toContain("12");
    expect(calls.actions).toEqual(["unlike 1004", "like 1004"]);
    shot(x, "liked");
  });

  test("a like X refuses goes back, with a notice", async () => {
    const calls = newCalls();
    const x = await boot({ calls });
    await x.run(80);
    const like = await scrollTo(x, "77");
    await x.tap(like[0] - 10, like[1] + 4);
    await x.run(20);
    expect(calls.actions).toEqual(["like 1005"]);
    expect(x.texts("auxiliary")).toContain("77");
    expect(x.texts("auxiliary").join(" ")).toContain("Could not like");
    shot(x, "refused");
  });

  test("reply opens the composer; START sends the text to the Mac", async () => {
    const calls = newCalls();
    const x = await boot({ calls });
    await x.run(80);
    await scrollTo(x, CJK_NAME);
    const like = await scrollTo(x, "12");
    // The reply button is two buttons left of like.
    await x.tap(like[0] - 10 - 128, like[1] + 4);
    await x.run(20);
    expect(x.texts("auxiliary").join(" ")).toContain("Reply to @dpadfan");
    shot(x, "compose");
    for (const key of ["h", "i"]) await x.tapText(key);
    await x.press(BTN.START, 20);
    expect(calls.replies).toEqual([{ id: "1004", text: "hi" }]);
    expect(x.texts("auxiliary").join(" ")).not.toContain("Reply to @");
    // The post counts the reply.
    expect(x.texts("auxiliary")).toContain("3");
    expect(x.texts("auxiliary").join(" ")).toContain("Reply sent");
  });
});

describe("a post", () => {
  test("tapping a post opens its thread: the post it answers, the post, the replies", async () => {
    const x = await boot();
    await x.run(60);
    await scrollTo(x, "Luis Moreno");
    await x.tapText("Luis Moreno");
    await x.run(60);
    expect(started(x)).toContain(`${X_SERVICE}/post/1002`);
    const all = x.texts("auxiliary").join(" | ");
    expect(all).toContain("Post");
    expect(all).toContain("QuickJS on an ARM11 at 268 MHz is");
    expect(all).toContain("54K views");
    shot(x, "post");
    await scrollTo(x, "Agreed, and a glyph cache is a texture");
    shot(x, "replies");
  });

  test("a reply opens its own thread, and back returns", async () => {
    const x = await boot();
    await x.run(60);
    await scrollTo(x, "Luis Moreno");
    await x.tapText("Luis Moreno");
    await x.run(60);
    const reply = await scrollTo(x, "Agreed, and a glyph cache is a texture");
    await x.tap(reply[0] + 10, reply[1] + 4);
    await x.run(60);
    expect(started(x)).toContain(`${X_SERVICE}/post/1040`);
    await x.press(BTN.CROSS, 40);
    await x.press(BTN.CROSS, 40);
    expect(x.texts("auxiliary").join(" ")).toContain("Following");
  });
});

describe("errors", () => {
  test("without an X session on the Mac the app says how to sign in", async () => {
    const x = await boot({ signedOut: true });
    await x.run(60);
    const all = x.texts("auxiliary").join(" ");
    expect(all).toContain("Not signed in to X");
    expect(all).toContain("service x login");
    expect(all).toContain("Try Again");
    shot(x, "signed-out");
  });
});

describe("on the Tab5's 592x360 surface", () => {
  test("the timeline spans the width; Reload and the control answer touch", async () => {
    const x = await boot({ auxiliary: TAB5 });
    await x.run(60);
    tab5Shot(x, "x-timeline");
    const texts = x.texts("auxiliary").join(" | ");
    for (const text of ["Following", "For You", "Reload", "Ruth Kim", "Pocket Dev"]) expect(texts).toContain(text);
    const before = started(x).length;
    await x.tapText("Reload");
    await x.run(40);
    expect(started(x).length).toBeGreaterThan(before);
    await x.tapText("For You");
    await x.run(40);
    expect(started(x)).toContain(`${X_SERVICE}/timeline?kind=foryou`);
  });

  test("a post's thread and the reply composer fill the surface; the keyboard's check key sends", async () => {
    const calls = newCalls();
    const x = await boot({ auxiliary: TAB5, calls });
    await x.run(60);
    await scrollTo(x, "Luis Moreno");
    await x.tapText("Luis Moreno");
    await x.run(60);
    expect(started(x)).toContain(`${X_SERVICE}/post/1002`);
    tab5Shot(x, "x-post");
    await x.tapText("Home");
    await x.run(30);
    await scrollTo(x, CJK_NAME);
    const like = await scrollTo(x, "12");
    await x.tap(like[0] - 10 - 128, like[1] + 4);
    await x.run(20);
    expect(x.texts("auxiliary").join(" ")).toContain("Reply to @dpadfan");
    for (const key of ["h", "i"]) await x.tapText(key);
    tab5Shot(x, "x-compose");
    await x.tapText("✓");
    await x.run(20);
    expect(calls.replies).toEqual([{ id: "1004", text: "hi" }]);
  });

  test("a portrait surface shows the timeline", async () => {
    const x = await boot({ auxiliary: PORTRAIT });
    await x.run(60);
    tab5Shot(x, "portrait-x-timeline");
    expect(x.texts("auxiliary").join(" ")).toContain("For You");
  });
});
