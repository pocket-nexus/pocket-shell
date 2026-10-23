// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/home-sim.test.ts — Pocket Home (apps/home) headless on the wasm core
// with the 3DS geometry, the 3DS app table and the Pocket Link, Wi-Fi and
// camera fakes (hosts/sim/console-3ds.ts). Each journey drives the stylus and
// the buttons and checks what the touch screen shows and what the host was
// asked. Home draws nothing on the top screen: it belongs to the system.
//
// POCKET_HOME_SHOTS=<dir> also writes top/bottom PNGs of each main screen.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BTN } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import type { LinkCatalogApp } from "../../../vendor/pocketjs/contracts/spec/link.ts";
import { bootConsole3ds, type Console3ds, type Console3dsOptions } from "../../../vendor/pocketjs/hosts/sim/console-3ds.ts";
import { createSimFsHost } from "../../../vendor/pocketjs/hosts/sim/fs.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { buildGuest } from "./build.ts";

const OUT = mkdtempSync(join(tmpdir(), "pocket-home-"));
let GUEST = join(OUT, "guest", "home-main");
const SHOTS = process.env.POCKET_HOME_SHOTS;
const GLOBALS = ["ui", "__pak", "__simHz", "frame", "link", "wifi", "camera", "net", "agent", "fs", "__pocketApp"] as const;
const saved = new Map(GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]));

const MAC = { id: "a1b2c3d4e5f60718", name: "Evan's MacBook Pro", address: "192.168.8.120", port: 8628 };
const PAIRING_URI = "pocketlink://pair?v=1&c=a1b2c3d4e5f60718&h=192.168.8.120&p=8628&s=00112233445566778899aabbccddeeff&n=Evan%27s%20MacBook%20Pro";
const APPS = [
  { output: "hn-main", id: "dev.pocket-nexus.hn", title: "Hacker News", version: "0.1.0", bytes: 61_440 },
  { output: "nexus-main", id: "dev.pocket-nexus.nexus", title: "Pocket Nexus", version: "0.1.0", bytes: 1_240_000 },
  { output: "pocket3ds-demo-main", id: "dev.pocket-nexus.3ds-demo", title: "Contacts", version: "0.1.0", bytes: 212_000 },
];
const CATALOG: LinkCatalogApp[] = [
  { id: "dev.pocket-nexus.hn", title: "Hacker News", version: "0.1.0", output: "hn-main", hash: "0123456789abcdef", bytes: 61_440, summary: "Top stories and threads, read on two screens." },
  { id: "dev.pocket-nexus.nexus", title: "Pocket Nexus", version: "0.2.0", output: "nexus-main", hash: "1123456789abcdef", bytes: 1_310_000, summary: "The pocket.nexus homepage with physics toys." },
  { id: "dev.pocket-nexus.weather", title: "Weather", version: "1.0.0", output: "weather-main", hash: "2123456789abcdef", bytes: 96_000, summary: "Forecasts for your saved cities." },
];

