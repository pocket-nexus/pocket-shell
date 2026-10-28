// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/photos-sim.test.ts — the Photos applet (shells/3ds/photos)
// headless on the wasm core with the 3DS geometry and the sim's camera
// storage (platforms/sim/camera.ts): the Camera Roll grid newest first with its
// count, thumbnails asked for near the visible rows only, a photo full
// screen swiped and stepped through, and delete with a confirmation.
//
// POCKET_PHOTOS_SHOTS=<dir> also writes bottom-screen PNGs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BTN } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import { bootConsole3ds, type Console3ds } from "../../../vendor/pocketjs/programs/sim/console-3ds.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { buildGuest } from "./build.ts";
import { PORTRAIT, TAB5, tab5Shot } from "./tab5.ts";

const OUT = mkdtempSync(join(tmpdir(), "pocket-photos-"));
let GUEST = join(OUT, "guest", "photos-main");
const SHOTS = process.env.POCKET_PHOTOS_SHOTS;
const GLOBALS = ["ui", "__pak", "__simHz", "frame", "link", "wifi", "camera", "net", "agent", "__pocketApp"] as const;
const saved = new Map(GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]));

/** 30 photos: 26 of Camera's and 4 of the console's own camera application. */
const LIBRARY = [
  ...Array.from({ length: 26 }, (_, i) => `100POCKT/PKT_${String(i + 1).padStart(4, "0")}.JPG`),
  ...Array.from({ length: 4 }, (_, i) => `100NIN03/HNI_${String(i + 1).padStart(4, "0")}.JPG`),
];

beforeAll(() => {
  GUEST = buildGuest("photos", OUT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}, 120_000);

afterAll(() => {
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  rmSync(OUT, { recursive: true, force: true });
});

async function boot(photos: string[] = LIBRARY, auxiliary?: [number, number]): Promise<Console3ds> {
  const app = await bootConsole3ds({
    js: `${GUEST}.js`,
    pak: `${GUEST}.pak`,
    current: "photos-main",
    link: null,
    wifi: null,
    camera: { photos },
    agent: { available: true },
    auxiliary,
  });
  await app.run(10);
  return app;
}

function shot(app: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = app.world.pixels("auxiliary");
  writeFileSync(join(SHOTS, `photos-${name}.png`), encodePNG(rgba, width, height));
}

const loads = (app: Console3ds) => app.camera!.log.filter((line) => line.startsWith("load"));

describe("Photos", () => {
  test("the Camera Roll lists every photo newest first and asks only for the thumbnails near the screen", async () => {
    const app = await boot();
    const texts = app.texts("auxiliary");
    expect(texts).toContain("Camera Roll");
    expect(app.texts("primary").filter((text) => text.trim())).toEqual([]);
    // Thumbnails asked for: the visible rows and two beyond, not all 30.
    const thumbs = loads(app).filter((line) => line.startsWith("load 0 "));
    expect(thumbs.length).toBeGreaterThanOrEqual(12);
    expect(thumbs.length).toBeLessThan(30);
    expect(thumbs[0]).toBe("load 0 100POCKT/PKT_0026.JPG");
    shot(app, "grid");
    // Scrolling to the end reaches the count line under the grid.
    for (let swipe = 0; swipe < 8 && !app.texts("auxiliary").includes("30 Photos"); swipe++) await app.drag(160, 220, 160, 60, 10);
    await app.run(30);
    expect(app.texts("auxiliary")).toContain("30 Photos");
    shot(app, "grid-end");
  });

  test("a tapped thumbnail opens full screen; a swipe and the d-pad step through the photos", async () => {
    const app = await boot();
    await app.tap(40, 80);
    await app.run(40);
    expect(app.texts("auxiliary")).toContain("1 of 30");
    shot(app, "photo");
    await app.drag(260, 140, 60, 140, 10);
    await app.run(20);
    expect(app.texts("auxiliary")).toContain("2 of 30");
    await app.press(BTN.RIGHT, 20);
    expect(app.texts("auxiliary")).toContain("3 of 30");
    await app.press(BTN.LEFT, 20);
    expect(app.texts("auxiliary")).toContain("2 of 30");
    await app.press(BTN.CROSS, 30);
    expect(app.texts("auxiliary")).toContain("Camera Roll");
  });

  test("Delete asks first; confirming removes the photo and shows the next one", async () => {
    const app = await boot(LIBRARY.slice(0, 3));
    await app.tap(40, 80);
    await app.run(40);
    expect(app.texts("auxiliary")).toContain("1 of 3");
    await app.tapText("Delete");
    await app.run(6);
    expect(app.texts("auxiliary")).toContain("Delete Photo?");
    shot(app, "delete");
    await app.tapText("Delete");
    await app.run(20);
    expect(app.camera!.photos()).toEqual(["100POCKT/PKT_0002.JPG", "100POCKT/PKT_0001.JPG"]);
    expect(app.texts("auxiliary")).toContain("1 of 2");
  });

  test("an empty roll says so", async () => {
    const app = await boot([]);
    expect(app.texts("auxiliary")).toContain("No Photos");
    shot(app, "empty");
  });
});

describe("on the Tab5's 592x360 surface", () => {
  test("seven columns of thumbnails; a photo fills the space under the bar and swipes; Back returns", async () => {
    const app = await boot(LIBRARY, TAB5);
    await app.run(30);
    tab5Shot(app, "photos-grid");
    expect(app.texts("auxiliary")).toEqual(expect.arrayContaining(["Camera Roll", "Reload"]));
    // The seventh thumbnail of the first row: 16 px margin, 80 px cells.
    await app.tap(16 + 6 * 80 + 40, 80);
    await app.run(40);
    expect(app.texts("auxiliary")).toContain("7 of 30");
    tab5Shot(app, "photos-photo");
    await app.drag(420, 200, 120, 200, 10);
    await app.run(20);
    expect(app.texts("auxiliary")).toContain("8 of 30");
    await app.tapText("Camera Roll");
    await app.run(30);
    expect(app.texts("auxiliary")).toContain("Reload");
  });

  test("a portrait surface keeps four columns", async () => {
    const app = await boot(LIBRARY, PORTRAIT);
    await app.run(30);
    tab5Shot(app, "portrait-photos-grid");
    expect(app.texts("auxiliary")).toContain("Camera Roll");
  });
});
