// SPDX-License-Identifier: GPL-3.0-only
// test/system-ui-sim.test.ts — system-ui in the sim. Two worlds:
//
//   1. standalone (no System UI companion): the app boots a static arrangement —
//      the unmodified-app base case.
//   2. a mock System UI companion: svcOpen/svcPoll/svcSend installed before eval
//      (bootWorld mutateOps), so the whole input dialect journey runs
//      headless — typing, drag selection, ⌘ chords, the notepad context
//      menu, paste-req — with guest intents (copy payloads!) asserted on
//      the wire, the host's open line launching apps by package id, and the
//      theme lines in both directions.
//
// The solid bundle must be prebuilt (the sim's fallback build cannot
// resolve the framework-suffixed name):
//
//   bun tools/build.ts pocket-desktop-system-ui --framework=solid
//   bun test --conditions=browser test/system-ui-sim.test.ts

import { testTextProvider } from "./text-provider.ts";
import { describe, expect, test } from "bun:test";
import {
  bootWorld,
  runScenario,
  treeHasText,
  type SimWorld,
} from "../../../vendor/pocketjs/hosts/sim/sim.ts";
import {
  DESKTOP_ABOUT,
  DESKTOP_NAME,
  appWindowTitle,
} from "../src/system-ui/pocket-apps.ts";
import {
  AQUA_THEME,
  CLASSIC_THEME,
  THEMES,
  XP_THEME,
} from "../src/system-ui/theme.ts";
import {
  cascadePos,
  contentTop,
  desktopIconPosition,
  desktopIconRows,
} from "../src/system-ui/wm.ts";

const APP = "pocket-desktop-system-ui";

describe("pocket-desktop-system-ui boots standalone", () => {
  test("desktop, taskbar and the boot windows render", async () => {
    const trace = await runScenario({ app: APP, seconds: 2 });
    expect(treeHasText(trace.tree, "Start")).toBe(true);
    expect(treeHasText(trace.tree, "Minesweeper")).toBe(true);
    expect(treeHasText(trace.tree, "My Computer")).toBe(true);
    expect(treeHasText(trace.tree, "Pair a companion to enable text layout.")).toBe(true);
  }, 30000);
});

// ---------------------------------------------------------------------------
// The System UI companion journey
// ---------------------------------------------------------------------------

interface MockSvc {
  push: (line: Record<string, unknown>) => void;
  sent: () => Record<string, unknown>[];
  surfaces: () => readonly [number, number, number][];
  mutateOps: (ops: Record<string, unknown>) => void;
}

function mockSvc(): MockSvc {
  const toGuest: string[] = [];
  const fromGuest: Record<string, unknown>[] = [];
  const surfaceBindings: [number, number, number][] = [];
  return {
    push: (line) => toGuest.push(JSON.stringify(line)),
    sent: () => fromGuest,
    surfaces: () => surfaceBindings,
    mutateOps: (ops) => {
      // Pocket System package handles are independent of svc. Keep the real
      // WASM core op underneath so this test exercises SURFACE_QUAD creation.
      const setCompositorSurface = ops.setCompositorSurface as (
        node: number,
        surface: number,
        focused: number,
      ) => void;
      ops.__surfaces = {
        "dev.pocket-nexus.hero": 1,
        "dev.pocket-nexus.settings": 2,
      };
      ops.setCompositorSurface = (
        node: number,
        surface: number,
        focused: number,
      ) => {
        surfaceBindings.push([node, surface, focused]);
        setCompositorSurface(node, surface, focused);
      };
      ops.__host = "macos-app";
      ops.svcOpen = (name: string) => name === "system-ui";
      ops.svcPoll = () => {
        if (toGuest.length === 0) return null;
        const batch = toGuest.join("\n");
        toGuest.length = 0;
        return batch;
      };
      ops.svcSend = (line: string) => {
        fromGuest.push(JSON.parse(line) as Record<string, unknown>);
      };
    },
  };
}

