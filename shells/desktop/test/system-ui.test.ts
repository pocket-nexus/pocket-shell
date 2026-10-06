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
  isThemeId,
  nextThemeId,
  themeById,
  THEMES,
  XP_THEME,
  type DesktopTheme,
} from "../src/system-ui/theme.ts";
import { parseClassLiteral } from "../../../vendor/pocketjs/framework/compiler/tailwind.ts";
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
import {
  DEFAULT_WINDOW_TITLE_PREFIX,
  DESKTOP_ABOUT,
  DESKTOP_NAME,
  POCKET_APPS,
  WINDOW_TITLE_PREFIX,
  aboutBody,
  appWindowTitle,
  pocketAppByPackage,
  readAbout,
  readWindowTitlePrefix,
} from "../src/system-ui/pocket-apps.ts";
import { appTitle, applyLang, lw, themeWord, wordsIn } from "../src/system-ui/words.ts";
import { DESK_LABEL_MAX_W, desktopLabelShift, desktopLabelText, fitLabel } from "../src/system-ui/chrome.tsx";
import about from "../pocket.about.json";
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

  test("the desktop takes its name from the System manifest's title", () => {
    expect(DESKTOP_NAME).toBe(system.title);
    expect(DESKTOP_NAME).toBe("Pocket Shell Desktop");
  });

  test("the About dialog takes its text from pocket.about.json", () => {
    expect(DESKTOP_ABOUT).toEqual({ ...about, translations: {} });
    // This repository's file describes the shell.
    expect(DESKTOP_ABOUT).toEqual({
      body: [
        "A desktop compositor demo on the portable Rust backend.",
        "SolidJS JSX over the same DrawList the",
        "consoles boot; windows, menus and shortcuts",
        "live in the guest.",
      ],
      link: "github.com/pocket-nexus/pocket-shell",
      translations: {},
    });
  });

  test("an app's window is titled with the product's prefix, PocketJS unless pocket.about.json names another", () => {
    // This repository's file names none.
    expect("windowTitlePrefix" in about).toBe(false);
    expect(DEFAULT_WINDOW_TITLE_PREFIX).toBe("PocketJS");
    expect(WINDOW_TITLE_PREFIX).toBe("PocketJS");
    expect(appWindowTitle("Hero")).toBe("PocketJS: Hero");

    expect(readWindowTitlePrefix({ windowTitlePrefix: "Pocket Desktop" })).toBe(
      "Pocket Desktop",
    );
    expect(appWindowTitle("My Games", "Pocket Desktop")).toBe(
      "Pocket Desktop: My Games",
    );
    // Spaces around the value are not part of it.
    expect(readWindowTitlePrefix({ windowTitlePrefix: "  Desk " })).toBe("Desk");
    // An empty prefix is a choice: the app's title stands alone.
    expect(readWindowTitlePrefix({ windowTitlePrefix: "" })).toBe("");
    expect(readWindowTitlePrefix({ windowTitlePrefix: "   " })).toBe("");
    expect(appWindowTitle("My Games", "")).toBe("My Games");
    // A field of another type, and a file that is no object, read as absent.
    for (const value of [
      { windowTitlePrefix: 3 },
      { windowTitlePrefix: null },
      { windowTitlePrefix: ["Desk"] },
      {},
      [],
      null,
      undefined,
      "text",
    ])
      expect(readWindowTitlePrefix(value)).toBe("PocketJS");
    // The About text reads the same with the field beside it.
    expect(
      readAbout({
        body: ["One line."],
        link: "example.org",
        windowTitlePrefix: "Desk",
      }),
    ).toEqual({ body: ["One line."], link: "example.org", translations: {} });
  });

  test("an About file may leave out its body, its link or both", () => {
    expect(readAbout({ body: ["One line."], link: "example.org" })).toEqual({
      body: ["One line."],
      link: "example.org",
      translations: {},
    });
    expect(readAbout({ body: ["One line."] })).toEqual({
      body: ["One line."],
      link: "",
      translations: {},
    });
    expect(readAbout({ link: "example.org" })).toEqual({
      body: [],
      link: "example.org",
      translations: {},
    });
    // Entries that are not strings are dropped; a body or link of another
    // type reads as absent.
    expect(readAbout({ body: ["a", 1, null, "b"], link: 2 })).toEqual({
      body: ["a", "b"],
      link: "",
      translations: {},
    });
    expect(readAbout({ body: "One line." })).toEqual({ body: [], link: "", translations: {} });
    for (const value of [{}, [], null, undefined, "text", 3])
      expect(readAbout(value)).toEqual({ body: [], link: "", translations: {} });
  });

  test("an About file may carry its body in other languages", () => {
    const read = readAbout({
      body: ["One line."],
      translations: { ja: { body: ["一行。", 2] }, fr: "texte", de: { link: "x" } },
    });
    expect(read.translations).toEqual({ ja: ["一行。"] });
    expect(aboutBody(read, "ja")).toEqual(["一行。"]);
    // A language the file does not carry shows the body as written.
    expect(aboutBody(read, "en")).toEqual(["One line."]);
    expect(aboutBody(read, "fr")).toEqual(["One line."]);
  });

  test("the shell's words: one key set in each language, and the lang line", () => {
    expect(Object.keys(wordsIn("ja")).sort()).toEqual(Object.keys(wordsIn("en")).sort());
    for (const [key, value] of Object.entries(wordsIn("ja"))) {
      if (typeof value === "string") expect([key, value.length > 0]).toEqual([key, true]);
    }
    expect(wordsIn("ja").notepadTitle("README.TXT")).toBe("README.TXT - メモ帳");
    expect(wordsIn("ja").about("Pocket Nexus")).toBe("Pocket Nexus について");
    expect(wordsIn("en").about("Pocket Nexus")).toBe("About Pocket Nexus");

    expect(lw().start).toBe("Start");
    expect(applyLang("de")).toBe(false);
    expect(applyLang("ja", { "dev.pocket-nexus.hero": "ヒーロー", other: 3 })).toBe(true);
    expect(lw().start).toBe("スタート");
    expect(appTitle({ package: "dev.pocket-nexus.hero", title: "Hero" })).toBe("ヒーロー");
    expect(appTitle({ package: "dev.pocket-nexus.other", title: "Other" })).toBe("Other");
    expect(themeWord("Address")).toBe("アドレス");
    expect(themeWord("Classic 98")).toBe("Classic 98");
    // The same line again changes nothing; English gives the manifest titles back.
    expect(applyLang("ja", { "dev.pocket-nexus.hero": "ヒーロー" })).toBe(false);
    expect(applyLang("en")).toBe(true);
    expect(appTitle({ package: "dev.pocket-nexus.hero", title: "Hero" })).toBe("Hero");
  });

  test("a desktop label wider than its column is cut until it is selected, and stays on the screen", () => {
    const measure = (text: string) => [...text].length * 11;
    expect(desktopLabelText("ごみ箱", false, measure)).toBe("ごみ箱");
    const cut = desktopLabelText("インストールガイド", false, measure);
    expect(cut.endsWith("...")).toBe(true);
    expect(measure(cut)).toBeLessThanOrEqual(DESK_LABEL_MAX_W);
    expect(desktopLabelText("インストールガイド", true, measure)).toBe("インストールガイド");
    // With no icon beside it in the next column: the whole name, moved onto the screen.
    expect(desktopLabelText("インストールガイド", false, measure, false)).toBe("インストールガイド");
    // A label as wide as its cell or narrower stays centred.
    expect(desktopLabelShift(8, 74, 800)).toBe(0);
    // A wide label beside the left edge moves right until it starts 2px in.
    expect(8 + (74 - 100) / 2 + desktopLabelShift(8, 100, 800)).toBe(2);
    // Beside the right edge it moves left until it ends 2px in.
    const x = 800 - 8 - 74;
    expect(x + (74 - 100) / 2 + desktopLabelShift(x, 100, 800) + 100).toBe(798);
  });

  test("a host open line resolves installed apps only", () => {
    expect(pocketAppByPackage("dev.pocket-nexus.hero")).toEqual({
      package: "dev.pocket-nexus.hero",
      title: "Hero",
      viewport: [640, 360],
    });
    for (const app of POCKET_APPS)
      expect(pocketAppByPackage(app.package)).toBe(app);
    // The System UI is installed but has no presentation: it is not an app.
    expect(pocketAppByPackage(system.roles.systemUI)).toBeUndefined();
    expect(pocketAppByPackage("dev.pocket-nexus.missing")).toBeUndefined();
    expect(pocketAppByPackage("")).toBeUndefined();
    expect(pocketAppByPackage(undefined)).toBeUndefined();
    expect(pocketAppByPackage(1)).toBeUndefined();
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

describe("themes", () => {
  test("the picker labels name no other product", () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(["classic", "xp", "aqua"]);
    expect(THEMES.map((theme) => theme.label)).toEqual([
      "Classic 98",
      "XP",
      "Aqua",
    ]);
  });

  test("a theme line's id is checked against the themes", () => {
    for (const theme of THEMES) {
      expect(isThemeId(theme.id)).toBe(true);
      expect(themeById(theme.id)).toBe(theme);
    }
    for (const value of ["luna", "XP", "", 0, null, undefined, {}])
      expect(isThemeId(value)).toBe(false);
    expect(nextThemeId("classic")).toBe("xp");
    expect(nextThemeId("aqua")).toBe("classic");
  });
});

describe("content parts", () => {
  /** Every class literal a theme can return for the content parts. */
  function contentLiterals(theme: DesktopTheme): Record<string, string> {
    const both = [false, true];
    const out: Record<string, string> = {
      listWell: theme.listWell,
      scrollTrack: theme.scrollTrack,
      scrollThumb: theme.scrollThumb,
      groupBox: theme.groupBox,
      groupLabel: theme.groupLabel,
      groupLabelText: theme.groupLabelText,
      fieldWell: theme.fieldWell,
      radioDot: theme.radioDot,
      progressTrack: theme.progressTrack,
      progressFill: theme.progressFill,
      optionRow: theme.optionRow,
    };
    for (const on of both) {
      for (const zebra of both)
        out[`listRow(${on},${zebra})`] = theme.listRow(on, zebra);
      out[`listText(${on})`] = theme.listText(on);
      out[`listDetailText(${on})`] = theme.listDetailText(on);
      out[`radioRing(${on})`] = theme.radioRing(on);
      out[`radioFace(${on})`] = theme.radioFace(on);
      out[`contentButton(${on})`] = theme.contentButton(on);
    }
    return out;
  }

  test("every theme fills every content part with a class the compiler accepts", () => {
    for (const theme of THEMES) {
      for (const [part, literal] of Object.entries(contentLiterals(theme))) {
        // A literal the compiler rejects compiles to no style at all, so a
        // typo would paint nothing without failing the build.
        expect(`${theme.id} ${part}: ${parseClassLiteral(literal) !== null}`)
          .toBe(`${theme.id} ${part}: true`);
      }
    }
  });

  test("the metrics mirror the literals a program lays text out against", () => {
    for (const theme of THEMES) {
      const m = theme.metrics;
      expect(theme.scrollTrack).toContain(`w-[${m.scrollW}]`);
      expect(theme.groupBox).toContain(`px-[${m.groupPadX}]`);
      expect(theme.listWell).toContain(`p-[${m.listPad}]`);
    }

  });

  test("a launcher row's inset and arrow are the row's padding, icon slot and gaps", () => {
    for (const theme of THEMES) {
      const m = theme.metrics;
      const cls = theme.startItem(false);
      const px = (name: string) => Number(cls.match(new RegExp(`\\b${name}-\\[(\\d+)\\]`))?.[1] ?? 0);
      const gap = px("gap");
      const icon = theme.launcherIcons || m.startHeaderH > 0 ? 16 + gap : 0;
      expect(m.startRowInset).toBe(px("pl") + px("pr") + icon);
      expect(m.startArrowW).toBe(8 + gap);
      if (theme.taskShowLabel) {
        const task = theme.taskButton(false);
        const tpx = (name: string) => Number(task.match(new RegExp(`\\b${name}-\\[(\\d+)\\]`))?.[1] ?? 0);
        expect(m.taskButtonInset).toBe(tpx("px") * 2 + 16 + tpx("gap"));
      }
    }
  });

  test("the controls a Pocket app presses carry the focus and pressed variants", () => {
    for (const theme of THEMES) {
      expect(theme.optionRow).toContain(" focus:");
      for (const primary of [false, true]) {
        expect(theme.contentButton(primary)).toContain(" focus:");
        expect(theme.contentButton(primary)).toContain(" active:");
        // The button sizes to its label above the dialog button's width.
        expect(theme.contentButton(primary)).toContain("min-w-[75] h-[23]");
        expect(theme.dialogButton(false, primary)).toContain("w-[75] h-[23]");
      }
    }
  });

  test("a selected list row and its text differ from an unselected one in every theme", () => {
    for (const theme of THEMES) {
      expect(theme.listRow(true, false)).not.toBe(theme.listRow(false, false));
      expect(theme.listText(true)).not.toBe(theme.listText(false));
      expect(theme.listDetailText(true)).not.toBe(theme.listDetailText(false));
    }
    // Only Aqua stripes its lists.
    expect(AQUA_THEME.listRow(false, true)).not.toBe(AQUA_THEME.listRow(false, false));
    expect(CLASSIC_THEME.listRow(false, true)).toBe(CLASSIC_THEME.listRow(false, false));
    expect(XP_THEME.listRow(false, true)).toBe(XP_THEME.listRow(false, false));
  });

  test("Classic keeps the radio mark the Shut Down dialog drew before the part existed", () => {
    for (const checked of [false, true]) {
      expect(CLASSIC_THEME.radioRing(checked)).toBe(
        "w-[12] h-[12] rounded-full bg-[#808080] flex-col justify-center items-center",
      );
      expect(CLASSIC_THEME.radioFace(checked)).toBe(
        "w-[10] h-[10] rounded-full bg-[#ffffff] flex-col justify-center items-center",
      );
    }
    expect(CLASSIC_THEME.radioDot).toBe("w-[4] h-[4] rounded-full bg-[#000000]");
  });
});

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

  test("the XP panel grows to its widest row, and keeps its width when the rows fit", () => {
    const xp = XP_THEME.metrics;
    const items = [{}, { sep: true }, {}, { col: "right" as const }, { col: "right" as const }, { foot: true }];
    // English rows fit the theme's 172 + 130.
    const fits = startLayout(items, 600, xp, () => 120);
    expect(fits.w).toBe(xp.startW);
    expect(fits.leftW).toBe(xp.startLeftW);
    // A places row 166 wide (「マイ ドキュメント」 with its arrow) widens the
    // places column, and the frame, the header and the strip with it.
    const wide = startLayout(items, 600, xp, (i) => (i === 3 ? 166 : 120));
    expect(wide.leftW).toBe(xp.startLeftW);
    expect(wide.rightW).toBe(166);
    expect(wide.w).toBe(xp.startPadX * 2 + xp.startLeftW + 166);
    const right = wide.rows.find((r) => r.index === 3)!;
    expect(right.x + right.w).toBe(wide.x + wide.w - xp.startPadX);
    const foot = wide.rows.find((r) => r.index === 5)!;
    expect(foot.x + foot.w).toBe(wide.x + wide.w - xp.startPadX);
    // A programs row wider than 172 widens the programs column.
    const left = startLayout(items, 600, xp, (i) => (i === 0 ? 200 : 120));
    expect(left.leftW).toBe(200);
    expect(left.w).toBe(xp.startPadX * 2 + 200 + xp.startW - xp.startLeftW - xp.startPadX * 2);
  });

  test("past its maximum the panel gives back the places column's growth first", () => {
    const xp = XP_THEME.metrics;
    const items = [{}, { col: "right" as const }];
    const capped = startLayout(items, 600, xp, (i) => (i === 0 ? 220 : 240), 400);
    expect(capped.w).toBe(400);
    expect(capped.leftW).toBe(220);
    expect(capped.rightW).toBe(400 - 220 - xp.startPadX * 2);
    // Never narrower than the theme's own panel.
    expect(startLayout(items, 600, xp, () => 500, 100).w).toBe(xp.startW);
  });

  test("a one-column launcher grows to its widest row beside its rail", () => {
    const items = [{}, { sep: true }, {}];
    expect(startLayout(items, 600, classic, () => 100).w).toBe(classic.startW);
    const wide = startLayout(items, 600, classic, (i) => (i === 2 ? 190 : 100));
    expect(wide.w).toBe(190 + classic.startPadX * 2 + classic.startRailW);
    expect(wide.rows[1].w).toBe(190);
    expect(startLayout(items, 600, classic, () => 900, 300).w).toBe(300);
    expect(startLayout(items, 600, aqua, (i) => (i === 0 ? 240 : 100)).w).toBe(240);
  });

  test("a label is cut with ... only when it is wider than its room", () => {
    const measure = (text: string) => [...text].length * 10;
    expect(fitLabel("マイ ドキュメント", 90, measure)).toBe("マイ ドキュメント");
    expect(fitLabel("マイ ドキュメント", 70, measure)).toBe("マイ ド...");
    // a cut never leaves a space before the dots
    expect(fitLabel("マイ ドキュメント", 60, measure)).toBe("マイ...");
    expect(measure(fitLabel("インストールガイド", 55, measure))).toBeLessThanOrEqual(55);
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