beforeAll(() => {
  GUEST = buildGuest("home", OUT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}, 120_000);

afterAll(() => {
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  rmSync(OUT, { recursive: true, force: true });
});

/** Home booted, with its board's 300 ms arrival zoom run out. */
async function boot(options: Partial<Console3dsOptions> = {}): Promise<Console3ds> {
  const home = await bootConsole3ds({
    js: `${GUEST}.js`,
    pak: `${GUEST}.pak`,
    apps: APPS,
    link: { paired: [MAC], linked: MAC.id, catalog: CATALOG },
    wifi: { saved: ["PocketNet", "Studio 5G", ""], connected: 0 },
    ...options,
  });
  await home.run(20);
  return home;
}

function shot(console3ds: Console3ds, name: string): void {
  if (!SHOTS) return;
  for (const surface of ["primary", "auxiliary"] as const) {
    const { width, height, rgba } = console3ds.world.pixels(surface);
    writeFileSync(join(SHOTS, `home-${name}-${surface === "primary" ? "top" : "bottom"}.png`), encodePNG(rgba, width, height));
  }
}

/** Close the open app (Settings or the store) back to the springboard. */
async function closeApp(console3ds: Console3ds): Promise<void> {
  await console3ds.press(BTN.START);
  await console3ds.run(24);
}

/** Open Settings from the dock and let the zoom finish. */
async function openSettings(console3ds: Console3ds): Promise<void> {
  await console3ds.tapText("Settings");
  await console3ds.run(24);
}

describe("springboard", () => {
  test("installed applets fill the grid under the status bar, the dock holds Settings and Mac", async () => {
    const home = await boot();
    await home.run(30);
    shot(home, "springboard");
    const bottom = home.texts("auxiliary");
    // Labels span the 80 px cell with tightened letters, so the two longest
    // names fit whole; a longer one still ends in "...".
    for (const label of ["Hacker News", "Pocket Nexus", "Contacts", "Settings", "Mac"]) expect(bottom).toContain(label);
    // The status bar: the carrier on the left, 01:41 UTC in the linked
    // Mac's zone (UTC+8) on the right, no device name, the centre free.
    expect(bottom).toContain("Pocket");
    expect(bottom).toContain("9:41 AM");
    expect(bottom.some((text) => text.includes("MacBoo"))).toBe(false);
    const clock = home.locate("9:41 AM")!;
    expect(clock[0] + clock[2]).toBeGreaterThan(300);
    expect(clock[0]).toBeGreaterThan(196);
    expect(home.texts("primary")).toEqual([]);
  });

  test("tapping an icon zooms and asks the host to launch it", async () => {
    const home = await boot();
    await home.run(10);
    await home.tapText("Contacts");
    await home.run(30);
    expect(home.launches).toEqual(["pocket3ds-demo-main"]);
  });

  test("the d-pad walks the grid with a focus ring and A launches", async () => {
    const home = await boot();
    await home.run(10);
    await home.press(BTN.RIGHT); // first press: focus the first icon
    await home.press(BTN.RIGHT);
    await home.run(2);
    await home.press(BTN.CIRCLE);
    await home.run(30);
    expect(home.launches).toEqual(["nexus-main"]);
  });

  test("edit mode deletes an app through removeApp after the alert", async () => {
    const home = await boot();
    await home.run(10);
    await home.press(BTN.SQUARE);
    await home.run(6);
    // The badge sits on the first icon's top-left corner.
    await home.tap(18, 28);
    await home.run(4);
    expect(home.texts("auxiliary")).toContain('Delete "Hacker News"?');
    shot(home, "delete-alert");
    await home.tapText("Delete");
    await home.run(6);
    expect(home.link!.log).toContain("remove dev.pocket-nexus.hn");
    expect(home.apps.map((app) => app.id)).not.toContain("dev.pocket-nexus.hn");
    expect(home.texts("auxiliary")).not.toContain("Hacker News");
  });

  test("a banner names the app the host interrupted; SELECT goes back to it", async () => {
    const home = await boot({ resume: "hn-main" });
    await home.run(10);
    expect(home.texts("auxiliary")).toContain("Tap here or press SELECT to go back to it.");
    shot(home, "banner");
    await home.press(BTN.SELECT);
    expect(home.launches).toEqual(["hn-main"]);
  });

  test("tapping the banner goes back to the interrupted app; it slides away by itself", async () => {
    const home = await boot({ resume: "hn-main" });
    await home.run(10);
    await home.tap(160, 18);
    expect(home.launches).toEqual(["hn-main"]);
    const later = await boot({ resume: "hn-main" });
    await later.run(7 * 60);
    expect(later.texts("auxiliary")).not.toContain("Tap here or press SELECT to go back to it.");
    expect(later.texts("auxiliary")).toContain("9:41 AM");
  });

  test("an app that stopped with an error is announced by the banner", async () => {
    const home = await boot({ lastError: { output: "nexus-main", message: "ReferenceError: frame is not defined" } });
    await home.run(10);
    const bottom = home.texts("auxiliary");
    expect(bottom).toContain("Pocket Nexus stopped");
    expect(bottom).toContain("ReferenceError: frame is not defined");
    await home.tap(160, 18);
    await home.run(20);
    expect(home.launches).toEqual([]);
    expect(home.texts("auxiliary")).not.toContain("Pocket Nexus stopped");
  });
});

describe("springboard pages", () => {
  // Eleven apps: eight on the first page, three on the second.
  const MANY = Array.from({ length: 11 }, (_, index) => ({
    output: `app${index + 1}-main`,
    id: `dev.example.app${index + 1}`,
    title: `App ${index + 1}`,
    version: "1.0.0",
    bytes: 40_000,
  }));
  const bootMany = () => boot({ apps: MANY });
  // Measured on the second column: a label cut by the screen edge reports its clipped box.
  const x = (home: Console3ds, title: string) => home.locate(title)?.[0] ?? null;
  /** The brightness of page dot `index` of `count` (springboard DOTS_Y). */
  const dot = (home: Console3ds, index: number, count: number) => {
    const { width, rgba } = home.world.pixels("auxiliary");
    const at = (168 + 3) * width + 160 - count * 6 + index * 12 + 3;
    return rgba[at * 4]!;
  };
  /** Hold the stylus along a straight line, without lifting it. */
  const hold = async (home: Console3ds, x0: number, x1: number, frames: number) => {
    for (let frame = 0; frame <= frames; frame++) {
      await home.step({ touches: [{ x: x0 + ((x1 - x0) * frame) / frames, y: 80 }], surface: "auxiliary" });
    }
  };

  test("the row follows the finger, a slow short drag settles back, a flick turns the page", async () => {
    const home = await bootMany();
    await home.run(20);
    expect(x(home, "App 1")).not.toBeNull();
    expect(x(home, "App 9")).toBeNull();
    expect(dot(home, 0, 2)).toBeGreaterThan(dot(home, 1, 2) + 60);
    const start = x(home, "App 2")!;
    await hold(home, 250, 150, 40);
    expect(x(home, "App 2")! - start).toBeGreaterThan(-104);
    expect(x(home, "App 2")! - start).toBeLessThanOrEqual(-80);
    shot(home, "page-drag");
    await home.run(30);
    expect(x(home, "App 2")).toBe(start);
    await home.drag(250, 80, 190, 80, 3);
    await home.run(30);
    expect(x(home, "App 1")).toBeNull();
    expect(x(home, "App 10")).toBe(start);
    expect(dot(home, 1, 2)).toBeGreaterThan(dot(home, 0, 2) + 60);
    shot(home, "page-2");
    await home.tapText("App 9");
    await home.run(30);
    expect(home.launches).toEqual(["app9-main"]);
  });

  test("a slow drag past half a page turns it; past the last page the row resists", async () => {
    const home = await bootMany();
    await home.run(20);
    const start = x(home, "App 2")!;
    await home.drag(300, 80, 100, 80, 60);
    await home.run(30);
    expect(x(home, "App 10")).toBe(start);
    // 160 px past the last page moves the row 69 px (the rubber band).
    await hold(home, 260, 100, 40);
    const pulled = x(home, "App 10")! - start;
    expect(pulled).toBeLessThan(-60);
    expect(pulled).toBeGreaterThan(-75);
    await home.run(30);
    expect(x(home, "App 10")).toBe(start);
    // And past the first page the same way.
    await home.drag(60, 80, 300, 80, 4);
    await home.run(30);
    expect(x(home, "App 2")).toBe(start);
    await hold(home, 60, 220, 40);
    expect(x(home, "App 2")! - start).toBeGreaterThan(60);
    expect(x(home, "App 2")! - start).toBeLessThan(75);
    await home.run(30);
    expect(x(home, "App 2")).toBe(start);
  });

  test("the d-pad pages at the grid's edges", async () => {
    const home = await bootMany();
    await home.run(20);
    await home.press(BTN.RIGHT); // focus App 1
    for (let step = 0; step < 4; step++) await home.press(BTN.RIGHT);
    await home.run(30);
    expect(x(home, "App 9")).not.toBeNull();
    expect(x(home, "App 1")).toBeNull();
    await home.press(BTN.LEFT);
    await home.run(30);
    expect(x(home, "App 1")).not.toBeNull();
    await home.press(BTN.CIRCLE);
    await home.run(30);
    expect(home.launches).toEqual(["app8-main"]);
  });

  test("one page still rubber-bands and settles", async () => {
    const home = await boot();
    await home.run(20);
    const start = x(home, "Contacts")!;
    await hold(home, 280, 120, 40);
    expect(x(home, "Contacts")! - start).toBeLessThan(-60);
    await home.run(30);
    expect(x(home, "Contacts")).toBe(start);
  });
});

describe("arranging icons", () => {
  /** An icon's centre: slot `slot` on a page, or slot `slot` of an n-icon dock. */
  const cell = (slot: number) => ({ x: 40 + (slot % 4) * 80, y: slot < 4 ? 49 : 123 });
  const dockCell = (slot: number, count: number) => ({ x: 160 - count * 40 + slot * 80 + 40, y: 197 });
  /** Hold the stylus on `from` until edit mode picks the icon up, carry it
   *  through `path`, dwell, and lift. */
  const carry = async (home: Console3ds, from: { x: number; y: number }, path: { x: number; y: number; dwell?: number }[]) => {
    for (let frame = 0; frame < 40; frame++) await home.step({ touches: [from], surface: "auxiliary" });
    let at = from;
    for (const to of path) {
      for (let frame = 1; frame <= 10; frame++) {
        const x = at.x + ((to.x - at.x) * frame) / 10;
        const y = at.y + ((to.y - at.y) * frame) / 10;
        await home.step({ touches: [{ x, y }], surface: "auxiliary" });
      }
      for (let frame = 0; frame < (to.dwell ?? 8); frame++) await home.step({ touches: [{ x: to.x, y: to.y }], surface: "auxiliary" });
      at = to;
    }
    await home.step({ surface: "auxiliary" });
    await home.run(24);
  };
  const left = (home: Console3ds, title: string) => home.locate(title)?.[0] ?? null;
  const top = (home: Console3ds, title: string) => home.locate(title)?.[1] ?? null;

  test("holding an icon starts edit mode and carries it; the others make room", async () => {
    const home = await boot();
    await home.run(10);
    await carry(home, cell(0), [cell(2)]);
    expect(home.texts("auxiliary")).toContain("Done");
    expect(left(home, "Pocket Nexus")!).toBeLessThan(left(home, "Contacts")!);
    expect(left(home, "Contacts")!).toBeLessThan(left(home, "Hacker News")!);
    shot(home, "rearranged");
    // In edit mode a tap launches nothing; Done ends it.
    await home.tapText("Contacts");
    await home.run(20);
    expect(home.launches).toEqual([]);
    await home.tapText("Done");
    await home.run(10);
    expect(home.texts("auxiliary")).not.toContain("Done");
  });

  test("an icon held at the right edge turns the page and drops on the next one", async () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      output: `app${index + 1}-main`,
      id: `dev.example.app${index + 1}`,
      title: `App ${index + 1}`,
      version: "1.0.0",
      bytes: 40_000,
    }));
    const home = await boot({ apps: many });
    await home.run(10);
    const column0 = left(home, "App 1")!;
    const column1 = left(home, "App 2")!;
    await carry(home, cell(0), [{ x: 316, y: 60, dwell: 40 }, { ...cell(0), dwell: 10 }]);
    // The second page now begins with App 1, then App 9.
    expect(left(home, "App 1")).toBe(column0);
    expect(left(home, "App 9")).toBe(column1);
    expect(left(home, "App 2")).toBeNull();
    // Back on the first page App 2 moved up to the first cell.
    await home.press(BTN.CROSS);
    await home.drag(60, 80, 300, 80, 4);
    await home.run(30);
    expect(left(home, "App 2")).toBe(column0);
  });

  test("icons move between the grid and the dock, which holds at most four", async () => {
    const home = await boot();
    await home.run(10);
    // Contacts into the dock after Settings and Mac.
    await carry(home, cell(2), [dockCell(2, 3)]);
    expect(top(home, "Contacts")!).toBeGreaterThan(200);
    expect(left(home, "Mac")!).toBeLessThan(left(home, "Contacts")!);
    // Settings from the dock into the grid's third cell.
    await carry(home, dockCell(0, 3), [cell(2)]);
    expect(top(home, "Settings")!).toBeLessThan(100);
    shot(home, "dock-grid");
  });

  test("the arrangement is kept in Home's data and survives a reboot", async () => {
    const storage = createSimFsHost();
    const mount = () => ((globalThis as Record<string, unknown>).fs = storage.ns);
    const first = await boot();
    mount();
    await first.run(10);
    await carry(first, cell(0), [cell(2)]);
    expect(left(first, "Contacts")!).toBeLessThan(left(first, "Hacker News")!);
    const again = await boot();
    mount();
    await again.run(20);
    expect(left(again, "Pocket Nexus")!).toBeLessThan(left(again, "Contacts")!);
    expect(left(again, "Contacts")!).toBeLessThan(left(again, "Hacker News")!);
    storage.dispose();
  });

  test("Camera and Photos join Settings and Mac in the dock", async () => {
    const home = await boot({
      apps: [
        ...APPS,
        { output: "camera-main", id: "dev.pocket-nexus.camera", title: "Camera", version: "0.1.0", bytes: 90_000 },
        { output: "photos-main", id: "dev.pocket-nexus.photos", title: "Photos", version: "0.1.0", bytes: 90_000 },
      ],
    });
    await home.run(20);
    const order = ["Settings", "Camera", "Photos", "Mac"].map((title) => {
      expect(top(home, title)!).toBeGreaterThan(200);
      return left(home, title)!;
    });
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    shot(home, "dock-four");
    await home.tapText("Camera");
    await home.run(30);
    expect(home.launches).toEqual(["camera-main"]);
  });
});

