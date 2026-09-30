// SPDX-License-Identifier: GPL-3.0-or-later
// test/sim.test.ts — Pocket Shell's render layer in the
// headless sim: the same button tape the Azahar golden runs, with the dock
// taps replaced by store calls (the sim has no touch screen; its auxiliary
// surface supplies the 3DS bottom screen's host root). What this proves is
// that every chord, layout toggle and workspace switch reconciles the two
// Solid trees without a renderer error, in milliseconds rather than an
// emulator boot.

import { describe, expect, test } from "bun:test";
import { bootWorld, treeHasText } from "../../../vendor/pocketjs/hosts/sim/sim.ts";
import { BTN } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import { SHELL_TAPE } from "../film/tape.ts";
import { MENU, type ShellStore } from "../src/store.ts";

const spec = SHELL_TAPE;
type World = Awaited<ReturnType<typeof bootWorld>>;

async function boot(mutateOps?: (ops: Record<string, unknown>) => void): Promise<{ world: World; store: ShellStore }> {
  const world = await bootWorld("pocketshell-main", 60, undefined, mutateOps, {
    width: 400, height: 240, auxiliary: [320, 240],
  });
  const store = (globalThis as { __pocketShell?: ShellStore }).__pocketShell;
  if (!store) throw new Error("the bundle did not publish __pocketShell");
  return { world, store };
}

