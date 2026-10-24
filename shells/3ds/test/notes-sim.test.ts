// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/notes-sim.test.ts — the Notes applet (shells/3ds/notes)
// headless on the wasm core with the 3DS geometry and an fs module in
// memory (test/notes-fixture.ts): a new note typed on the keyboard, undo and
// redo, the autosave and Control+s, the caret placed by a tap, the list
// after a reboot from the same files, and deleting. The app draws nothing on
// the top screen.
//
// POCKET_NOTES_SHOTS=<dir> also writes bottom-screen PNGs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootConsole3ds, type Console3ds } from "../../../vendor/pocketjs/programs/sim/console-3ds.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { buildGuest } from "./build.ts";
import { createMemoryFs, type MemoryFs } from "./notes-fixture.ts";
import { PORTRAIT, TAB5, tab5Shot } from "./tab5.ts";

const OUT = mkdtempSync(join(tmpdir(), "pocket-notes-"));
let GUEST = join(OUT, "guest", "notes-main");
const SHOTS = process.env.POCKET_NOTES_SHOTS;
const GLOBALS = ["ui", "__pak", "__simHz", "frame", "link", "wifi", "camera", "net", "agent", "__pocketApp"] as const;
const saved = new Map(GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]));
let fs: MemoryFs = createMemoryFs();