describe("settings", () => {
  test("the root lists Wi-Fi, Mac, Applets and General with their values", async () => {
    const home = await boot();
    await home.run(10);
    await openSettings(home);
    const bottom = home.texts("auxiliary");
    for (const label of ["Settings", "Wi-Fi", "PocketNet", "Evan's MacBook Pro", "Applets", "3", "General"]) expect(bottom).toContain(label);
    // No display-mode API on this host: no Dual Screen switch.
    expect(bottom).not.toContain("Dual Screen");
    shot(home, "settings");
  });

  test("Settings asks the top screen for the SELECT Home hint; SELECT closes it and the hint goes", async () => {
    const home = await boot({ agent: { available: true } });
    await home.run(10);
    expect(home.agent!.homeHint).toBe(false);
    await openSettings(home);
    expect(home.agent!.homeHint).toBe(true);
    await home.press(BTN.SELECT);
    await home.run(30);
    expect(home.agent!.homeHint).toBe(false);
    expect(home.texts("auxiliary")).toContain("Settings");
  });

  test("Dual Screen switches the console between two screens and one", async () => {
    const home = await boot({ agent: { available: true } });
    const modes: string[] = [];
    const setDisplay = home.agent!.ns.setDisplay as (mode: string) => boolean;
    home.agent!.ns.setDisplay = ((mode: string) => {
      modes.push(mode);
      return setDisplay(mode);
    }) as never;
    await home.run(10);
    await openSettings(home);
    expect(home.texts("auxiliary")).toContain("Dual Screen");
    shot(home, "settings-dual");
    // The switch sits below the fold: scroll it up, then tap it twice.
    await home.drag(160, 200, 160, 60, 20);
    await home.run(40);
    expect(home.locate("Dual Screen")![1]).toBeLessThan(220);
    await home.tapText("ON");
    await home.run(32);
    expect(modes).toEqual(["single"]);
    expect(home.agent!.display).toBe("single");
    expect(home.texts("auxiliary")).toContain("OFF");
    await home.tapText("OFF");
    await home.run(32);
    expect(modes).toEqual(["single", "dual"]);
    expect(home.agent!.display).toBe("dual");
  });

  test("Wi-Fi shows the saved networks and connects to the tapped one", async () => {
    const home = await boot();
    await home.run(10);
    await openSettings(home);
    await home.tapText("Wi-Fi");
    await home.run(24);
    const bottom = home.texts("auxiliary");
    for (const label of ["Saved Networks", "PocketNet", "Studio 5G", "Connection 3", "Not set up", "ON"]) expect(bottom).toContain(label);
    shot(home, "wifi");
    await home.tapText("Studio 5G");
    expect(home.wifi!.log).toContain("connect 1");
    await home.run(40);
    expect(home.wifi!.status().ssid).toBe("Studio 5G");
    await home.press(BTN.CROSS);
    await home.run(24);
    expect(home.texts("auxiliary")).toContain("Studio 5G");
  });

  test("the Wi-Fi switch turns the radio off", async () => {
    const home = await boot();
    await home.run(10);
    await openSettings(home);
    await home.tapText("Wi-Fi");
    await home.run(24);
    await home.tapText("ON");
    await home.run(32);
    expect(home.wifi!.log).toContain("setEnabled false");
    expect(home.texts("auxiliary")).toContain("OFF");
    expect(home.texts("auxiliary")).not.toContain("Saved Networks");
  });

  test("the linked Mac's clock sets the time and zone", async () => {
    const home = await boot();
    await home.run(10);
    await openSettings(home);
    await home.tapText("General");
    await home.run(24);
    await home.tapText("Time Zone");
    await home.run(24);
    expect(home.texts("auxiliary")).toContain("From the Mac");
    expect(home.texts("auxiliary")).toContain("UTC+8");
    await closeApp(home);
    expect(home.texts("auxiliary")).toContain("9:41 AM");
  });

  test("without a Mac, Time Zone moves the console's clock", async () => {
    const home = await boot({ link: { paired: [], catalog: CATALOG } });
    await home.run(10);
    await openSettings(home);
    await home.tapText("General");
    await home.run(24);
    await home.tapText("Time Zone");
    await home.run(24);
    // The console clock reads local time as UTC; the list opens on UTC.
    await home.tapText("UTC+1");
    await home.run(2);
    await closeApp(home);
    expect(home.texts("auxiliary")).toContain("2:41 AM");
  });

  test("B walks back up the stack and closes Settings", async () => {
    const home = await boot();
    await home.run(10);
    await openSettings(home);
    await home.tapText("General");
    await home.run(24);
    await home.press(BTN.CROSS);
    await home.run(24);
    expect(home.texts("auxiliary")).toContain("Wi-Fi");
    await home.press(BTN.CROSS);
    await home.run(24);
    expect(home.texts("auxiliary")).toContain("9:41 AM");
  });
});

