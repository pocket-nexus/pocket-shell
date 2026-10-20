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
import { bootConsole3ds, type Console3ds, type Console3dsOptions } from "../../../vendor/pocketjs/hosts/sim/console-3ds.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { buildGuest } from "./build.ts";
import { X_SERVICE, xRoutes } from "./x-fixture.ts";

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

function boot(options: Partial<Console3dsOptions> & { signedOut?: boolean } = {}): Promise<Console3ds> {
  const { signedOut, ...rest } = options;
  return bootConsole3ds({ js: `${GUEST}.js`, pak: `${GUEST}.pak`, current: "x-main", link: null, wifi: null, camera: false, net: xRoutes({ signedOut }), ...rest });
}

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
    expect(all).toContain("0 replies   0 reposts   1.2K likes");
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
