// SPDX-License-Identifier: GPL-3.0-only
// test/system-ui.test.ts — Pocket Shell Desktop: window-manager chrome math, the
// Minesweeper rules, Notepad line editing and the selection model (all
// pure). The sim boot smoke lives in test/system-ui-sim.test.ts (needs the
// solid bundle prebuilt).

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { REPOSITORY } from "../scripts/system-plan.ts";
import {
  captionButtonXs,
  captionSlots,
  clampMove,
  contentTop,
  cursorForDir,
  desktopIconAt,
  desktopIconPosition,
  desktopIconRows,
  hasWindowMenuBar,
  hitRegion,
  launcherHit,
  maximizedGeo,
  popupHeight,
  popupRowAt,
  reframeGeo,
  resizeGeo,
  startLayout,
  taskEntryIndexAt,
  taskLayout,
  type ChromeOpts,
  type Geo,
} from "../src/system-ui/wm.ts";
import {
  AQUA_THEME,
  CLASSIC_THEME,
  XP_THEME,
} from "../src/system-ui/theme.ts";
import {
  MINES_N,
  MINES_W,
  newMines,
  reveal,
  toggleFlag,
} from "../src/system-ui/mines.ts";
import {
  applyMove,
  applyMoveWrapped,
  backspace,
  caretAtPoint,
  caretXY,
  colFromX,
  del,
  deleteSel,
  docEquals,
  emptyHistory,
  hasSel,
  insertText,
  moveCaret,
  record,
  redoStep,
  rowSelSpan,
  segSelSpan,
  selectAll,
  selectedText,
  selRange,
  undoStep,
  vrowOf,
  wordRangeAt,
  wrapDoc,
  wrapLine,
  type Doc,
} from "../src/system-ui/notepad.ts";
import { POCKET_APPS } from "../src/system-ui/pocket-apps.ts";
import system from "../pocket.system.json";
import {
  validateAndResolveBuildPlan,
  validateAndResolveSystemPlan,
} from "@pocketjs/framework/manifest";