describe("pairing a Mac", () => {
  test("scan a pairing code, pair, and land back on the Mac page linked", async () => {
    const home = await boot({ link: { paired: [], catalog: CATALOG } });
    await home.run(10);
    await openSettings(home);
    expect(home.texts("auxiliary")).toContain("Not Paired");
    await home.tapText("Mac");
    await home.run(24);
    expect(home.texts("auxiliary").join(" ")).toContain("On your Mac, open Pocket Companion and choose Pair a Console...");
    await home.tapText("Pair a Mac...");
    await home.run(24);
    expect(home.camera!.log).toContain("open");
    shot(home, "scanner");

    home.camera!.show("https://example.com/not-a-pairing-code");
    await home.run(2);
    expect(home.texts("auxiliary")).toContain("That code is not a Pocket pairing code.");
    expect(home.link!.log.some((line) => line.startsWith("pair "))).toBe(false);

    home.camera!.show(PAIRING_URI);
    await home.run(2);
    expect(home.link!.log).toContain(`pair ${PAIRING_URI}`);
    expect(home.texts("auxiliary").some((text) => text.startsWith("Connecting to Evan's MacBook"))).toBe(true);
    await home.run(32);
    expect(home.texts("auxiliary")).toContain("Paired with Evan's MacBook Pro");
    shot(home, "scanner-paired");
    await home.run(100);
    expect(home.camera!.log).toContain("close");
    const mac = home.texts("auxiliary");
    expect(mac).toContain("Linked");
    expect(mac).toContain("Evan's MacBook Pro");
    expect(home.link!.status().state).toBe("linked");
    shot(home, "mac");
  });

  test("a refused pairing shows its reason and keeps the scanner open", async () => {
    const home = await boot({ link: { paired: [], refusePairing: "The pairing window closed" } });
    await home.run(10);
    await openSettings(home);
    await home.tapText("Mac");
    await home.run(24);
    await home.tapText("Pair a Mac...");
    await home.run(24);
    home.camera!.show(PAIRING_URI);
    await home.run(40);
    expect(home.texts("auxiliary")).toContain("The pairing window closed");
    expect(home.camera!.open()).toBe(true);
  });
});

