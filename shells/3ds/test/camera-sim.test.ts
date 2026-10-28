// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/camera-sim.test.ts — the Camera applet (shells/3ds/camera)
// headless on the wasm core with the 3DS geometry and the sim's camera
// (platforms/sim/camera.ts): the preview without QR decoding, the shutter by A,
// R and the stylus, the bar's thumbnail of the newest photo, switching to
// the inner camera, and the review with delete.
//
// POCKET_CAMERA_SHOTS=<dir> also writes bottom-screen PNGs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BTN } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import { bootConsole3ds, type Console3ds } from "../../../vendor/pocketjs/programs/sim/console-3ds.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { buildGuest } from "./build.ts";
import { PORTRAIT, TAB5, tab5Shot } from "./tab5.ts";

const OUT = mkdtempSync(join(tmpdir(), "pocket-camera-"));
let GUEST = join(OUT, "guest", "camera-main");
const SHOTS = process.env.POCKET_CAMERA_SHOTS;
const GLOBALS = ["ui", "__pak", "__simHz", "frame", "link", "wifi", "camera", "net", "agent", "__pocketApp"] as const;
const saved = new Map(GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]));

beforeAll(() => {
  GUEST = buildGuest("camera", OUT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}, 120_000);

afterAll(() => {
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  rmSync(OUT, { recursive: true, force: true });
});

async function boot(photos: string[] = [], auxiliary?: [number, number]): Promise<Console3ds> {
  const app = await bootConsole3ds({
    js: `${GUEST}.js`,
    pak: `${GUEST}.pak`,
    current: "camera-main",
    link: null,
    wifi: null,
    camera: { photos },
    agent: { available: true },
    auxiliary,
  });
  await app.run(6);
  return app;
}

function shot(app: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = app.world.pixels("auxiliary");
  writeFileSync(join(SHOTS, `camera-${name}.png`), encodePNG(rgba, width, height));
}

/** The bottom screen's pixel at (x, y) as [r, g, b]. */
function pixel(app: Console3ds, x: number, y: number): number[] {
  const { width, rgba } = app.world.pixels("auxiliary");
  const at = (y * width + x) * 4;
  return [rgba[at]!, rgba[at + 1]!, rgba[at + 2]!];
}

describe("Camera", () => {
  test("opens the outer camera without QR decoding, nothing on the top screen", async () => {
    const app = await boot();
    expect(app.camera!.log[0]).toBe("open 2");
    expect(app.camera!.inner()).toBe(false);
    expect(app.texts("primary").filter((text) => text.trim())).toEqual([]);
    // The preview fills the screen above the bar: the sim's laptop bezel.
    expect(pixel(app, 160, 36)).toEqual([186, 190, 196]);
    shot(app, "preview");
  });

  test("A, R and the shutter button each take a photo; the bar shows the newest", async () => {
    const app = await boot(["100POCKT/PKT_0003.JPG"]);
    await app.press(BTN.CIRCLE, 6);
    await app.press(BTN.RTRIGGER, 14);
    await app.tap(160, 217);
    await app.run(8);
    expect(app.camera!.photos()).toEqual(["100POCKT/PKT_0006.JPG", "100POCKT/PKT_0005.JPG", "100POCKT/PKT_0004.JPG", "100POCKT/PKT_0003.JPG"]);
    // The thumbnail in the bar is a photo, not the empty slot's near-black.
    const [r, g, b] = pixel(app, 27, 210);
    expect(r + g + b).toBeGreaterThan(150);
    shot(app, "taken");
  });

  test("X switches to the inner camera and back", async () => {
    const app = await boot();
    await app.press(BTN.TRIANGLE, 4);
    expect(app.camera!.inner()).toBe(true);
    shot(app, "inner");
    await app.press(BTN.TRIANGLE, 4);
    expect(app.camera!.inner()).toBe(false);
  });

  test("the thumbnail opens the last photo; Delete asks first, then removes it", async () => {
    const app = await boot(["100POCKT/PKT_0001.JPG", "100POCKT/PKT_0002.JPG"]);
    await app.tap(27, 217);
    await app.run(6);
    expect(app.texts("auxiliary")).toContain("Done");
    shot(app, "review");
    await app.tap(289, 217);
    await app.run(6);
    expect(app.texts("auxiliary")).toContain("Delete Photo?");
    shot(app, "delete");
    await app.tapText("Delete");
    await app.run(6);
    expect(app.camera!.photos()).toEqual(["100POCKT/PKT_0001.JPG"]);
    expect(app.texts("auxiliary")).not.toContain("Done");
  });

  test("B leaves the review without deleting", async () => {
    const app = await boot(["100POCKT/PKT_0001.JPG"]);
    await app.press(BTN.SQUARE, 6);
    expect(app.texts("auxiliary")).toContain("Done");
    await app.press(BTN.CROSS, 6);
    expect(app.texts("auxiliary")).not.toContain("Done");
    expect(app.camera!.photos()).toEqual(["100POCKT/PKT_0001.JPG"]);
  });
});

describe("on the Tab5's 592x360 surface", () => {
  // The preview is 480x360 on the left; the bar runs down the right 112 px:
  // the switch at its top, the shutter in its middle, the thumbnail below.
  test("the shutter, the switch and the thumbnail answer touch in the side bar", async () => {
    const app = await boot(["100POCKT/PKT_0003.JPG"], TAB5);
    tab5Shot(app, "camera");
    await app.tap(536, 180);
    await app.run(8);
    expect(app.camera!.photos()[0]).toBe("100POCKT/PKT_0004.JPG");
    await app.tap(536, 26);
    await app.run(4);
    expect(app.camera!.inner()).toBe(true);
    await app.tap(536, 327);
    await app.run(6);
    expect(app.texts("auxiliary")).toContain("Done");
    tab5Shot(app, "camera-review");
    await app.tap(536, 344 - 18);
    await app.run(6);
    expect(app.texts("auxiliary")).toContain("Delete Photo?");
    await app.tapText("Delete");
    await app.run(6);
    expect(app.camera!.photos()).toEqual(["100POCKT/PKT_0003.JPG"]);
  });

  test("a portrait surface puts the bar under the preview", async () => {
    const app = await boot(["100POCKT/PKT_0003.JPG"], PORTRAIT);
    tab5Shot(app, "portrait-camera");
    await app.tap(180, 592 - 23);
    await app.run(8);
    expect(app.camera!.photos()[0]).toBe("100POCKT/PKT_0004.JPG");
  });
});