describe("Pocket app desktop catalog", () => {
  async function packageInputs() {
    const installed = new Set(system.installation.installedPackages);
    return Promise.all(
      system.applications.catalog
        .filter((entry) => installed.has(entry.package))
        .map(async (entry) => ({
          source: entry.manifest,
          manifest: await Bun.file(resolve(REPOSITORY, entry.manifest)).json(),
        })),
    );
  }

  test("the Pocket System preserves every installed package's complete resolved plan", async () => {
    expect(POCKET_APPS).toHaveLength(11);
    expect(new Set(POCKET_APPS.map((app) => app.package)).size).toBe(
      POCKET_APPS.length,
    );

    const packages = await packageInputs();
    const systemResolution = validateAndResolveSystemPlan(system, {
      target: "macos-app",
      packages,
    });
    expect(systemResolution.ok).toBe(true);
    if (!systemResolution.ok) return;
    expect(systemResolution.plan.roles.systemUI).toBe(
      "dev.pocket-nexus.desktop.system-ui",
    );
    expect(systemResolution.plan.systemUI.package).toBe(
      "dev.pocket-nexus.desktop.system-ui",
    );
    expect(systemResolution.plan.installation).toEqual({
      installedPackages: system.installation.installedPackages,
    });
    expect(systemResolution.plan.applications).toHaveLength(11);
    const resolvedPackages = [
      systemResolution.plan.systemUI,
      ...systemResolution.plan.applications,
    ];

    for (const entry of system.applications.catalog) {
      if (!system.installation.installedPackages.includes(entry.package))
        continue;
      const manifest = packages.find(
        (item) => item.source === entry.manifest,
      )!.manifest;
      const resolution = validateAndResolveBuildPlan(manifest, {
        target: "macos-app",
        role:
          entry.package === system.roles.systemUI ? "systemUI" : "application",
      });
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) continue;
      const resolved = resolvedPackages.find(
        (item) => item.package === entry.package,
      );
      expect(resolved?.plan).toEqual(resolution.plan);
    }
  });

  test("rejects duplicate artifact outputs before any package build", async () => {
    const packages = await packageInputs();
    const hero = packages.find(
      (entry) => entry.source === "vendor/pocketjs/apps/hero/pocket.json",
    )!;
    (hero.manifest as any).app.output = "settings-main";
    const result = validateAndResolveSystemPlan(system, {
      target: "macos-app",
      packages,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "system.duplicateOutput",
    );
  });

  test("keeps catalog availability separate from the installed package snapshot", async () => {
    const available = structuredClone(system);
    available.installation.installedPackages =
      available.installation.installedPackages.filter(
        (packageId) => packageId !== "dev.pocket-nexus.hero",
      );
    const packages = (await packageInputs()).filter(
      (entry) => entry.source !== "vendor/pocketjs/apps/hero/pocket.json",
    );
    const result = validateAndResolveSystemPlan(available, {
      target: "macos-app",
      packages,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(available.applications.catalog).toContainEqual(
      expect.objectContaining({ package: "dev.pocket-nexus.hero" }),
    );
    expect(result.plan.installation.installedPackages).not.toContain(
      "dev.pocket-nexus.hero",
    );
    expect(
      result.plan.applications.map((entry) => entry.package),
    ).not.toContain("dev.pocket-nexus.hero");
  });

  test("rejects installation snapshots that omit required or name unknown packages", async () => {
    const missingSystemUI = structuredClone(system);
    missingSystemUI.installation.installedPackages =
      missingSystemUI.installation.installedPackages.filter(
        (packageId) => packageId !== "dev.pocket-nexus.desktop.system-ui",
      );
    const missing = validateAndResolveSystemPlan(missingSystemUI, {
      target: "macos-app",
      packages: (await packageInputs()).filter(
        (entry) => entry.source !== "shells/desktop/pocket.json",
      ),
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.diagnostics.map((item) => item.code)).toContain(
        "system.requiredPackageNotInstalled",
      );
    }

    const unknownPackage = structuredClone(system);
    unknownPackage.installation.installedPackages.push(
      "dev.pocket-nexus.unknown",
    );
    const unknown = validateAndResolveSystemPlan(unknownPackage, {
      target: "macos-app",
      packages: await packageInputs(),
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.diagnostics.map((item) => item.code)).toContain(
        "system.installedPackageUnknown",
      );
    }
  });

  test("grants compositor surfaces only to the System UI role", async () => {
    const required = await packageInputs();
    const requiredHero = required.find(
      (entry) => entry.source === "vendor/pocketjs/apps/hero/pocket.json",
    )!;
    (requiredHero.manifest as any).engine.capabilities.requires.push(
      "ui.compositor-surfaces",
    );
    const rejected = validateAndResolveSystemPlan(system, {
      target: "macos-app",
      packages: required,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.map((item) => item.code)).toContain(
        "capability.unavailable",
      );
    }

    const enhanced = await packageInputs();
    const enhancedHero = enhanced.find(
      (entry) => entry.source === "vendor/pocketjs/apps/hero/pocket.json",
    )!;
    (enhancedHero.manifest as any).engine.capabilities.enhances.push(
      "ui.compositor-surfaces",
    );
    const accepted = validateAndResolveSystemPlan(system, {
      target: "macos-app",
      packages: enhanced,
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      const hero = accepted.plan.applications.find(
        (entry) => entry.package === "dev.pocket-nexus.hero",
      );
      expect(hero?.plan.features["ui.compositor-surfaces"]).toBe(false);
    }
  });

  test("requires a hard compositor-surface dependency from System UI", async () => {
    const packages = await packageInputs();
    const shell = packages.find(
      (entry) => entry.source === "shells/desktop/pocket.json",
    )!;
    const capabilities = (shell.manifest as any).engine.capabilities;
    capabilities.requires = capabilities.requires.filter(
      (capability: string) => capability !== "ui.compositor-surfaces",
    );
    capabilities.enhances.push("ui.compositor-surfaces");
    const result = validateAndResolveSystemPlan(system, {
      target: "macos-app",
      packages,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((item) => item.code)).toContain(
        "system.systemUICapabilityMissing",
      );
    }
  });

  test("rejects child companions until an AppInstance adapter exists", async () => {
    const packages = await packageInputs();
    const hero = packages.find(
      (entry) => entry.source === "vendor/pocketjs/apps/hero/pocket.json",
    )!;
    (hero.manifest as any).app.companions = ["note"];
    const result = validateAndResolveSystemPlan(system, {
      target: "macos-app",
      packages,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map((item) => item.code)).toContain(
        "system.childCompanionUnsupported",
      );
    }
  });

  test("sixteen desktop icons flow into non-overlapping columns above the taskbar", () => {
    const rows = desktopIconRows(600);
    expect(rows).toBe(9);
    expect(desktopIconPosition(0, rows)).toEqual({ x: 8, y: 8 });
    expect(desktopIconPosition(8, rows)).toEqual({ x: 8, y: 472 });
    expect(desktopIconPosition(9, rows)).toEqual({ x: 90, y: 8 });
    expect(desktopIconAt(45, 30, 16, rows)).toBe(0);
    expect(desktopIconAt(120, 30, 16, rows)).toBe(9);
    expect(desktopIconAt(85, 30, 16, rows)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// wm.ts — chrome hit regions
// ---------------------------------------------------------------------------

const GEO: Geo = { x: 100, y: 50, w: 400, h: 300 };
const OPTS: ChromeOpts = {
  buttons: ["min", "max", "close"],
  resizable: true,
  maximized: false,
  menuWidths: [34, 34],
};

describe("caption buttons", () => {
  test("all three buttons sit flush against each other, flush right", () => {
    const xs = captionButtonXs(400, ["min", "max", "close"]);
    // Classic close right edge: width - frame(3) - right inset(2).
    expect(xs[2] + 16).toBe(400 - 3 - 2);
    expect(xs[1]).toBe(xs[2] - 16); // no close gap
    expect(xs[0]).toBe(xs[1] - 16);
  });

  test("close-only dialogs place the single button flush right", () => {
    const xs = captionButtonXs(300, ["close"]);
    expect(xs).toEqual([300 - 3 - 2 - 16]);
  });
});

describe("dynamic theme geometry", () => {
  const classic = CLASSIC_THEME.metrics;
  const xp = XP_THEME.metrics;

  test("XP caption controls use 21px cells with 2px gaps", () => {
    const xs = captionButtonXs(400, ["min", "max", "close"], xp);
    expect(xs[2] + xp.buttonW).toBe(400 - xp.frame - xp.buttonRight);
    expect(xs[1]).toBe(xs[2] - xp.buttonGap - xp.buttonW);
    expect(xs[0]).toBe(xs[1] - xp.buttonGap - xp.buttonW);

    for (const [i, button] of (["min", "max", "close"] as const).entries()) {
      const region = hitRegion(
        GEO,
        OPTS,
        GEO.x + xs[i] + 10,
        GEO.y + xp.frame + xp.buttonTop + 10,
        xp,
      );
      expect(region).toEqual({ kind: "button", button });
    }
  });

  test("reframing preserves the exact application client viewport", () => {
    const original: Geo = { x: 64, y: 28, w: 400, h: 300 };
    const reframed = reframeGeo(original, OPTS, classic, xp);
    const client = (geo: Geo, metrics: typeof classic) => ({
      w: geo.w - metrics.frame * 2,
      h: geo.h - metrics.frame - contentTop(OPTS, metrics),
    });
    expect(client(reframed, xp)).toEqual(client(original, classic));
    expect(reframeGeo(reframed, OPTS, xp, classic)).toEqual(original);
  });

  test("XP maximize and icon rows reserve its 30px taskbar", () => {
    expect(maximizedGeo(800, 600, xp)).toEqual({
      x: 0,
      y: 0,
      w: 800,
      h: 570,
    });
    expect(desktopIconRows(600, xp)).toBe(9);
  });
});

describe("hitRegion", () => {
  test("caption bar drags, buttons claim their cells", () => {
    // Caption strip, left of the buttons.
    expect(hitRegion(GEO, OPTS, 100 + 200, 50 + 10)).toEqual({
      kind: "caption",
    });
    const xs = captionButtonXs(GEO.w, OPTS.buttons);
    for (const [i, name] of (["min", "max", "close"] as const).entries()) {
      const r = hitRegion(GEO, OPTS, 100 + xs[i] + 8, 50 + 3 + 2 + 7);
      expect(r).toEqual({ kind: "button", button: name });
    }
  });

  test("resize bands claim edges and corners with the right directions", () => {
    expect(hitRegion(GEO, OPTS, 100 + 200, 50 + 1)).toEqual({
      kind: "resize",
      dir: "n",
    });
    expect(hitRegion(GEO, OPTS, 100 + 1, 50 + 150)).toEqual({
      kind: "resize",
      dir: "w",
    });
    expect(hitRegion(GEO, OPTS, 100 + 399, 50 + 299)).toEqual({
      kind: "resize",
      dir: "se",
    });
    expect(hitRegion(GEO, OPTS, 100 + 1, 50 + 299)).toEqual({
      kind: "resize",
      dir: "sw",
    });
    expect(hitRegion(GEO, OPTS, 100 + 399, 50 + 1)).toEqual({
      kind: "resize",
      dir: "ne",
    });
  });

  test("maximized and fixed windows expose no resize bands", () => {
    const max = { ...OPTS, maximized: true };
    expect(hitRegion(GEO, max, 100 + 200, 50 + 1)).toEqual({ kind: "caption" });
    const fixed = { ...OPTS, resizable: false };
    expect(hitRegion(GEO, fixed, 100 + 399, 50 + 299)).not.toEqual({
      kind: "resize",
      dir: "se",
    });
  });

  test("menu bar items hit by accumulated widths, content below them", () => {
    const menuY = 50 + 3 + 18 + 1 + 9;
    expect(hitRegion(GEO, OPTS, 100 + 3 + 10, menuY)).toEqual({
      kind: "menu",
      index: 0,
    });
    expect(hitRegion(GEO, OPTS, 100 + 3 + 34 + 10, menuY)).toEqual({
      kind: "menu",
      index: 1,
    });
    const r = hitRegion(GEO, OPTS, 100 + 50, 50 + contentTop(OPTS) + 20);
    expect(r).toEqual({ kind: "content", cx: 47, cy: 20 });
  });

  test("outside the window misses", () => {
    expect(hitRegion(GEO, OPTS, 99, 60)).toBeNull();
    expect(hitRegion(GEO, OPTS, 100 + 400, 60)).toBeNull();
  });
});

describe("resizeGeo", () => {
  const orig: Geo = { x: 100, y: 50, w: 400, h: 300 };
  test("east/south follow the pointer, west/north anchor the far edge", () => {
    expect(resizeGeo(orig, "se", 40, 30, 200, 120)).toEqual({
      x: 100,
      y: 50,
      w: 440,
      h: 330,
    });
    const west = resizeGeo(orig, "w", 60, 0, 200, 120);
    expect(west.w).toBe(340);
    expect(west.x + west.w).toBe(orig.x + orig.w); // right edge pinned
    const north = resizeGeo(orig, "n", 0, -20, 200, 120);
    expect(north.h).toBe(320);
    expect(north.y + north.h).toBe(orig.y + orig.h);
  });

  test("minimums hold on every edge", () => {
    const tiny = resizeGeo(orig, "se", -1000, -1000, 200, 120);
    expect(tiny.w).toBe(200);
    expect(tiny.h).toBe(120);
    const wTiny = resizeGeo(orig, "nw", 1000, 1000, 200, 120);
    expect(wTiny.w).toBe(200);
    expect(wTiny.h).toBe(120);
    expect(wTiny.x + wTiny.w).toBe(orig.x + orig.w);
    expect(wTiny.y + wTiny.h).toBe(orig.y + orig.h);
  });
});

describe("clampMove / maximizedGeo", () => {
  test("the caption always stays reachable", () => {
    const g = clampMove({ x: -1000, y: -50, w: 400, h: 300 }, 800, 600);
    expect(g.x).toBe(48 - 400);
    expect(g.y).toBe(0);
    const low = clampMove({ x: 790, y: 590, w: 400, h: 300 }, 800, 600);
    expect(low.x).toBe(800 - 48);
    expect(low.y).toBe(600 - 28 - 18);
  });

  test("maximized fills the desktop above the taskbar", () => {
    expect(maximizedGeo(800, 600)).toEqual({ x: 0, y: 0, w: 800, h: 572 });
  });

  test("resize cursor kinds", () => {
    expect(cursorForDir("e")).toBe("ew");
    expect(cursorForDir("n")).toBe("ns");
    expect(cursorForDir("se")).toBe("nwse");
    expect(cursorForDir("sw")).toBe("nesw");
  });
});

// ---------------------------------------------------------------------------
// mines.ts
// ---------------------------------------------------------------------------

describe("minesweeper", () => {
  test("first reveal is always safe and plants exactly ten mines", () => {
    for (const seed of [1, 42, 1234, 987654]) {
      const m = reveal(newMines(seed), 40);
      expect(m.phase === "lost").toBe(false);
      expect(m.cells.filter((c) => c.mine).length).toBe(MINES_N);
      expect(m.cells[40].mine).toBe(false);
      expect(m.cells[40].state).toBe("revealed");
    }
  });

  test("zero-adjacency regions flood open", () => {
    // Find a seed/cell whose reveal floods more than one cell.
    const m = newMines(7);
    reveal(m, 0);
    if (m.cells[0].adj === 0) {
      expect(m.revealed).toBeGreaterThan(1);
    }
    // Whatever the layout, revealed count matches cells marked revealed.
    expect(m.cells.filter((c) => c.state === "revealed").length).toBe(
      m.revealed,
    );
  });

  test("flags toggle and never reveal", () => {
    const m = reveal(newMines(3), 0);
    const hidden = m.cells.findIndex((c) => c.state === "hidden");
    toggleFlag(m, hidden);
    expect(m.cells[hidden].state).toBe("flag");
    expect(m.flags).toBe(1);
    reveal(m, hidden); // flagged cells refuse reveal
    expect(m.cells[hidden].state).toBe("flag");
    toggleFlag(m, hidden);
    expect(m.flags).toBe(0);
  });

  test("revealing a mine loses and exposes the field; clearing all safe cells wins", () => {
    const m = reveal(newMines(11), 22);
    const mine = m.cells.findIndex((c) => c.mine);
    reveal(m, mine);
    expect(m.phase).toBe("lost");
    expect(m.bust).toBe(mine);
    expect(m.cells.filter((c) => c.mine && c.state === "revealed").length).toBe(
      MINES_N,
    );

    const w = newMines(5);
    reveal(w, 0);
    for (let i = 0; i < w.cells.length; i++) {
      if (!w.cells[i].mine) reveal(w, i);
    }
    expect(w.phase).toBe("won");
    expect(w.flags).toBe(MINES_N); // win convention: mines auto-flag
  });

  test("placement is deterministic per seed", () => {
    const a = reveal(newMines(99), 0);
    const b = reveal(newMines(99), 0);
    expect(a.cells.map((c) => c.mine)).toEqual(b.cells.map((c) => c.mine));
    expect(MINES_W).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// notepad.ts
// ---------------------------------------------------------------------------

describe("notepad editing", () => {
  const doc = { lines: ["hello", "world"], caret: { row: 0, col: 5 } };

  test("insert with newlines splits lines and lands the caret", () => {
    const d = insertText(doc, "!\nnew");
    expect(d.lines).toEqual(["hello!", "new", "world"]);
    expect(d.caret).toEqual({ row: 1, col: 3 });
  });

  test("backspace joins lines at col 0", () => {
    const d = backspace({ lines: ["ab", "cd"], caret: { row: 1, col: 0 } });
    expect(d.lines).toEqual(["abcd"]);
    expect(d.caret).toEqual({ row: 0, col: 2 });
  });

  test("delete joins the next line at the end", () => {
    const d = del({ lines: ["ab", "cd"], caret: { row: 0, col: 2 } });
    expect(d.lines).toEqual(["abcd"]);
    expect(d.caret).toEqual({ row: 0, col: 2 });
  });

  test("caret movement clamps and wraps", () => {
    expect(
      moveCaret({ lines: ["ab", "c"], caret: { row: 0, col: 2 } }, "Right"),
    ).toEqual({
      row: 1,
      col: 0,
    });
    expect(
      moveCaret({ lines: ["ab", "c"], caret: { row: 1, col: 0 } }, "Left"),
    ).toEqual({
      row: 0,
      col: 2,
    });
    expect(
      moveCaret({ lines: ["ab", "c"], caret: { row: 0, col: 2 } }, "Down"),
    ).toEqual({
      row: 1,
      col: 1,
    });
    expect(
      moveCaret({ lines: ["ab", "c"], caret: { row: 1, col: 1 } }, "End"),
    ).toEqual({
      row: 1,
      col: 1,
    });
  });

  test("colFromX picks the nearest gap by prefix midpoints", () => {
    const measure = (s: string) => s.length * 6;
    expect(colFromX("abcd", 0, measure)).toBe(0);
    expect(colFromX("abcd", 2, measure)).toBe(0); // < half of the first char
    expect(colFromX("abcd", 4, measure)).toBe(1);
    expect(colFromX("abcd", 100, measure)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// notepad.ts — undo/redo history
// ---------------------------------------------------------------------------

describe("notepad history", () => {
  const D = (s: string, col: number): Doc => ({
    lines: [s],
    caret: { row: 0, col },
  });

  test("a typing run coalesces into one undo unit; redo replays it whole", () => {
    let h = emptyHistory();
    let doc = D("", 0);
    for (const ch of ["a", "b", "c"]) {
      const next = insertText(doc, ch);
      h = record(h, doc, next, "type");
      doc = next;
    }
    expect(doc.lines).toEqual(["abc"]);
    expect(h.undo.length).toBe(1);
    const u = undoStep(h, doc)!;
    expect(u.doc.lines).toEqual([""]);
    const r = redoStep(u.h, u.doc)!;
    expect(r.doc.lines).toEqual(["abc"]);
    expect(undoStep(emptyHistory(), doc)).toBeNull();
  });

  test("a caret move between keystrokes breaks the group (tip mismatch)", () => {
    let h = emptyHistory();
    const d0 = D("xy", 2);
    const d1 = insertText(d0, "a");
    h = record(h, d0, d1, "type");
    // A plain caret move produces a doc record() never saw as its tip.
    const moved: Doc = { lines: d1.lines, caret: { row: 0, col: 0 } };
    const d2 = insertText(moved, "b");
    h = record(h, moved, d2, "type");
    expect(h.undo.length).toBe(2);
  });

  test("erase runs coalesce separately; other edits never coalesce", () => {
    let h = emptyHistory();
    let doc = D("abc", 3);
    for (let i = 0; i < 2; i++) {
      const next = backspace(doc);
      h = record(h, doc, next, "erase");
      doc = next;
    }
    expect(h.undo.length).toBe(1);
    for (let i = 0; i < 2; i++) {
      const next = insertText(doc, "\n");
      h = record(h, doc, next, "other");
      doc = next;
    }
    expect(h.undo.length).toBe(3);
  });

  test("a new edit clears redo; undo restores the selection", () => {
    let h = emptyHistory();
    const sel: Doc = {
      lines: ["hello"],
      caret: { row: 0, col: 5 },
      anchor: { row: 0, col: 0 },
    };
    const cut = deleteSel(sel);
    h = record(h, sel, cut, "other");
    const u = undoStep(h, cut)!;
    expect(u.doc.anchor).toEqual({ row: 0, col: 0 });
    expect(u.h.redo.length).toBe(1);
    const again = record(u.h, u.doc, insertText(u.doc, "!"), "type");
    expect(again.redo.length).toBe(0);
  });

  test("docEquals sees text/caret/anchor, not object identity", () => {
    expect(
      docEquals(D("a", 1), { lines: ["a"], caret: { row: 0, col: 1 } }),
    ).toBe(true);
    expect(docEquals(D("a", 1), D("a", 0))).toBe(false);
    expect(
      docEquals(D("a", 1), { lines: ["b"], caret: { row: 0, col: 1 } }),
    ).toBe(false);
    expect(
      docEquals(D("a", 1), {
        lines: ["a"],
        caret: { row: 0, col: 1 },
        anchor: { row: 0, col: 0 },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// notepad.ts — selection model
// ---------------------------------------------------------------------------

describe("notepad selection", () => {
  const sel: Doc = {
    lines: ["hello world", "second line", "third"],
    caret: { row: 1, col: 4 },
    anchor: { row: 0, col: 6 },
  };

  test("selRange orders anchor/caret either way; collapsed = none", () => {
    expect(selRange(sel)).toEqual({
      from: { row: 0, col: 6 },
      to: { row: 1, col: 4 },
    });
    const flipped: Doc = {
      ...sel,
      caret: sel.anchor as { row: number; col: number },
      anchor: sel.caret,
    };
    expect(selRange(flipped)).toEqual(selRange(sel));
    expect(
      hasSel({
        lines: ["a"],
        caret: { row: 0, col: 1 },
        anchor: { row: 0, col: 1 },
      }),
    ).toBe(false);
    expect(hasSel({ lines: ["a"], caret: { row: 0, col: 1 } })).toBe(false);
  });

  test("selectedText joins the range with newlines", () => {
    expect(selectedText(sel)).toBe("world\nseco");
    const one: Doc = {
      lines: ["hello"],
      caret: { row: 0, col: 4 },
      anchor: { row: 0, col: 1 },
    };
    expect(selectedText(one)).toBe("ell");
  });

  test("deleteSel merges the edge lines and lands the caret at the start", () => {
    const d = deleteSel(sel);
    expect(d.lines).toEqual(["hello nd line", "third"]);
    expect(d.caret).toEqual({ row: 0, col: 6 });
    expect(hasSel(d)).toBe(false);
  });

  test("typing replaces the selection; backspace/delete just remove it", () => {
    const typed = insertText(sel, "X");
    expect(typed.lines).toEqual(["hello Xnd line", "third"]);
    expect(typed.caret).toEqual({ row: 0, col: 7 });
    expect(backspace(sel).lines).toEqual(["hello nd line", "third"]);
    expect(del(sel).lines).toEqual(["hello nd line", "third"]);
  });

  test("shift extends from the caret; a plain move collapses to the edge", () => {
    const start: Doc = { lines: ["abc def"], caret: { row: 0, col: 4 } };
    const ext = applyMove(start, "Right", true);
    expect(ext.anchor).toEqual({ row: 0, col: 4 });
    expect(ext.caret).toEqual({ row: 0, col: 5 });
    const left = applyMove(sel, "Left", false);
    expect(left.caret).toEqual({ row: 0, col: 6 }); // collapse to from
    expect(hasSel(left)).toBe(false);
    const right = applyMove(sel, "Right", false);
    expect(right.caret).toEqual({ row: 1, col: 4 }); // collapse to to
  });

  test("selectAll spans the whole document", () => {
    const all = selectAll({ lines: ["ab", "cde"], caret: { row: 0, col: 0 } });
    expect(all.anchor).toEqual({ row: 0, col: 0 });
    expect(all.caret).toEqual({ row: 1, col: 3 });
    expect(selectedText(all)).toBe("ab\ncde");
  });

  test("wordRangeAt picks word, whitespace and punctuation runs", () => {
    expect(wordRangeAt("foo bar_baz!", 5)).toEqual({ from: 4, to: 11 });
    expect(wordRangeAt("foo bar", 3)).toEqual({ from: 3, to: 4 }); // the space run
    expect(wordRangeAt("a==b", 1)).toEqual({ from: 1, to: 3 }); // punct run
    expect(wordRangeAt("", 0)).toEqual({ from: 0, to: 0 });
  });

  test("word wrap: greedy word breaks, hanging spaces, char fallback", () => {
    const w6 = (s: string) => s.length * 6;
    // Row capacity 7.5 chars: "aaa bbb" fits (42px), the trailing space
    // hangs, "ccc" opens the next visual row.
    expect(wrapLine("aaa bbb ccc", 45, w6)).toEqual([
      { from: 0, to: 8 },
      { from: 8, to: 11 },
    ]);
    // Exact fit and no-wrap widths pass through as one segment.
    expect(wrapLine("aaa", 18, w6)).toEqual([{ from: 0, to: 3 }]);
    expect(wrapLine("aaa bbb ccc", Infinity, w6)).toEqual([
      { from: 0, to: 11 },
    ]);
    expect(wrapLine("", 45, w6)).toEqual([{ from: 0, to: 0 }]);
    // A word wider than a whole row breaks at character level.
    expect(wrapLine("abcdefgh", 18, w6)).toEqual([
      { from: 0, to: 3 },
      { from: 3, to: 6 },
      { from: 6, to: 8 },
    ]);
    // Segments tile the document in reading order.
    expect(wrapDoc(["aaa bbb ccc", "", "dd"], 45, w6)).toEqual([
      { row: 0, from: 0, to: 8 },
      { row: 0, from: 8, to: 11 },
      { row: 1, from: 0, to: 0 },
      { row: 2, from: 0, to: 2 },
    ]);
  });

  test("word wrap: caret ↔ visual row mapping with end affinity", () => {
    const w6 = (s: string) => s.length * 6;
    const lines = ["aaa bbb ccc"];
    const segs = wrapDoc(lines, 45, w6);
    // The wrap boundary column belongs to the next row's start by default,
    // to the earlier row's end under end affinity.
    expect(vrowOf(segs, { row: 0, col: 8 })).toBe(1);
    expect(vrowOf(segs, { row: 0, col: 8, end: true })).toBe(0);
    expect(vrowOf(segs, { row: 0, col: 3 })).toBe(0);
    expect(vrowOf(segs, { row: 0, col: 11 })).toBe(1);
    expect(caretXY(segs, lines, { row: 0, col: 9 }, w6)).toEqual({
      vrow: 1,
      x: 6,
    });
    expect(caretXY(segs, lines, { row: 0, col: 8, end: true }, w6)).toEqual({
      vrow: 0,
      x: 48,
    });
    // Clicking past a wrapped row's text keeps the caret on that row.
    expect(caretAtPoint(segs, lines, 0, 100, w6)).toEqual({
      row: 0,
      col: 8,
      end: true,
    });
    // At the last row of the line no affinity is needed.
    expect(caretAtPoint(segs, lines, 1, 100, w6)).toEqual({ row: 0, col: 11 });
  });

  test("word wrap: Up/Down step visual rows, Home/End take the row bounds", () => {
    const w6 = (s: string) => s.length * 6;
    const lines = ["aaa bbb ccc"];
    const segs = wrapDoc(lines, 45, w6);
    const doc: Doc = { lines, caret: { row: 0, col: 1 } };
    const down = applyMoveWrapped(doc, "Down", false, segs, w6);
    expect(down.caret).toEqual({ row: 0, col: 9 }); // same x, next visual row
    const up = applyMoveWrapped(
      { lines, caret: { row: 0, col: 9 } },
      "Up",
      false,
      segs,
      w6,
    );
    expect(up.caret).toEqual({ row: 0, col: 1 });
    const end = applyMoveWrapped(doc, "End", false, segs, w6);
    expect(end.caret).toEqual({ row: 0, col: 8, end: true }); // visual row end
    const home = applyMoveWrapped(
      { lines, caret: { row: 0, col: 9 } },
      "Home",
      false,
      segs,
      w6,
    );
    expect(home.caret).toEqual({ row: 0, col: 8 }); // visual row start
    const ext = applyMoveWrapped(doc, "Down", true, segs, w6);
    expect(ext.anchor).toEqual({ row: 0, col: 1 });
    expect(ext.caret).toEqual({ row: 0, col: 9 });
    // With one segment per line (wrap off) the move is the logical one.
    const flat = wrapDoc(["ab", "c"], Infinity, w6);
    const d2 = applyMoveWrapped(
      { lines: ["ab", "c"], caret: { row: 0, col: 2 } },
      "Down",
      false,
      flat,
      w6,
    );
    expect(d2.caret).toEqual({ row: 1, col: 1 });
  });

  test("word wrap: selection spans intersect visual segments", () => {
    const w6 = (s: string) => s.length * 6;
    const lines = ["aaa bbb ccc"];
    const segs = wrapDoc(lines, 45, w6);
    const doc: Doc = {
      lines,
      caret: { row: 0, col: 10 },
      anchor: { row: 0, col: 2 },
    };
    expect(segSelSpan(doc, segs[0])).toEqual({ from: 2, to: 8 });
    expect(segSelSpan(doc, segs[1])).toEqual({ from: 8, to: 10 });
    expect(
      segSelSpan(
        { lines, caret: { row: 0, col: 3 }, anchor: { row: 0, col: 1 } },
        segs[1],
      ),
    ).toBeNull();
  });

  test("rowSelSpan covers edge rows partially and middle rows fully", () => {
    const tall: Doc = {
      lines: ["aaaa", "bbbb", "cccc"],
      caret: { row: 2, col: 2 },
      anchor: { row: 0, col: 1 },
    };
    expect(rowSelSpan(tall, 0)).toEqual({ from: 1, to: 4 });
    expect(rowSelSpan(tall, 1)).toEqual({ from: 0, to: 4 });
    expect(rowSelSpan(tall, 2)).toEqual({ from: 0, to: 2 });
    expect(rowSelSpan(tall, 3)).toBeNull();
    expect(
      rowSelSpan({ lines: ["x"], caret: { row: 0, col: 0 } }, 0),
    ).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// Aqua: controls on the left, menus in a screen bar, a centered Dock
// ---------------------------------------------------------------------------

describe("aqua theme geometry", () => {
  const aqua = AQUA_THEME.metrics;
  const classic = CLASSIC_THEME.metrics;

  test("the control cluster hugs the left edge in close/min/max order", () => {
    const slots = captionSlots(400, ["min", "max", "close"], aqua);
    expect(slots.map((s) => s.button)).toEqual(["close", "min", "max"]);
    expect(slots[0].x).toBe(aqua.frame + aqua.buttonRight);
    expect(slots[1].x).toBe(slots[0].x + aqua.buttonW + aqua.buttonGap);
    expect(slots[2].x).toBe(slots[1].x + aqua.buttonW + aqua.buttonGap);
    // captionButtonXs answers in the caller's order.
    const xs = captionButtonXs(400, ["min", "max", "close"], aqua);
    expect(xs).toEqual([slots[1].x, slots[2].x, slots[0].x]);
  });

  test("missing controls keep their ghost slot but never hit", () => {
    const slots = captionSlots(300, ["close"], aqua);
    expect(slots.map((s) => [s.button, s.present])).toEqual([
      ["close", true],
      ["min", false],
      ["max", false],
    ]);
    const dialog: ChromeOpts = {
      buttons: ["close"],
      resizable: false,
      maximized: false,
      menuWidths: [],
    };
    const y = GEO.y + aqua.captionTop + aqua.buttonTop + 6;
    expect(hitRegion(GEO, dialog, GEO.x + slots[0].x + 6, y, aqua)).toEqual({
      kind: "button",
      button: "close",
    });
    expect(hitRegion(GEO, dialog, GEO.x + slots[1].x + 6, y, aqua)).toEqual({
      kind: "caption",
    });
  });

  test("the Classic cluster stays right-aligned with no ghosts", () => {
    expect(captionSlots(300, ["close"], classic)).toEqual([
      { button: "close", x: 300 - 3 - 2 - 16, present: true },
    ]);
  });

  test("a screen bar takes the menu bar out of the window", () => {
    expect(hasWindowMenuBar(OPTS, classic)).toBe(true);
    expect(hasWindowMenuBar(OPTS, aqua)).toBe(false);
    expect(contentTop(OPTS, aqua)).toBe(
      aqua.captionTop + aqua.titleH + aqua.titleGap,
    );
    // No menu region inside an Aqua window: the row under the caption is content.
    const y = GEO.y + aqua.captionTop + aqua.titleH + aqua.titleGap + 5;
    expect(hitRegion(GEO, OPTS, GEO.x + 3 + 10, y, aqua)).toEqual({
      kind: "content",
      cx: 12,
      cy: 5,
    });
    // Reframing between the two keeps the client rectangle.
    const reframed = reframeGeo(GEO, OPTS, classic, aqua);
    expect(reframed.w - aqua.frame * 2).toBe(GEO.w - classic.frame * 2);
    expect(reframed.h - aqua.frame - contentTop(OPTS, aqua)).toBe(
      GEO.h - classic.frame - contentTop(OPTS, classic),
    );
    expect(reframeGeo(reframed, OPTS, aqua, classic)).toEqual(GEO);
  });

  test("windows, dialogs and icons live between the bar and the Dock", () => {
    expect(maximizedGeo(800, 600, aqua)).toEqual({
      x: 0,
      y: 22,
      w: 800,
      h: 600 - 22 - 52,
    });
    expect(clampMove({ x: 10, y: 0, w: 200, h: 100 }, 800, 600, aqua).y).toBe(22);
    const rows = desktopIconRows(600, aqua);
    expect(rows).toBe(Math.floor((600 - 22 - 52 - 16) / 58));
    // Icons hang from the right edge, first column flush right.
    expect(desktopIconPosition(0, rows, aqua, 800)).toEqual({ x: 800 - 8 - 74, y: 30 });
    expect(desktopIconPosition(rows, rows, aqua, 800).x).toBe(800 - 8 - 74 - 82);
    expect(desktopIconAt(800 - 8 - 40, 40, 3, rows, aqua, 800)).toBe(0);
    expect(desktopIconAt(40, 40, 3, rows, aqua, 800)).toBe(-1);
    // Classic keeps its left-anchored grid untouched.
    expect(desktopIconPosition(0, 9, classic, 800)).toEqual({ x: 8, y: 8 });
  });

  test("the Dock centers its tiles and the strip keeps its left flow", () => {
    const dock = taskLayout(800, 600, 3, aqua);
    expect(dock.buttonW).toBe(aqua.taskButtonMaxW);
    const total = 3 * 44 + 2 * aqua.taskGap + aqua.taskPad * 2;
    expect(dock.x0).toBe(Math.floor((800 - total) / 2) + aqua.taskPad);
    expect(taskEntryIndexAt(dock.x0 + 44 + aqua.taskGap + 1, 570, 800, 600, 3, aqua)).toBe(1);
    expect(taskEntryIndexAt(dock.x0 - 1, 570, 800, 600, 3, aqua)).toBe(-1);
    expect(taskEntryIndexAt(dock.x0 + 1, 540, 800, 600, 3, aqua)).toBe(-1);

    const strip = taskLayout(800, 600, 2, classic);
    expect(strip.x0).toBe(
      classic.taskLeft + classic.taskStartW + classic.taskGap * 2 + classic.taskDividerW,
    );
    expect(strip.buttonW).toBe(160);
    expect(taskEntryIndexAt(strip.x0 + 5, 590, 800, 600, 2, classic)).toBe(0);
  });

  test("the launcher is the Start button or the screen-bar logo", () => {
    expect(launcherHit(10, 590, 600, classic)).toBe(true);
    expect(launcherHit(10, 5, 600, classic)).toBe(false);
    expect(launcherHit(10, 5, 600, aqua)).toBe(true);
    expect(launcherHit(10, 590, 600, aqua)).toBe(false);
    expect(launcherHit(aqua.taskStartW + 1, 5, 600, aqua)).toBe(false);
  });

  test("the launcher panel hangs from the screen bar", () => {
    const items = [{}, { sep: true }, {}];
    const layout = startLayout(items, 600, aqua);
    expect(layout.y).toBe(aqua.screenBarH);
    expect(layout.rows.map((r) => r.y)).toEqual([
      aqua.screenBarH + aqua.startPadY,
      aqua.screenBarH + aqua.startPadY + aqua.startRowH + aqua.startSepH,
    ]);
    // Aqua's highlight spans edge to edge: rows are as wide as the panel.
    expect(layout.rows[0].x).toBe(aqua.startX);
    expect(layout.rows[0].w).toBe(aqua.startW);
    const rising = startLayout(items, 600, classic);
    expect(rising.y + rising.h).toBe(600 - classic.taskH);
  });

  test("popup rows follow the theme's row, separator and padding metrics", () => {
    const items = [{}, { sep: true }, {}];
    for (const m of [classic, XP_THEME.metrics, aqua]) {
      expect(popupHeight(items, m)).toBe(m.popupPadY * 2 + m.popupRowH * 2 + m.popupSepH);
      expect(popupRowAt(items, m.popupPadX + 1, m.popupPadY + 1, 120, m)).toBe(0);
      expect(popupRowAt(items, m.popupPadX + 1, m.popupPadY + m.popupRowH + 1, 120, m)).toBe(-1);
      expect(
        popupRowAt(items, m.popupPadX + 1, m.popupPadY + m.popupRowH + m.popupSepH + 1, 120, m),
      ).toBe(2);
      if (m.popupPadX > 0) expect(popupRowAt(items, 0, m.popupPadY + 1, 120, m)).toBe(-1);
      expect(popupRowAt(items, 119, m.popupPadY + 1, 120, m)).toBe(m.popupPadX > 0 ? -1 : 0);
    }
  });
});
