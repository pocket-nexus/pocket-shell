// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/youtube-sim.test.ts — the YouTube app headless on the wasm
// core with the 3DS geometry. The companion's youtube service is a set of
// NET routes (every https://companion.pocket/youtube/... URL), and the
// console's media worker is a fake `globalThis.media` whose status the test
// writes: the list and its sections, thumbnails, search through the system
// keyboard, the player's codec choice (and the H.264-to-PAL8 fallback),
// pause, seek, and the stop when the player closes.
//
// POCKET_YOUTUBE_SHOTS=<dir> writes bottom-screen PNGs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BTN, IMG_FLAG_LINEAR, PSM } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import { encodeImageEntry } from "../../../vendor/pocketjs/framework/compiler/pak.ts";
import { bootConsole3ds, type Console3ds } from "../../../vendor/pocketjs/programs/sim/console-3ds.ts";
import type { SimNetRequest, SimNetRoute } from "../../../vendor/pocketjs/platforms/sim/net.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { buildGuest } from "./build.ts";

const OUT = mkdtempSync(join(tmpdir(), "pocket-youtube-"));
let GUEST = join(OUT, "guest", "youtube-main");
const SHOTS = process.env.POCKET_YOUTUBE_SHOTS;
const GLOBALS = ["ui", "__pak", "__simHz", "frame", "link", "wifi", "camera", "net", "media", "__pocketApp", "__pocketYoutube"] as const;
const saved = new Map(GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]));
const SERVICE = "https://companion.pocket/youtube";

beforeAll(() => {
  GUEST = buildGuest("youtube", OUT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}, 120_000);

afterAll(() => {
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  rmSync(OUT, { recursive: true, force: true });
});

// ---- the service -------------------------------------------------------------------

const TITLES = [
  "Building a handheld from spare parts",
  "Ten minutes of rain on a tin roof",
  "How resistive touch screens work",
  "Speedrunning a 1998 platformer",
  "A tour of a tiny keyboard factory",
  "Street food in the old market",
  "The physics of a paper airplane",
  "Restoring a broken camera lens",
];

function videos(prefix: string) {
  return TITLES.map((title, index) => ({
    id: `${prefix}${String(index).padStart(11 - prefix.length, "0")}`,
    title: `${title} (${prefix})`,
    channel: `Channel ${index + 1}`,
    duration: 60 + index * 97,
    views: 1200 * (index + 1) ** 3,
  }));
}

const THUMB = encodeImageEntry(
  { width: 128, height: 64, rgba: new Uint8Array(128 * 64 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)) },
  PSM.PSM_5650,
  IMG_FLAG_LINEAR,
);

interface Service {
  routes: Readonly<Record<string, SimNetRoute>>;
  requests: string[];
  plays: URLSearchParams[];
}

function service(): Service {
  const requests: string[] = [];
  const plays: URLSearchParams[] = [];
  const json = (value: unknown) => ({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  const answer = (request: SimNetRequest) => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/youtube/, "");
    requests.push(path + url.search);
    switch (path) {
      case "/feed":
        return json({ items: videos(url.searchParams.get("topic") ?? "tech") });
      case "/search":
        return json({ items: videos(`q${(url.searchParams.get("q") ?? "").replace(/\W/g, "")}`) });
      case "/thumb":
        return { status: 200, headers: { "content-type": "application/x-pocket-img" }, body: THUMB };
      case "/play": {
        plays.push(url.searchParams);
        const pal8 = url.searchParams.get("codec") === "pal8";
        return json({
          source: { host: "192.168.8.2", port: 9000, token: "a".repeat(64) },
          codec: pal8 ? "pal8" : "h264",
          fps: pal8 ? 12 : 30,
          frameW: pal8 ? 240 : 512,
          frameH: pal8 ? 136 : 256,
          durationS: 300,
          position: Number(url.searchParams.get("at") ?? 0),
          title: "Building a handheld from spare parts",
        });
      }
      case "/stop":
        return json({ stopped: true });
      default:
        return { status: 404, body: "{}" };
    }
  };
  const routes = new Proxy({} as Record<string, SimNetRoute>, {
    get: (_, key) => (typeof key === "string" && key.startsWith(SERVICE) ? answer : undefined),
  });
  return { routes, requests, plays };
}

// ---- the media worker --------------------------------------------------------------

interface FakeMedia {
  h264: boolean;
  audio: boolean;
  phase: string;
  positionMs: number;
  error: string;
  opened: string[];
  closes: number;
  paused: boolean[];
  volumes: number[];
}

function installMedia(h264: boolean): FakeMedia {
  const fake: FakeMedia = { h264, audio: true, phase: "idle", positionMs: 0, error: "", opened: [], closes: 0, paused: [], volumes: [] };
  (globalThis as Record<string, unknown>).media = {
    open: (host: string, port: number, token: string) => {
      fake.opened.push(`${host}:${port}:${token.length}`);
      fake.phase = "buffering";
      fake.error = "";
      return true;
    },
    close: () => {
      fake.closes++;
      fake.phase = "idle";
    },
    paused: (value: boolean) => fake.paused.push(value),
    volume: (value: number) => fake.volumes.push(value),
    texture: () => 3,
    status: () =>
      JSON.stringify({
        phase: fake.phase, positionMs: fake.positionMs, bufferedMs: 500, decodedFrames: 0, presentedFrames: 0, droppedFrames: 0,
        receivedBytes: 0, decodeMaxUs: 0, audioUnderruns: 0, hardware: fake.h264, h264: fake.h264, audio: fake.audio, error: fake.error,
      }),
  };
  return fake;
}

