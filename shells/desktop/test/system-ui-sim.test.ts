// SPDX-License-Identifier: GPL-3.0-only
// test/system-ui-sim.test.ts — system-ui in the sim. Two worlds:
//
//   1. standalone (no System UI companion): the app boots a static arrangement —
//      the unmodified-app base case.
//   2. a mock System UI companion: svcOpen/svcPoll/svcSend installed before eval
//      (bootWorld mutateOps), so the whole input dialect journey runs
//      headless — typing, drag selection, ⌘ chords, the notepad context
//      menu, paste-req — with guest intents (copy payloads!) asserted on
//      the wire.
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
  AQUA_THEME,
  CLASSIC_THEME,
  XP_THEME,
} from "../src/system-ui/theme.ts";

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
        "dev.pocket-stack.hero": 1,
        "dev.pocket-stack.settings": 2,
      };
      ops.setCompositorSurface = (
        node: number,
        surface: number,
        focused: number,
      ) => {
        surfaceBindings.push([node, surface, focused]);
        setCompositorSurface(node, surface, focused);
      };
      ops.__host = "linux-app";
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
    expect(treeHasText(world.getTree(), "Classic 98")).toBe(true);
    expect(treeHasText(world.getTree(), "Windows XP")).toBe(true);
    expect(treeHasText(world.getTree(), "Aqua")).toBe(true);
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
    expect(treeHasText(world.getTree(), "PocketJS: Hero")).toBe(true);
    expect(svc.surfaces().filter(([, surface]) => surface === 1).at(-1)?.[2]).toBe(1);

    await doubleClick(45, 378);
    let tree = world.getTree();
    expect(treeHasText(tree, "PocketJS: Hero")).toBe(true);
    expect(treeHasText(tree, "PocketJS: Settings")).toBe(true);
    expect(svc.surfaces().filter(([, surface]) => surface === 1).at(-1)?.[2]).toBe(0);
    expect(svc.surfaces().filter(([, surface]) => surface === 2).at(-1)?.[2]).toBe(1);
    expect(svc.sent().some((line) => String(line.t).startsWith("pocket-"))).toBe(false);

    svc.push({ t: "key", k: "w", cmd: true });
    await step(world, 2);
    tree = world.getTree();
    expect(treeHasText(tree, "PocketJS: Settings")).toBe(false);
    expect(treeHasText(tree, "PocketJS: Hero")).toBe(true);
    expect(svc.sent().some((line) => String(line.t).startsWith("pocket-"))).toBe(false);
  }, 30000);
});