/** One frame transaction; asynchronous provider replies enter subsequent frames. */
async function step(world: SimWorld, frames = 1): Promise<void> {
  for (let f = 0; f < frames; f++) {
    world.frame(0);
    for (let t = 0; t < world.ticksPerFrame; t++) world.tick();
    await Promise.resolve();
  }
}

function mouse(svc: MockSvc, x: number, y: number, d: boolean, b?: number) {
  svc.push(
    b === 2
      ? { t: "mouse", x, y, d, b: 2, sh: false }
      : { t: "mouse", x, y, d, sh: false },
  );
}

/** How many text nodes of the tree contain `text`. */
function treeTextCount(tree: unknown, text: string): number {
  if (tree == null) return 0;
  const node = tree as { x?: unknown; k?: unknown[] };
  const own = typeof node.x === "string" && node.x.includes(text) ? 1 : 0;
  return Array.isArray(node.k)
    ? node.k.reduce<number>((sum, child) => sum + treeTextCount(child, text), own)
    : own;
}

/** The text of every text node, in tree order. */
function treeTexts(tree: unknown, out: string[] = []): string[] {
  if (tree == null) return out;
  const node = tree as { x?: unknown; k?: unknown[] };
  if (typeof node.x === "string") out.push(node.x);
  if (Array.isArray(node.k)) for (const child of node.k) treeTexts(child, out);
  return out;
}

function treeHasClass(tree: unknown, className: string): boolean {
  if (tree == null) return false;
  const node = tree as { c?: unknown; k?: unknown[] };
  if (node.c === className) return true;
  return Array.isArray(node.k) &&
    node.k.some((child) => treeHasClass(child, className));
}