async function boot(): Promise<{ app: Console3ds; svc: Service }> {
  const svc = service();
  const app = await bootConsole3ds({ js: `${GUEST}.js`, pak: `${GUEST}.pak`, current: "youtube-main", link: null, wifi: null, camera: false, net: svc.routes });
  await app.run(40);
  return { app, svc };
}

function shot(app: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = app.world.pixels("auxiliary");
  writeFileSync(join(SHOTS, `youtube-${name}.png`), encodePNG(rgba, width, height));
}

const peakInflight = (app: Console3ds) => {
  let open = 0, peak = 0;
  for (const line of app.net!.log) {
    if (line.startsWith("start ")) peak = Math.max(peak, ++open);
    else if (line.startsWith("poll ")) open -= (JSON.parse(line.slice(5)) as unknown[]).length;
  }
  return peak;
};

/** Tap the list's row `index` (rows are 64 px under the 36 px bar). */
const tapRow = (app: Console3ds, index: number) => app.tap(200, 36 + index * 64 + 32);

const probe = () => (globalThis as { __pocketYoutube?: { codec: string; phase: string; positionS: number } }).__pocketYoutube;

describe("the list", () => {
  test("Tech loads first with a thumbnail per row, two requests at a time, nothing on the top screen", async () => {
    const { app, svc } = await boot();
    expect(svc.requests[0]).toBe("/feed?topic=tech");
    const texts = app.texts("auxiliary").join("\n");
    expect(texts).toContain("Building a handheld from\nspare parts (tech)");
    expect(texts).toContain("Channel 1");
    expect(texts).toContain("1:00");
    expect(svc.requests.filter((r) => r.startsWith("/thumb")).length).toBeGreaterThanOrEqual(3);
    expect(peakInflight(app)).toBeLessThanOrEqual(2);
    expect(app.texts("primary").join("")).toBe("");
    shot(app, "list");
  });

  test("R moves to the next topic and L back; each keeps its list", async () => {
    const { app, svc } = await boot();
    await app.press(BTN.RTRIGGER, 20);
    expect(svc.requests).toContain("/feed?topic=music");
    expect(app.texts("auxiliary").join("\n")).toContain("(music)");
    await app.press(BTN.LTRIGGER, 20);
    expect(app.texts("auxiliary").join("\n")).toContain("(tech)");
    expect(svc.requests.filter((r) => r === "/feed?topic=tech")).toHaveLength(1);
  });

  test("Search opens the keyboard; START searches the typed words", async () => {
    const { app, svc } = await boot();
    await app.tapText("Search");
    await app.run(20);
    for (const key of ["c", "a", "t", "s"]) await app.tapText(key);
    shot(app, "search-keyboard");
    await app.press(BTN.START, 20);
    expect(svc.requests).toContain("/search?q=cats");
    expect(app.texts("auxiliary").join("\n")).toContain("(qcats)");
    shot(app, "search");
  });
});

describe("the player", () => {
  test("an Old 3DS asks for PAL8, shows the picture's clock, pauses with A and seeks with the d-pad", async () => {
    const { app, svc } = await boot();
    const media = installMedia(false);
    await tapRow(app, 0);
    await app.run(40);
    expect(svc.plays[0]?.get("codec")).toBe("pal8");
    expect(svc.plays[0]?.get("at")).toBe("0");
    expect(media.opened).toEqual(["192.168.8.2:9000:64"]);
    media.phase = "playing";
    media.positionMs = 65_000;
    await app.run(20);
    expect(app.texts("auxiliary").join(" ")).toContain("1:05 / 5:00");
    expect(probe()?.codec).toBe("pal8");
    shot(app, "player");
    await app.press(BTN.CIRCLE, 6);
    expect(media.paused.at(-1)).toBe(true);
    expect(probe()?.phase).toBe("paused");
    await app.press(BTN.CIRCLE, 6);
    expect(media.paused.at(-1)).toBe(false);
    await app.press(BTN.RIGHT, 20);
    expect(svc.plays.at(-1)?.get("at")).toBe("75");
    await app.press(BTN.UP, 4);
    expect(media.volumes.at(-1)).toBe(0.9);
  });

  test("a New 3DS asks for H.264; a decoder failure falls back to PAL8 at the same place", async () => {
    const { app, svc } = await boot();
    const media = installMedia(true);
    await tapRow(app, 1);
    await app.run(40);
    expect(svc.plays[0]?.get("codec")).toBe("h264");
    media.phase = "playing";
    media.positionMs = 12_000;
    await app.run(12);
    media.phase = "error";
    media.error = "H.264 hardware decoder unavailable (0xd8e5c3ff)";
    await app.run(40);
    expect(svc.plays.at(-1)?.get("codec")).toBe("pal8");
    expect(svc.plays.at(-1)?.get("at")).toBe("12");
    expect(media.opened).toHaveLength(2);
  });

  test("a console that cannot start its sound plays muted and says how to fix it", async () => {
    const { app } = await boot();
    const media = installMedia(false);
    await tapRow(app, 0);
    await app.run(30);
    media.phase = "playing";
    media.audio = false;
    await app.run(12);
    const texts = app.texts("auxiliary").join(" ");
    expect(texts).toContain("Sound needs the 3DS sound firmware");
    expect(texts).toContain("Dump DSP firmware");
    shot(app, "muted");
  });

  test("B closes the player: the media worker closes and the Mac stops the stream", async () => {
    const { app, svc } = await boot();
    const media = installMedia(false);
    await tapRow(app, 2);
    await app.run(40);
    const closes = media.closes;
    await app.press(BTN.CROSS, 40);
    expect(media.closes).toBeGreaterThan(closes);
    expect(svc.requests.at(-1)).toBe("/stop");
    expect(app.texts("auxiliary").join("\n")).toContain("(tech)");
  });
});
