// SPDX-License-Identifier: GPL-3.0-or-later
// Maps in the simulator on the Tab5's 592x360 surface: the companion's maps
// and store services are NET routes (every https://companion.pocket/maps/...
// and /store/... URL), a tile is a 256x256 RGB565 IMG entry. Zooming with the
// buttons and with two fingers must keep the app running and the tiles
// drawn, however fast the levels change.
//
// POCKET_MAPS_SHOTS=<dir> writes PNGs of the map.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IMG_FLAG_LINEAR, PSM } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import { encodeImageEntry } from "../../../vendor/pocketjs/framework/compiler/pak.ts";
import { bootConsole3ds, type Console3ds } from "../../../vendor/pocketjs/programs/sim/console-3ds.ts";
import type { SimNetRequest, SimNetRoute } from "../../../vendor/pocketjs/platforms/sim/net.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { TAB5 } from "./tab5.ts";
import { buildGuest } from "./build.ts";

const OUT = mkdtempSync(join(tmpdir(), "pocket-maps-"));
const SHOTS = process.env.POCKET_MAPS_SHOTS;
const GLOBALS = ["ui", "__pak", "__simHz", "frame", "link", "wifi", "camera", "net", "media", "__pocketApp"] as const;
const saved = new Map(GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]));
let GUEST = "";