describe("system-ui System UI companion journey", () => {
  test("switches classic, XP and Aqua paint at runtime", async () => {
    const svc = mockSvc();
    const provider = await testTextProvider();
    const world = await bootWorld(APP, 60, {offload: provider.ops}, svc.mutateOps);
    const guestFrame = world.frame;
    world.frame = (...args) => { provider.betweenFrames(); guestFrame(...args); };
    svc.push({ t: "hello", w: 800, h: 600, epoch: 1755650000000 });
    await step(world, 3);

    expect(treeHasClass(world.getTree(), CLASSIC_THEME.desktop)).toBe(true);

    // Start -> Settings exposes the user-facing theme choices. At 800x600
    // the Settings row begins at y=433 and its three-row flyout at x=181.
    svc.push({ t: "key", k: "escape", cmd: true });
    await step(world, 2);
    mouse(svc, 100, 445, false);
    await step(world, 2);
    // The flyout's rows are the three theme labels, in picker order.
    expect(
      treeTexts(world.getTree()).filter((text) =>
        THEMES.some((theme) => theme.label === text),
      ),
    ).toEqual(["Classic 98", "XP", "Aqua"]);
    mouse(svc, 220, 461, true);
    mouse(svc, 220, 461, false);
    await step(world, 2);
    let tree = world.getTree();
    expect(treeHasClass(tree, XP_THEME.desktop)).toBe(true);
    expect(treeHasClass(tree, XP_THEME.taskbar)).toBe(true);
    expect(
      treeHasClass(tree, XP_THEME.caption(true)),
    ).toBe(true);

    // The All Programs flyout overlaps the places column. Hovering a flyout
    // row that sits over a plain places row ("Run...") must keep the flyout
    // open with that row highlighted. At 800x600 the panel body starts at
    // y=291; All Programs sits at y=505 and its 13-row flyout is clamped to
    // y=319 at x=170, so its "Chrome" row (index 6) spans y 433..452.
    svc.push({ t: "key", k: "escape", cmd: true });
    await step(world, 2);
    mouse(svc, 80, 519, false);
    await step(world, 2);
    expect(treeHasText(world.getTree(), "All Programs")).toBe(true);
    mouse(svc, 250, 445, false);
    await step(world, 2);
    expect(treeHasClass(world.getTree(), XP_THEME.popupItem(true))).toBe(true);
    svc.push({ t: "key", k: "Escape" });
    await step(world, 2);

    // ⌘⇧T cycles in picker order: XP -> Aqua (screen bar, Dock, no
    // in-window menu bar) -> Classic.
    svc.push({ t: "key", k: "t", cmd: true, sh: true });
    await step(world, 2);
    tree = world.getTree();
    expect(treeHasClass(tree, AQUA_THEME.desktop)).toBe(true);
    expect(treeHasClass(tree, AQUA_THEME.screenBar)).toBe(true);
    expect(treeHasClass(tree, AQUA_THEME.taskList)).toBe(true);
    expect(treeHasClass(tree, AQUA_THEME.menuBar)).toBe(false);
    expect(treeHasText(tree, "Notepad")).toBe(true); // the screen bar's app name
    // No Start button: the launcher is the screen-bar logo.
    expect(treeHasClass(tree, CLASSIC_THEME.startButton(false))).toBe(false);
    expect(treeHasClass(tree, XP_THEME.startButton(false))).toBe(false);

    // The focused Notepad's menus live in the screen bar: clicking "File"
    // there drops its menu.
    mouse(svc, 40 + 16 + 62 + 10, 10, true);
    mouse(svc, 40 + 16 + 62 + 10, 10, false);
    await step(world, 2);
    // (The exact x depends on the measured app-name width; assert the
    // dropdown through its unique item instead of its position.)
    const fileOpen = treeHasText(world.getTree(), "Exit");
    svc.push({ t: "key", k: "Escape" });
    await step(world, 2);

    svc.push({ t: "key", k: "t", cmd: true, sh: true });
    await step(world, 2);
    tree = world.getTree();
    expect(treeHasClass(tree, CLASSIC_THEME.desktop)).toBe(true);
    expect(treeHasClass(tree, AQUA_THEME.desktop)).toBe(false);
    expect(treeHasClass(tree, XP_THEME.desktop)).toBe(false);
    expect(typeof fileOpen).toBe("boolean");
  }, 30000);

  test("typing, selection, ⌘ chords, context menu and paste-req", async () => {
    const svc = mockSvc();
    const provider = await testTextProvider();
    const world = await bootWorld(APP, 60, {offload: provider.ops}, svc.mutateOps);
    const guestFrame = world.frame;
    world.frame = (...args) => { provider.betweenFrames(); guestFrame(...args); };
    const EPOCH = 1755650000000;
    svc.push({ t: "hello", w: 800, h: 600, epoch: EPOCH });
    await step(world, 24);

    // With the companion connected only the welcome notepad boots (the
    // standalone extras — the My Computer folder with its status bar — stay
    // closed); the taskbar clock ticks from the hello epoch.
    let tree = world.getTree();
    expect(treeHasText(tree, "welcome.txt - Notepad")).toBe(true);
    expect(treeHasText(tree, "object(s)")).toBe(false);
    const d = new Date(EPOCH);
    const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    expect(treeHasText(tree, hhmm)).toBe(true);

    // Typing: ch lines land at the caret (doc origin), one char per line.
    for (const ch of ["H", "i"]) svc.push({ t: "ch", s: ch });
    await step(world, 24);
    tree = world.getTree();
    expect(treeHasText(tree, "HiWelcome to Pocket Shell Desktop.")).toBe(true);

    // Double-click selects the word under the pointer; ⌘C ships it as a
    // copy intent (the welcome window sits at 64,28; content text origin
    // 70,71; row 0 centers at y≈79).
    mouse(svc, 75, 79, true);
    mouse(svc, 75, 79, false);
    await step(world, 2);
    mouse(svc, 75, 79, true);
    mouse(svc, 75, 79, false);
    await step(world, 2);
    svc.push({ t: "key", k: "c", cmd: true });
    await step(world, 2);
    const copies = svc.sent().filter((l) => l.t === "copy");
    expect(copies.length).toBe(1);
    expect(copies[0].text).toBe("HiWelcome");

    // Drag selection: down at the line start, drag right, release; ⌘C
    // copies a prefix of the row and the selected run renders as its own
    // navy segment (its text splits out of the full-line node).
    mouse(svc, 70, 79, true);
    await step(world, 2);
    mouse(svc, 140, 79, false);
    await step(world, 2);
    mouse(svc, 140, 79, false);
    await step(world, 2);
    svc.push({ t: "key", k: "c", cmd: true });
    await step(world, 2);
    const copy2 = svc.sent().filter((l) => l.t === "copy")[1];
    expect(typeof copy2.text).toBe("string");
    const dragged = copy2.text as string;
    expect(dragged.length).toBeGreaterThan(0);
    expect("HiWelcome to Pocket Shell Desktop.".startsWith(dragged)).toBe(true);
    tree = world.getTree();
    expect(treeHasText(tree, dragged)).toBe(true);

    // Right-click in the content opens the edit context menu; the Paste row
    // sends paste-req; the host's paste line lands at the caret.
    mouse(svc, 75, 100, true, 2);
    mouse(svc, 75, 100, false, 2);
    await step(world, 2);
    tree = world.getTree();
    expect(treeHasText(tree, "Select All")).toBe(true);
    expect(treeHasText(tree, "Paste")).toBe(true);
    // Popup at (75,100): 1px border, 18px rows — Cut, Copy, Paste.
    mouse(svc, 100, 101 + 18 + 18 + 9, true);
    mouse(svc, 100, 101 + 18 + 18 + 9, false);
    await step(world, 2);
    expect(svc.sent().some((l) => l.t === "paste-req")).toBe(true);
    svc.push({ t: "paste", text: "[PASTED]" });
    await step(world, 24);
    expect(treeHasText(world.getTree(), "[PASTED]")).toBe(true);

    // ⌘Esc toggles the Start menu.
    svc.push({ t: "key", k: "escape", cmd: true });
    await step(world, 2);
    tree = world.getTree();
    expect(treeHasText(tree, "Programs")).toBe(true);
    expect(treeHasText(tree, "Shut Down...")).toBe(true);
    svc.push({ t: "key", k: "Escape" });
    await step(world, 2);
    expect(treeHasText(world.getTree(), "Shut Down...")).toBe(false);

    // ⌘N opens a fresh Notepad, ⌘W closes it again.
    svc.push({ t: "key", k: "n", cmd: true });
    await step(world, 2);
    expect(treeHasText(world.getTree(), "Untitled - Notepad")).toBe(true);
    svc.push({ t: "key", k: "w", cmd: true });
    await step(world, 2);
    expect(treeHasText(world.getTree(), "Untitled - Notepad")).toBe(false);

    // Undo/redo: a typing run coalesces into ONE unit — ⌘Z pulls both
    // characters back out at once, ⌘⇧Z replays them.
    for (const ch of ["Q", "Q"]) svc.push({ t: "ch", s: ch });
    await step(world, 24);
    expect(treeHasText(world.getTree(), "[PASTED]QQ")).toBe(true);
    svc.push({ t: "key", k: "z", cmd: true });
    await step(world, 24);
    const afterUndo = world.getTree();
    expect(treeHasText(afterUndo, "[PASTED]QQ")).toBe(false);
    expect(treeHasText(afterUndo, "[PASTED]")).toBe(true);
    svc.push({ t: "key", k: "z", cmd: true, sh: true });
    await step(world, 24);
    expect(treeHasText(world.getTree(), "[PASTED]QQ")).toBe(true);
  }, 30000);

  test("desktop windows bind package surfaces and publish native focus", async () => {
    const svc = mockSvc();
    const provider = await testTextProvider();
    const world = await bootWorld(APP, 60, {offload: provider.ops}, svc.mutateOps);
    const guestFrame = world.frame;
    world.frame = (...args) => { provider.betweenFrames(); guestFrame(...args); };
    svc.push({ t: "hello", w: 800, h: 600, epoch: 1755650000000 });
    await step(world, 3);

    const doubleClick = async (x: number, y: number) => {
      mouse(svc, x, y, true);
      mouse(svc, x, y, false);
      await step(world);
      mouse(svc, x, y, true);
      mouse(svc, x, y, false);
      await step(world, 2);
    };

    // Five system icons precede Hero and Settings. At 800x600 the grid has
    // nine rows, so both remain in the first column at y=298 and y=356.
    await doubleClick(45, 320);
    expect(treeHasText(world.getTree(), appWindowTitle("Hero"))).toBe(true);
    expect(svc.surfaces().filter(([, surface]) => surface === 1).at(-1)?.[2]).toBe(1);

    await doubleClick(45, 378);
    let tree = world.getTree();
    expect(treeHasText(tree, appWindowTitle("Hero"))).toBe(true);
    expect(treeHasText(tree, appWindowTitle("Settings"))).toBe(true);
    expect(svc.surfaces().filter(([, surface]) => surface === 1).at(-1)?.[2]).toBe(0);
    expect(svc.surfaces().filter(([, surface]) => surface === 2).at(-1)?.[2]).toBe(1);
    expect(svc.sent().some((line) => String(line.t).startsWith("pocket-"))).toBe(false);

    svc.push({ t: "key", k: "w", cmd: true });
    await step(world, 2);
    tree = world.getTree();
    expect(treeHasText(tree, appWindowTitle("Settings"))).toBe(false);
    expect(treeHasText(tree, appWindowTitle("Hero"))).toBe(true);
    expect(svc.sent().some((line) => String(line.t).startsWith("pocket-"))).toBe(false);
  }, 30000);

  test("the host opens installed apps by package id", async () => {
    const svc = mockSvc();
    const provider = await testTextProvider();
    const world = await bootWorld(APP, 60, {offload: provider.ops}, svc.mutateOps);
    const guestFrame = world.frame;
    world.frame = (...args) => { provider.betweenFrames(); guestFrame(...args); };
    svc.push({ t: "hello", w: 800, h: 600, epoch: 1755650000000 });
    await step(world, 3);

    const HERO = "dev.pocket-nexus.hero";
    const SETTINGS = "dev.pocket-nexus.settings";
    /** The focused flag of the last binding the shell made for a surface. */
    const focusedFlag = (surface: number) =>
      svc.surfaces().filter(([, handle]) => handle === surface).at(-1)?.[2];
    // A window's title is one text node in its caption and one in its task
    // button, so two nodes mean exactly one window.
    const titleNodes = (title: string) => treeTextCount(world.getTree(), title);

    // An open line opens the window and gives it focus, as its icon would.
    svc.push({ t: "open", package: HERO });
    await step(world, 2);
    expect(titleNodes(appWindowTitle("Hero"))).toBe(2);
    expect(focusedFlag(1)).toBe(1);

    svc.push({ t: "open", package: SETTINGS });
    await step(world, 2);
    expect(titleNodes(appWindowTitle("Settings"))).toBe(2);
    expect(focusedFlag(1)).toBe(0);
    expect(focusedFlag(2)).toBe(1);

    // A second line for an open app raises and focuses its window; it does
    // not open another.
    svc.push({ t: "open", package: HERO });
    await step(world, 2);
    expect(titleNodes(appWindowTitle("Hero"))).toBe(2);
    expect(titleNodes(appWindowTitle("Settings"))).toBe(2);
    expect(focusedFlag(1)).toBe(1);
    expect(focusedFlag(2)).toBe(0);

    // Cmd+M minimizes Hero and focus falls to Settings; the open line
    // restores Hero from the task strip and focuses it again.
    svc.push({ t: "key", k: "m", cmd: true });
    await step(world, 2);
    expect(focusedFlag(1)).toBe(0);
    expect(focusedFlag(2)).toBe(1);
    svc.push({ t: "open", package: HERO });
    await step(world, 2);
    expect(titleNodes(appWindowTitle("Hero"))).toBe(2);
    expect(focusedFlag(1)).toBe(1);
    expect(focusedFlag(2)).toBe(0);

    // The line closes an open launcher before it changes focus.
    svc.push({ t: "key", k: "escape", cmd: true });
    await step(world, 2);
    expect(treeHasText(world.getTree(), "Shut Down...")).toBe(true);
    svc.push({ t: "open", package: SETTINGS });
    await step(world, 2);
    expect(treeHasText(world.getTree(), "Shut Down...")).toBe(false);
    expect(focusedFlag(2)).toBe(1);

    // Ids outside the installed catalog, the System UI's own id and a line
    // without an id change nothing.
    const before = JSON.stringify(world.getTree());
    const bindings = svc.surfaces().length;
    svc.push({ t: "open", package: "dev.pocket-nexus.missing" });
    svc.push({ t: "open", package: "dev.pocket-nexus.desktop.system-ui" });
    svc.push({ t: "open" });
    svc.push({ t: "open", package: 7 });
    await step(world, 2);
    expect(JSON.stringify(world.getTree())).toBe(before);
    expect(svc.surfaces().length).toBe(bindings);
    expect(treeHasText(world.getTree(), appWindowTitle("missing"))).toBe(false);
  }, 30000);

  test("the screen bar and About name the desktop after the System manifest", async () => {
    const svc = mockSvc();
    const provider = await testTextProvider();
    const world = await bootWorld(APP, 60, {offload: provider.ops}, svc.mutateOps);
    const guestFrame = world.frame;
    world.frame = (...args) => { provider.betweenFrames(); guestFrame(...args); };
    svc.push({ t: "hello", w: 800, h: 600, epoch: 1755650000000 });
    await step(world, 3);

    // Classic boots with the welcome note focused: the name is in its text
    // only. Closing the note and cycling to Aqua leaves no window focused,
    // so the screen bar shows the desktop's own name.
    expect(treeHasText(world.getTree(), `Welcome to ${DESKTOP_NAME}.`)).toBe(true);
    svc.push({ t: "key", k: "w", cmd: true });
    svc.push({ t: "key", k: "t", cmd: true, sh: true });
    svc.push({ t: "key", k: "t", cmd: true, sh: true });
    await step(world, 3);
    let tree = world.getTree();
    expect(treeHasClass(tree, AQUA_THEME.screenBar)).toBe(true);
    expect(treeTextCount(tree, DESKTOP_NAME)).toBe(1);

    // The logo menu's first row opens About: the menu row is gone and the
    // name is in the screen bar (About is no program of its own), the
    // window's caption, its Dock tile's hidden label and its heading.
    svc.push({ t: "key", k: "escape", cmd: true });
    await step(world, 2);
    expect(treeHasText(world.getTree(), `About ${DESKTOP_NAME}`)).toBe(true);
    const row = AQUA_THEME.metrics.screenBarH + 10;
    mouse(svc, 30, row, true);
    mouse(svc, 30, row, false);
    await step(world, 2);
    tree = world.getTree();
    expect(treeHasText(tree, "Shut Down...")).toBe(false);
    expect(treeHasText(tree, `About ${DESKTOP_NAME}`)).toBe(true);
    // Under the heading the dialog shows pocket.about.json: one text node
    // per body line, then the link.
    expect(DESKTOP_ABOUT.body.length).toBeGreaterThan(0);
    for (const line of DESKTOP_ABOUT.body)
      expect(treeTextCount(tree, line)).toBe(1);
    expect(treeTextCount(tree, DESKTOP_ABOUT.link)).toBe(1);
    const texts = treeTexts(tree);
    expect(texts.indexOf(DESKTOP_ABOUT.link)).toBe(
      texts.indexOf(DESKTOP_ABOUT.body[0]) + DESKTOP_ABOUT.body.length,
    );
  }, 30000);

  test("the shell reports its theme and takes the host's theme line", async () => {
    const svc = mockSvc();
    const provider = await testTextProvider();
    const world = await bootWorld(APP, 60, {offload: provider.ops}, svc.mutateOps);
    const guestFrame = world.frame;
    world.frame = (...args) => { provider.betweenFrames(); guestFrame(...args); };
    svc.push({ t: "hello", w: 800, h: 600, epoch: 1755650000000 });
    await step(world, 3);

    /** Ids of the theme lines the shell has sent, oldest first. */
    const reported = () =>
      svc.sent().filter((line) => line.t === "theme").map((line) => line.id);

    // One report after boot, and none while the theme stands.
    expect(reported()).toEqual(["classic"]);
    await step(world, 6);
    expect(reported()).toEqual(["classic"]);

    // The cycle chord changes the theme; the shell reports the new one.
    svc.push({ t: "key", k: "t", cmd: true, sh: true });
    await step(world, 2);
    expect(treeHasClass(world.getTree(), XP_THEME.desktop)).toBe(true);
    expect(reported()).toEqual(["classic", "xp"]);

    // The host's line selects a theme, and the shell reports that one too.
    svc.push({ t: "theme", id: "aqua" });
    await step(world, 2);
    let tree = world.getTree();
    expect(treeHasClass(tree, AQUA_THEME.desktop)).toBe(true);
    expect(treeHasClass(tree, AQUA_THEME.screenBar)).toBe(true);
    expect(treeHasClass(tree, XP_THEME.desktop)).toBe(false);
    expect(reported()).toEqual(["classic", "xp", "aqua"]);

    // The active theme again, an id that names no theme and a line without
    // a usable id change nothing and report nothing.
    const before = JSON.stringify(world.getTree());
    svc.push({ t: "theme", id: "aqua" });
    svc.push({ t: "theme", id: "luna" });
    svc.push({ t: "theme", id: 7 });
    svc.push({ t: "theme" });
    await step(world, 2);
    expect(JSON.stringify(world.getTree())).toBe(before);
    expect(reported()).toEqual(["classic", "xp", "aqua"]);

    // A pick in the Settings menu is reported like the chord. On Aqua the
    // logo menu's Settings row spans y 119..138 and its flyout opens at
    // x=207 with "Classic 98" on its first row.
    svc.push({ t: "key", k: "escape", cmd: true });
    await step(world, 2);
    mouse(svc, 100, 129, false);
    await step(world, 2);
    mouse(svc, 250, 133, true);
    mouse(svc, 250, 133, false);
    await step(world, 2);
    tree = world.getTree();
    expect(treeHasClass(tree, CLASSIC_THEME.desktop)).toBe(true);
    expect(reported()).toEqual(["classic", "xp", "aqua", "classic"]);

    // The host's line closes an open launcher, as a pick in it would.
    svc.push({ t: "key", k: "escape", cmd: true });
    await step(world, 2);
    expect(treeHasText(world.getTree(), "Shut Down...")).toBe(true);
    svc.push({ t: "theme", id: "xp" });
    await step(world, 2);
    expect(treeHasText(world.getTree(), "Shut Down...")).toBe(false);
    expect(reported()).toEqual(["classic", "xp", "aqua", "classic", "xp"]);

    // Lines that arrive within one frame are applied in order, and the
    // shell reports the theme the frame ends in once.
    svc.push({ t: "theme", id: "classic" });
    svc.push({ t: "theme", id: "aqua" });
    await step(world, 2);
    expect(treeHasClass(world.getTree(), AQUA_THEME.desktop)).toBe(true);
    expect(reported()).toEqual(["classic", "xp", "aqua", "classic", "xp", "aqua"]);
  }, 30000);

  test("no text of the desktop names another product", async () => {
    const svc = mockSvc();
    const provider = await testTextProvider();
    const world = await bootWorld(APP, 60, {offload: provider.ops}, svc.mutateOps);
    const guestFrame = world.frame;
    world.frame = (...args) => { provider.betweenFrames(); guestFrame(...args); };
    svc.push({ t: "hello", w: 800, h: 600, epoch: 1755650000000 });
    await step(world, 3);

    /** Text nodes on screen that carry a product name the desktop must not show. */
    const named = () =>
      treeTexts(world.getTree()).filter((text) => /Windows|MS-DOS/.test(text));
    const click = async (x: number, y: number) => {
      mouse(svc, x, y, true);
      mouse(svc, x, y, false);
      await step(world, 2);
    };

    // The welcome note mentions windows in lower case only.
    expect(named()).toEqual([]);
    svc.push({ t: "key", k: "w", cmd: true });
    await step(world, 2);

    // The theme picker under Start > Settings (its row begins at y=433).
    svc.push({ t: "key", k: "escape", cmd: true });
    await step(world, 2);
    mouse(svc, 100, 445, false);
    await step(world, 2);
    expect(treeHasText(world.getTree(), "Classic 98")).toBe(true);
    expect(named()).toEqual([]);

    // Start > Shut Down... (the last row, y 545..571) opens the dialog. Its
    // caption is the verb alone: one text node, since the dialog has no
    // task button.
    const captions = () =>
      treeTexts(world.getTree()).filter((text) => text === "Shut Down");
    await click(100, 558);
    let tree = world.getTree();
    expect(captions()).toHaveLength(1);
    expect(treeHasText(tree, "What do you want the computer to do?")).toBe(true);
    expect(named()).toEqual([]);

    // The dialog's two radio marks come from the theme: one chosen with its
    // dot, one not. Aqua paints the two rings differently.
    for (const theme of THEMES) {
      svc.push({ t: "theme", id: theme.id });
      await step(world, 2);
      tree = world.getTree();
      expect(treeHasClass(tree, theme.radioRing(true))).toBe(true);
      expect(treeHasClass(tree, theme.radioRing(false))).toBe(true);
      expect(treeHasClass(tree, theme.radioFace(true))).toBe(true);
      expect(treeHasClass(tree, theme.radioFace(false))).toBe(true);
      expect(treeHasClass(tree, theme.radioDot)).toBe(true);
      expect(captions()).toHaveLength(1);
    }
    svc.push({ t: "theme", id: "classic" });
    svc.push({ t: "key", k: "w", cmd: true });
    await step(world, 2);
    expect(captions()).toHaveLength(0);

    // My Computer is the first desktop icon; with no other window open its
    // window takes the first cascade slot. The second place of its sidebar
    // is (C:), whose listing held the folder and file type that named
    // other products.
    const metrics = CLASSIC_THEME.metrics;
    const icon = desktopIconPosition(0, desktopIconRows(600, metrics), metrics, 800);
    await click(icon.x + 37, icon.y + 16);
    await click(icon.x + 37, icon.y + 16);
    expect(treeHasText(world.getTree(), "Control Panel")).toBe(true);
    const geo = cascadePos(0, 800, 600, 560, 320, metrics);
    await click(
      geo.x + metrics.frame + 40,
      geo.y + contentTop({ menuWidths: [] }, metrics) +
        metrics.folderToolH + metrics.folderSideTop +
        metrics.folderSideRowH + metrics.folderSideRowH / 2,
    );
    const listing = treeTexts(world.getTree());
    expect(listing).toContain("Program Files");
    expect(listing.filter((text) => text === "System")).toHaveLength(1);
    expect(listing.filter((text) => text === "Batch File")).toHaveLength(1);
    expect(named()).toEqual([]);
  }, 30000);
});