beforeAll(() => {
  GUEST = buildGuest("notes", OUT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}, 120_000);

afterAll(() => {
  fs.uninstall();
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  rmSync(OUT, { recursive: true, force: true });
});

/** A console with `store` as its card; a fresh store when none is given. */
async function boot(store?: MemoryFs, auxiliary?: [number, number]): Promise<Console3ds> {
  fs = store ?? createMemoryFs();
  fs.install();
  const app = await bootConsole3ds({
    js: `${GUEST}.js`,
    pak: `${GUEST}.pak`,
    current: "notes-main",
    link: null,
    wifi: null,
    camera: false,
    agent: { available: true },
    auxiliary,
  });
  await app.run(6);
  return app;
}

function shot(app: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = app.world.pixels("auxiliary");
  writeFileSync(join(SHOTS, `notes-${name}.png`), encodePNG(rgba, width, height));
}

/** The files under notes/ but the index, by name. */
const noteFiles = (store: MemoryFs) => [...store.files.keys()].filter((path) => path.startsWith("notes/") && path.endsWith(".txt")).sort();

/** A push settles over 18 frames of slide before the page below hides. */
const SETTLE = 24;

describe("Notes on the 3DS", () => {
  test("a new note is typed on the keyboard, undone, redone and saved", async () => {
    const app = await boot();
    expect(app.texts("auxiliary")).toContain("Notes");
    expect(app.texts("auxiliary")).toContain("New Note");
    expect(app.texts("auxiliary")).toContain("No Notes");
    shot(app, "empty");

    // Without a keyboard the 3DS opens a new note over the on-screen keyboard.
    await app.tapText("New Note");
    await app.run(SETTLE);
    expect(app.texts("auxiliary")).toContain("▼");
    expect(noteFiles(fs).length).toBe(1);

    // The keyboard types ahead of the on-screen session.
    await app.type("Hello world");
    await app.key("Enter");
    await app.type("Second line");
    const texts = app.texts("auxiliary");
    expect(texts).toContain("Hello world");
    expect(texts).toContain("Second line");
    shot(app, "typed");

    // Undo takes the last run of typing; redo brings it back.
    await app.key("Control+z");
    expect(app.texts("auxiliary")).not.toContain("Second line");
    await app.key("Control+y");
    expect(app.texts("auxiliary")).toContain("Second line");

    // The autosave lands one virtual second after the last edit.
    const [path] = noteFiles(fs);
    expect(fs.text(path!)).toBe("");
    await app.run(70);
    expect(fs.text(path!)).toBe("Hello world\nSecond line");

    // Control+s saves at once.
    await app.type("!");
    expect(fs.text(path!)).toBe("Hello world\nSecond line");
    await app.key("Control+s");
    expect(fs.text(path!)).toBe("Hello world\nSecond line!");

    // The caret moves by keys: Home, then typing lands at the line's start.
    await app.key("ArrowUp");
    await app.key("Home");
    await app.type("> ");
    expect(app.texts("auxiliary")).toContain("> Hello world");

    // The keyboard's hide key goes back to the list, which names the note
    // by its first line.
    await app.tapText("▼");
    await app.run(SETTLE);
    const list = app.texts("auxiliary");
    expect(list).toContain("> Hello world");
    expect(list.some((line) => line.endsWith("Second line!"))).toBe(true);
    expect(fs.text(path!)).toBe("> Hello world\nSecond line!");
    shot(app, "list");
  }, 120_000);

  test("the on-screen backspace at a line's start joins it to the line above", async () => {
    const app = await boot();
    await app.tapText("New Note");
    await app.run(SETTLE);
    await app.tapText("a");
    await app.tapText("b");
    await app.key("Enter");
    await app.tapText("c");
    await app.run(SETTLE);
    expect(app.texts("auxiliary")).toContain("c");
    await app.tapText("⌫");
    await app.tapText("⌫");
    await app.tapText("x");
    await app.run(SETTLE);
    expect(app.texts("auxiliary")).toContain("abx");
    await app.tapText("▼");
    await app.run(SETTLE);
    expect(fs.text(noteFiles(fs)[0]!)).toBe("abx");
  }, 120_000);

  test("the list comes back from the card after a reboot, and Edit deletes", async () => {
    const store = createMemoryFs();
    const first = await boot(store);
    await first.tapText("New Note");
    await first.run(SETTLE);
    await first.type("Groceries");
    await first.key("Enter");
    await first.type("milk, eggs");
    await first.key("Control+s");
    expect(noteFiles(store).length).toBe(1);
    expect(store.text("notes/index.json")).toContain("\"title\":\"Groceries\"");

    const app = await boot(store);
    const list = app.texts("auxiliary");
    expect(list).toContain("Groceries");
    expect(list.some((line) => line.endsWith("milk, eggs"))).toBe(true);

    // Opening it shows the text; the back button returns to the list.
    await app.tapText("Groceries");
    await app.run(SETTLE);
    expect(app.texts("auxiliary")).toContain("milk, eggs");
    expect(app.texts("auxiliary")).toContain("Type");
    await app.tapText("Notes");
    await app.run(SETTLE);

    await app.tapText("Edit");
    expect(app.texts("auxiliary")).toContain("Delete");
    await app.tapText("Delete");
    expect(app.texts("auxiliary")).toContain("Delete Note");
    shot(app, "delete");
    await app.tapText("Delete");
    await app.run(4);
    expect(app.texts("auxiliary")).toContain("No Notes");
    expect(noteFiles(store).length).toBe(0);
    await app.tapText("Done");
    expect(app.texts("auxiliary")).not.toContain("Done");
  }, 120_000);
});

describe("Notes on the Tab5's surface", () => {
  test("a keyboard types into the note; a tap places the caret", async () => {
    const app = await boot(undefined, TAB5);
    await app.tapText("New Note");
    await app.run(SETTLE);
    // With room for a keyboard the note opens without the on-screen one.
    expect(app.texts("auxiliary")).toContain("Type");
    await app.type("The quick brown fox jumps over the lazy dog, and then the sentence keeps going until it has to wrap onto a second row.");
    // The text wraps under the 640 px surface: the bar's title is the first
    // line cut short, the rows carry the whole sentence.
    const texts = app.texts("auxiliary");
    expect(texts.filter((line) => line.startsWith("The quick")).length).toBe(2);
    expect(texts.filter((line) => line.endsWith("second row.")).length).toBe(1);
    tab5Shot(app, "notes-wrapped");

    // A tap at the first row's start puts the caret there.
    await app.tap(11, 46);
    await app.type("* ");
    expect(app.texts("auxiliary").some((line) => line.startsWith("* The quick"))).toBe(true);

    // Type docks the on-screen keyboard; the keyboard still types ahead of
    // it, a tap on the text above it still places the caret, and its hide
    // key returns.
    await app.tapText("Type");
    await app.run(SETTLE);
    expect(app.texts("auxiliary")).toContain("▼");
    await app.type("+");
    expect(app.texts("auxiliary").some((line) => line.startsWith("* +The quick"))).toBe(true);
    await app.tap(11, 46);
    await app.type("#");
    expect(app.texts("auxiliary").some((line) => line.startsWith("#* +The quick"))).toBe(true);
    tab5Shot(app, "notes-type");
    await app.tapText("▼");
    await app.run(SETTLE);
    expect(app.texts("auxiliary")).toContain("Type");
    expect(app.texts("auxiliary")).not.toContain("▼");
  }, 120_000);

  test("the list lays out in portrait", async () => {
    const store = createMemoryFs();
    const first = await boot(store, PORTRAIT);
    await first.tapText("New Note");
    await first.run(SETTLE);
    await first.type("Portrait");
    await first.key("Control+s");
    await first.tapText("Notes");
    await first.run(SETTLE);
    expect(first.texts("auxiliary")).toContain("Portrait");
    tab5Shot(first, "notes-portrait");
  }, 120_000);
});