describe("pocket-shell in the sim", () => {
  test("the golden tape's chords run clean", async () => {
    const { world, store } = await boot();
    // The tape's dock taps land on frames 8, 18 and 28.
    const taps: Record<number, "term" | "notes"> = { 8: "term", 18: "notes", 28: "term" };
    for (let frame = 0; frame <= spec.frames; frame++) {
      const app = taps[frame];
      if (app) store.open(app);
      // The tape's minimap hold at 186..222 closes term; the sim has no
      // touch screen, so arm and release the close bar through the store.
      if (frame === 210) store.setClosing({ id: store.order()[1], over: true });
      if (frame === 223) {
        const closing = store.closing();
        if (closing) store.close(closing.id);
        store.setClosing(null);
      }
      world.frame(spec.input!(frame));
      if (frame === 48) {
        expect(store.order().length).toBe(3);
        expect(store.focusedApp()).toBe("term");
      }
      if (frame === 60) {
        expect(store.layer()).toBe("super");
        expect(store.focusedApp()).toBe("term");
      }
      if (frame === 84) {
        // R + RIGHT swapped term with notes: term now leads nothing, notes leads.
        expect(store.windowOf(store.order()[0])?.app).toBe("notes");
        expect(store.focusedApp()).toBe("term");
      }
      if (frame === 112) expect(store.layoutKind()).toBe("scrolling");
      if (frame === 126) {
        expect(store.active()).toBe(2);
        expect(store.layer()).toBe("ws");
      }
      if (frame === 160) {
        expect(store.active()).toBe(1);
        expect(store.keysOpen()).toBe(true);
      }
      if (frame === 176) {
        expect(store.keysOpen()).toBe(false);
        expect(store.menuOpen()).toBe(true);
      }
      if (frame === 183) expect(store.menuOpen()).toBe(false);
      if (frame === 240) expect(store.order().length).toBe(2);
    }
  });

  test("every action runs against an empty and a full workspace", async () => {
    const { world, store } = await boot();
    const actions = [
      "focus.left", "focus.right", "focus.up", "focus.down",
      "swap.left", "swap.right", "swap.up", "swap.down",
      "menu", "menu", "close", "fullscreen", "fullscreen", "maximize", "maximize",
      "split", "swapsplit", "layout", "split", "swapsplit", "layout",
      "keys", "keys", "another", "reopen", "wallpaper", "bar", "bar",
      "carry.next", "carry.prev", "ws.next", "ws.prev",
    ] as const;
    world.frame(0);
    for (const action of actions) {
      store.run(action);
      world.frame(0);
    }
    for (const app of ["term", "notes", "top"] as const) store.open(app);
    for (let i = 0; i < 10; i++) world.frame(0);
    for (const action of actions) {
      store.run(action);
      for (let i = 0; i < 3; i++) world.frame(0);
    }
    store.setKbOpen(true);
    store.focusWin(store.order()[0]);
    for (let i = 0; i < 3; i++) world.frame(0);
    store.typeChar("h");
    store.typeChar("e");
    store.typeKey("tab");
    store.typeKey("enter");
    for (let i = 0; i < 3; i++) world.frame(0);
    expect(store.wm.windows.size).toBeGreaterThan(0);
  });

  test("every menu row runs and closes the menu", async () => {
    const { world, store } = await boot();
    world.frame(0);
    for (let row = 0; row < MENU.length; row++) {
      store.setMenuOpen(true);
      world.frame(0);
      const before = store.wm.windows.size;
      store.runMenu(row);
      world.frame(0);
      const item = MENU[row];
      expect(store.menuOpen()).toBe(false);
      if (item.kind === "app") {
        expect(store.wm.windows.size).toBe(before + 1);
        expect(store.focusedApp()).toBe(item.app);
      }
      if (item.kind === "action" && item.action === "about") expect(store.toast()).toContain("Pocket Shell");
      if (item.kind === "action" && item.action === "keys") store.run("keys");
    }
  });

  test("a term shows its own command after the command moves focus", async () => {
    const { world, store } = await boot();
    const term = store.open("term");
    const notes = store.open("notes");
    store.focusWin(term);
    idle(world, 3);
    for (const ch of `focus ${notes}`) store.typeChar(ch);
    store.typeKey("enter");
    idle(world, 3);
    expect(store.focusedId()).toBe(notes);
    expect(treeHasText(world.getTree(), `❯ focus ${notes}`)).toBe(true);
  });

  test("a carried window slides in with its workspace", async () => {
    const counts = new Map<unknown, number>();
    let recording = false;
    const { world, store } = await boot((ops) => {
      const animate = ops.animate as (...args: unknown[]) => unknown;
      ops.animate = (...args: unknown[]) => {
        if (recording) counts.set(args[0], (counts.get(args[0]) ?? 0) + 1);
        return animate(...args);
      };
    });
    store.open("term");
    idle(world, 20);
    recording = true;
    store.run("carry.next");
    idle(world, 3);
    expect(store.active()).toBe(2);
    // translate, scale and opacity on the carried window's node.
    expect(Math.max(0, ...counts.values())).toBeGreaterThanOrEqual(5);
  });

  test("idle frames and typing leave the shell revision alone", async () => {
    const { world, store } = await boot();
    const term = store.open("term");
    idle(world, 20);
    const rev = store.rev();
    const applet = store.appletRev(term);
    idle(world, 30);
    expect(store.rev()).toBe(rev);
    store.typeChar("x");
    expect(store.rev()).toBe(rev);
    expect(store.appletRev(term)).toBe(applet + 1);
  });

  test("the toast, ghost and close-bar timers are superseded, not raced", async () => {
    const { world, store } = await boot();
    // A toast lasts 1.8 s (108 frames); a newer message restarts the count.
    store.say("a");
    idle(world, 60);
    store.say("b");
    idle(world, 50);
    expect(store.toast()).toBe("b");
    idle(world, 60);
    expect(store.toast()).toBe("");

    // A closed window's ghost is gone after 170 ms.
    const term = store.open("term");
    idle(world, 20);
    store.close(term);
    expect(store.ghosts().length).toBe(1);
    idle(world, 12);
    expect(store.ghosts().length).toBe(0);

    // The close bar sinks for 100 ms after release; re-arming inside that
    // window keeps it up, and so does a release with nothing held.
    const id = store.open("term");
    idle(world, 20);
    store.setClosing({ id, over: false });
    idle(world, 3);
    store.setClosing(null);
    idle(world, 3);
    store.setClosing({ id, over: false });
    idle(world, 5);
    expect(store.closeBarShown()).toBe(true);
    store.setClosing(null);
    store.setClosing(null);
    idle(world, 3);
    expect(store.closeBarShown()).toBe(true);
    idle(world, 5);
    expect(store.closeBarShown()).toBe(false);
  });

  test("the menu is driven with buttons: L + A, the d-pad clamps, A runs", async () => {
    const { world, store } = await boot();
    idle(world, 2);
    press(world, BTN.CIRCLE, BTN.LTRIGGER);
    expect(store.menuOpen()).toBe(true);
    expect(store.menuIndex()).toBe(0);
    for (let i = 0; i < MENU.length + 2; i++) press(world, BTN.DOWN);
    expect(store.menuIndex()).toBe(MENU.length - 1);
    press(world, BTN.CIRCLE);
    expect(store.menuOpen()).toBe(false);
    expect(store.toast()).toContain("Pocket Shell");
  });
});

function idle(world: World, frames: number): void {
  for (let i = 0; i < frames; i++) world.frame(0);
}

/** One press of `button` (down a frame, up a frame) while `held` stays down. */
function press(world: World, button: number, held = 0): void {
  world.frame(held);
  world.frame(held | button);
  world.frame(held);
  world.frame(0);
}