beforeAll(() => {
  GUEST = buildGuest("maps", OUT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}, 120_000);

afterAll(() => {
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  rmSync(OUT, { recursive: true, force: true });
});

/** A tile whose level shows in its hue, with a grid and a dark edge, so a
 *  frame tells which level drew each place and where the tiles meet. */
const tiles = new Map<string, Uint8Array>();
function tile(z: number, x: number, y: number): Uint8Array {
  const key = `${z}/${x}/${y}`;
  const found = tiles.get(key);
  if (found) return found;
  const rgba = new Uint8Array(256 * 256 * 4);
  const hue = [[90, 150, 230], [230, 130, 90], [100, 200, 120], [200, 110, 210]][z % 4]!;
  for (let py = 0; py < 256; py++) {
    for (let px = 0; px < 256; px++) {
      const o = (py * 256 + px) * 4;
      const line = px % 32 === 0 || py % 32 === 0;
      const edge = px === 0 || py === 0;
      const k = edge ? 0.2 : line ? 0.65 : 1;
      rgba[o] = hue[0]! * k; rgba[o + 1] = hue[1]! * k; rgba[o + 2] = hue[2]! * k; rgba[o + 3] = 255;
    }
  }
  const entry = encodeImageEntry({ width: 256, height: 256, rgba }, PSM.PSM_5650, IMG_FLAG_LINEAR);
  tiles.set(key, entry);
  return entry;
}

interface Service {
  routes: Readonly<Record<string, SimNetRoute>>;
  asked: string[];
}

function service(): Service {
  const asked: string[] = [];
  const json = (value: unknown) => ({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
  const answer = (request: SimNetRequest) => {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/store/get":
        return json({ value: { lat: 35.6895, lon: 139.6917, zoom: 11 } });
      case "/store/set":
        return json({ ok: true });
      case "/maps/locate":
        return json({ lat: 35.6895, lon: 139.6917, city: "Tokyo" });
      case "/maps/geocode":
        return json({ items: [] });
      case "/maps/tile":
        asked.push(`${url.searchParams.get("z")}/${url.searchParams.get("x")}/${url.searchParams.get("y")}`);
        return { status: 200, headers: { "content-type": "application/x-pocket-img" }, body: tile(Number(url.searchParams.get("z")), Number(url.searchParams.get("x")), Number(url.searchParams.get("y"))) };
      default:
        return { status: 404, body: "{}" };
    }
  };
  const routes = new Proxy({} as Record<string, SimNetRoute>, {
    get: (_, key) => (typeof key === "string" && key.startsWith("https://companion.pocket/") ? answer : undefined),
  });
  return { routes, asked };
}

async function boot(): Promise<{ app: Console3ds; svc: Service }> {
  const svc = service();
  const app = await bootConsole3ds({ js: `${GUEST}.js`, pak: `${GUEST}.pak`, current: "maps-main", link: null, wifi: null, camera: false, net: svc.routes, auxiliary: TAB5 });
  await app.run(60);
  return { app, svc };
}

function shot(app: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = app.world.pixels("auxiliary");
  writeFileSync(join(SHOTS, `maps-${name}.png`), encodePNG(rgba, width, height));
}

/** Two fingers about the map's middle, from `from` px apart to `to` over `frames`. */
async function pinch(app: Console3ds, from: number, to: number, frames = 12): Promise<void> {
  const cx = 280, cy = 200;
  for (let frame = 0; frame <= frames; frame++) {
    const half = (from + (to - from) * (frame / frames)) / 2;
    await app.step({ touches: [{ id: 1, x: cx - half, y: cy }, { id: 2, x: cx + half, y: cy }], surface: "auxiliary" });
  }
  await app.step({ touches: [], surface: "auxiliary" });
}

const zoomLabel = (app: Console3ds) => app.texts("auxiliary").find((text) => / z\d+$/.test(text)) ?? "";

/** A pinch as real fingers make one: the first lands and drifts for frames
 *  before the second lands, then one lifts before the other. */
async function staggeredPinch(app: Console3ds, from: number, to: number): Promise<void> {
  const cx = 280, cy = 200;
  const touch = (touches: { id: number; x: number; y: number }[]) => app.step({ touches, surface: "auxiliary" });
  for (let frame = 0; frame < 4; frame++) await touch([{ id: 0, x: cx - from / 2, y: cy + frame }]);
  for (let frame = 0; frame <= 12; frame++) {
    const half = (from + (to - from) * (frame / 12)) / 2;
    await touch([{ id: 0, x: cx - half, y: cy + 4 }, { id: 1, x: cx + half, y: cy + 4 }]);
  }
  for (let frame = 0; frame < 4; frame++) await touch([{ id: 1, x: cx + to / 2 + frame, y: cy + 4 }]);
  await app.step({ touches: [], surface: "auxiliary" });
}

describe("Maps on the Tab5", () => {
  test("the saved view opens with its tiles", async () => {
    const { app, svc } = await boot();
    expect(zoomLabel(app)).toMatch(/z11$/);
    expect(svc.asked.some((key) => key.startsWith("11/"))).toBe(true);
    shot(app, "open");
  });

  test("a pinch through levels keeps the map on screen: no frame shows bare placeholder, and no new level is asked for on the way", async () => {
    const { app, svc } = await boot();
    await app.run(120);
    const asked = svc.asked.length;
    const cx = 296, cy = 36 + 158;
    const bare: number[] = [];
    const shots = [0, 4, 8, 12, 16, 20];
    const FRAMES = 20;
    for (let frame = 0; frame <= FRAMES; frame++) {
      const half = (50 * 2 ** ((frame / FRAMES) * 2.2)) / 2; // 2.2 levels of span in under a second
      await app.step({ touches: [{ id: 1, x: cx - half, y: cy }, { id: 2, x: cx + half, y: cy }], surface: "auxiliary" });
      const { width, rgba } = app.world.pixels("auxiliary");
      const o = (cy * width + cx) * 4;
      if (rgba[o] === 0xe8 && rgba[o + 1] === 0xe4 && rgba[o + 2] === 0xdc) bare.push(frame);
      if (shots.includes(frame)) shot(app, `through-${frame}`);
    }
    expect(bare).toEqual([]);
    expect(svc.asked.length - asked).toBeLessThanOrEqual(4); // what was already on its way
    await app.step({ touches: [], surface: "auxiliary" });
    await app.run(90);
    expect(zoomLabel(app)).toMatch(/z13$/);
    expect(svc.asked.some((key) => key.startsWith("13/"))).toBe(true);
    expect(svc.asked.some((key) => key.startsWith("12/"))).toBe(false);
    shot(app, "through-rest");
  });

  test("the zoom buttons step through the levels while tiles arrive", async () => {
    const { app } = await boot();
    for (let index = 0; index < 6; index++) {
      await app.tap(592 - 8 - 16, 44 + 8 + 16);
      await app.run(2);
    }
    await app.run(60);
    expect(zoomLabel(app)).toMatch(/z17$/);
    for (let index = 0; index < 12; index++) {
      await app.tap(592 - 8 - 16, 44 + 8 + 32 + 6 + 16);
      await app.run(1);
    }
    await app.run(90);
    expect(zoomLabel(app)).toMatch(/z5$/);
    shot(app, "buttons");
  });

  test("fingers that land and lift apart zoom too, and the finger left behind does not throw the map", async () => {
    const { app } = await boot();
    await app.run(30);
    const before = app.texts("auxiliary").join("|");
    expect(before).toContain("z11");
    await staggeredPinch(app, 80, 300);
    await app.run(30);
    const zoomed = Number(zoomLabel(app).match(/z(\d+)$/)?.[1]);
    expect(zoomed).toBeGreaterThan(11);
    await staggeredPinch(app, 300, 60);
    await app.run(60);
    expect(Number(zoomLabel(app).match(/z(\d+)$/)?.[1])).toBeLessThan(zoomed);
    shot(app, "staggered");
  });

  test("two fingers spreading and squeezing zoom in and out", async () => {
    const { app } = await boot();
    await pinch(app, 80, 300);
    await app.run(30);
    const zoomed = Number(zoomLabel(app).match(/z(\d+)$/)?.[1]);
    expect(zoomed).toBeGreaterThan(11);
    await pinch(app, 300, 60);
    await app.run(30);
    expect(Number(zoomLabel(app).match(/z(\d+)$/)?.[1])).toBeLessThan(zoomed);
    for (let round = 0; round < 4; round++) {
      await pinch(app, 60, 320, 6);
      await pinch(app, 320, 60, 6);
    }
    await app.run(120);
    shot(app, "pinch");
  });
});