describe("the Mac store", () => {
  test("lists the catalog, installs an app, and the app opens from the springboard", async () => {
    const home = await boot();
    await home.run(10);
    await home.tapText("Mac");
    await home.run(24);
    const store = home.texts("auxiliary");
    for (const label of ["Hacker News", "OPEN", "Pocket Nexus", "UPDATE", "Weather", "GET"]) expect(store).toContain(label);
    shot(home, "store");

    const get = home.locate("GET")!;
    await home.tap(get[0] + get[2] / 2, get[1] + get[3] / 2);
    expect(home.link!.log).toContain("install 2 dev.pocket-nexus.weather");
    await home.run(8);
    expect(home.texts("auxiliary").some((text) => text.startsWith("Installing"))).toBe(true);
    shot(home, "store-installing");
    await home.run(30);
    expect(home.apps.map((app) => app.output)).toContain("weather-main");
    expect(home.texts("auxiliary")).not.toContain("GET");

    await home.press(BTN.START); // back to the springboard
    await home.run(24);
    expect(home.texts("auxiliary")).toContain("Weather");
    await home.tapText("Weather");
    await home.run(30);
    expect(home.launches).toEqual(["weather-main"]);
  });

  test("a row opens the app's page; its button installs the app", async () => {
    const home = await boot();
    await home.run(10);
    await home.tapText("Mac");
    await home.run(24);
    expect(home.texts("auxiliary")).toContain("3 applets offered by Evan's MacBook Pro");
    await home.tapText("Weather");
    await home.run(24);
    shot(home, "store-detail");
    const page = home.texts("auxiliary");
    for (const label of ["Weather", "Version 1.0.0  94 KB", "GET", "Description", "Forecasts for your saved cities.", "Information"]) expect(page).toContain(label);
    await home.drag(160, 200, 160, 80, 8);
    await home.run(40);
    const info = home.texts("auxiliary");
    for (const label of ["Identifier", "dev.pocket-nexus.weather", "Installed", "No"]) expect(info).toContain(label);
    await home.drag(160, 80, 160, 220, 8);
    await home.run(40);
    await home.tapText("GET");
    expect(home.link!.log).toContain("install 2 dev.pocket-nexus.weather");
    await home.run(40);
    expect(home.texts("auxiliary")).toContain("OPEN");
    expect(home.apps.map((app) => app.output)).toContain("weather-main");
    await home.tapText("OPEN");
    await home.run(4);
    expect(home.launches).toEqual(["weather-main"]);
  });

  test("without a paired Mac the store points to Settings > Mac", async () => {
    const home = await boot({ link: { paired: [] } });
    await home.run(10);
    await home.tapText("Mac");
    await home.run(24);
    expect(home.texts("auxiliary")).toContain("No Mac Paired");
    await home.tapText("Mac Settings");
    await home.run(24);
    expect(home.texts("auxiliary")).toContain("Pair a Mac...");
  });
});

test("a journey is a pure function of its input", async () => {
  const hashes: string[][] = [];
  for (let run = 0; run < 2; run++) {
    const home = await boot();
    const seen: string[] = [];
    await home.run(10);
    await home.tapText("Settings");
    for (let frame = 0; frame < 30; frame++) {
      await home.step();
      if (frame % 10 === 9) seen.push(Bun.hash(home.world.pixels("auxiliary").rgba).toString(16));
    }
    seen.push(Bun.hash(home.world.pixels("primary").rgba).toString(16));
    hashes.push(seen);
  }
  expect(hashes[0]).toEqual(hashes[1]!);
});
