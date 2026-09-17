// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/app.tsx — Pocket Shell's theme-switchable System UI and
// compositor shell — SolidJS, authored in JSX
// (SolidJS universal renderer, the same path as apps/hero).
//
// The compositor owns ALL input: the host forwards raw mouse/keyboard over
// the desk svc dialect (svc.ts), and this file routes every event itself —
// window drags, resizes, caption buttons, menus, text selection, program
// content — against the same geometry the chrome renders (wm.ts +
// programs.tsx helpers). The framework's focus/onPress pipeline is never
// engaged; a window manager IS its own hit tester. Window moves ride
// paint-only translate props, raises ride zIndex, so a drag never relayouts
// and an idle desktop hashes stable for the demand-render governor.
//
// Shortcuts are macOS-style: the host forwards ⌘ chords as cmd-flagged key
// lines (⌘Q quits and ⌘V pastes host-side) — ⌘W closes, ⌘M minimizes,
// ⌘` cycles, ⌘N opens a window or restarts the focused game, ⌘Esc toggles
// Start, ⌘A/C/X edit the
// focused Notepad. Pocket app input and scheduling are owned by the native
// compositor using the focused surface fact emitted by this shell.
//
// Without the System UI companion (sim, goldens, consoles) the app boots a
// static arrangement and just renders it — the unmodified-app base case.

import { DevicesView } from "./devices-view.tsx";
import { createDeviceInventory, createDevicesWindow, type DevicesData } from "./devices.ts";
import { For, onCleanup } from "solid-js";
import { createPadLayout } from "./layout.ts";
import { createState } from "./reactivity.ts";
import { Image, View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { virtualNow } from "@pocketjs/framework/clock";
import { connectSvc, type CursorKind, type HostEvent } from "./svc.ts";
import {
  cascadePos,
  clampMove,
  contentTop,
  cursorForDir,
  desktopIconAt,
  desktopIconRows,
  hitRegion,
  launcherHit,
  maximizedGeo,
  menuIndexAt,
  menuTitleX,
  popupHeight,
  popupRowAt,
  reframeGeo,
  resizeGeo,
  startLayout,
  startRowAt,
  taskEntryIndexAt,
  taskLayout,
  type CaptionButton,
  type Dir,
  type Geo,
  type Region,
  type StartRow,
} from "./wm.ts";
import {
  createWin,
  PLACES,
  MAC_PLACES,
  type AboutData,
  type DeskIcon,
  type FolderData,
  type FolderRow,
  type MinesData,
  type PadData,
  type Place,
  type PlaceId,
  type PocketData,
  type Popup,
  type PopupItem,
  type ShutdownData,
  type TaskEntry,
  type WinCtl,
} from "./state.ts";
import {
  ABOUT_GEO,
  AboutView,
  aboutHit,
  FolderView,
  folderHit,
  folderToolEnabled,
  measure,
  MINES_GEO,
  MinesView,
  minesHit,
  NotepadView,
  PAD_LINE_H,
  padSegs,
  padWidthFor,
  padWrapW,
  PocketAppView,
  SHUTDOWN_GEO,
  ShutdownView,
  shutdownHit,
} from "./programs.tsx";
import {
  applyMoveWrapped,
  backspace,
  caretAtPoint,
  caretXY,
  del,
  deleteSel,
  docEquals,
  emptyHistory,
  hasSel,
  insertText,
  record,
  redoStep,
  selectAll,
  selectedText,
  undoStep,
  wordRangeAt,
  type Caret,
  type CaretMove,
  type Doc,
  type EditKind,
} from "./notepad.ts";
import { newMines, reveal, toggleFlag } from "./mines.ts";
import { POCKET_APPS, type PocketAppSpec } from "./pocket-apps.ts";
import {
  CLASSIC_THEME,
  nextThemeId,
  THEMES,
  themeById,
  type DesktopTheme,
  type FolderTool,
  type IconName,
  type ThemeId,
} from "./theme.ts";
import {
  CaptionButtons,
  DesktopIcons,
  PopupPanel,
  ScreenBar,
  StartMenu,
  StartPanel,
  UiText,
  Taskbar,
} from "./chrome.tsx";

const WELCOME = [
  "Welcome to Pocket Shell.",
  "",
  "The desktop shell is one PocketJS guest. Every Pocket app icon starts another isolated QuickJS guest in the same PocketJS host process; each guest keeps its own globals, UI tree and fixed clock.",
  "",
  "Word wrap is on (Edit > Word Wrap) - these paragraphs are single logical lines; resize the window and they reflow live.",
  "",
  "Things to try:",
  "  - drag windows by the title bar",
  "  - drag any edge or corner to resize",
  "  - double-click a title bar to maximize",
  "  - drag-select this text; Cmd+C/X/V, right-click",
  "  - right-click the desktop or Minesweeper",
  "  - Cmd+` cycles windows, Cmd+W closes them",
  "  - Cmd+Esc opens the Start menu",
  "",
  "The font is W95FA, baked to the same atlas format every other PocketJS target reads.",
];

type Drag =
  | { type: "move"; id: number; sx: number; sy: number; orig: Geo }
  | { type: "resize"; id: number; dir: Dir; sx: number; sy: number; orig: Geo }
  | { type: "capbtn"; id: number; btn: CaptionButton }
  | { type: "textsel"; id: number }
  | { type: "minehold"; id: number }
  | { type: "smiley"; id: number }
  | { type: "dialogbtn"; id: number; tag: string }
  | { type: "toolbtn"; id: number; tool: FolderTool }
  | null;

// Program data bags (typed views of w.data for render + routing).
const devicesOf = (w: WinCtl) => w.data as DevicesData;
const padOf = (w: WinCtl) => w.data as PadData;
const minesOf = (w: WinCtl) => w.data as MinesData;
const folderOf = (w: WinCtl) => w.data as FolderData;
const pocketOf = (w: WinCtl) => w.data as PocketData;
const aboutOf = (w: WinCtl) => w.data as AboutData;
const shutdownOf = (w: WinCtl) => w.data as ShutdownData;

/** One window: raised frame, caption gradient, controls, menu bar, and the
 *  program content dispatched on the (static) window kind. Position/size
 *  ride the style prop — translate moves are paint-only, and zIndex raises
 *  without reordering siblings (a reorder would rebuild the layout tree).
 *  The control cluster sits on the theme's `buttonSide`; the opposite side
 *  gets the theme's balancing spacer (Aqua centers its title). A theme with
 *  a screen bar takes the menu bar out of the window. */
function DesktopWindow(props: {
  win: WinCtl;
  active: boolean;
  theme: DesktopTheme;
}) {
  const w = props.win;
  return (
    <View
      class={props.theme.windowFrame(props.active, w.maximized())}
      style={{
        insetL: 0,
        insetT: 0,
        width: w.geo().w,
        height: w.geo().h,
        translateX: w.geo().x,
        translateY: w.geo().y,
        zIndex: w.z(),
        opacity: w.minimized() ? 0 : 1,
      }}
    >
      {props.theme.windowLayers(props.active).map((cls) => (
        <View class={cls} />
      ))}
      <View class={props.theme.caption(props.active)}>
        {props.theme.captionLayers(props.active, w.maximized()).map((cls) => (
          <View class={cls} />
        ))}
        {props.theme.metrics.buttonSide === "left" ? (
          <CaptionButtons win={w} active={props.active} theme={props.theme} />
        ) : props.theme.captionSpacer !== "" ? (
          <View class={props.theme.captionSpacer} />
        ) : null}
        <View class={props.theme.captionTitleBox}>
          <Image class={props.theme.captionIcon} src={props.theme.icon(w.icon(), 16)} />
          <UiText
            theme={props.theme}
            bold
            cls={props.theme.captionTitle(props.active)}
            t={w.title()}
          />
        </View>
        {props.theme.metrics.buttonSide === "right" ? (
          <CaptionButtons win={w} active={props.active} theme={props.theme} />
        ) : props.theme.captionSpacer !== "" ? (
          <View class={props.theme.captionSpacer} />
        ) : null}
      </View>
      <View class={props.theme.windowInner}>
        {w.menus !== null && props.theme.metrics.screenBarH === 0 ? (
          <View class={props.theme.menuBar}>
            {(w.menus ?? []).map((menu, i) => (
              <View
                class={props.theme.menuItem(w.openMenu() === i)}
              >
                <UiText
                  theme={props.theme}
                  cls={props.theme.menuText(w.openMenu() === i)}
                  t={menu.label}
                />
              </View>
            ))}
          </View>
        ) : null}
        <View class={props.theme.windowBody}>
          {w.kind === "devices" ? (
            <DevicesView data={devicesOf(w)} theme={props.theme} active={props.active} />
          ) : w.kind === "notepad" ? (
            <NotepadView
              data={padOf(w)}
              wrapW={padWrapW(w, props.theme.metrics.frame)}
              viewH={w.geo().h}
              active={props.active}
              theme={props.theme}
            />
          ) : w.kind === "mines" ? (
            <MinesView data={minesOf(w)} theme={props.theme} />
          ) : w.kind === "folder" ? (
            <FolderView
              data={folderOf(w)}
              resizable={w.resizable}
              active={props.active}
              theme={props.theme}
            />
          ) : w.kind === "pocket" ? (
            <PocketAppView
              data={pocketOf(w)}
              active={props.active}
              theme={props.theme}
            />
          ) : w.kind === "about" ? (
            <AboutView data={aboutOf(w)} theme={props.theme} />
          ) : (
            <ShutdownView data={shutdownOf(w)} theme={props.theme} />
          )}
        </View>
      </View>
    </View>
  );
}

export default function App(props: { macDesktop?: boolean }) {
  const svc = connectSvc();
  const macDesktop = props.macDesktop ?? false;
  const inventory = createDeviceInventory();

  const vp = createState<{ w: number; h: number }>({ w: 800, h: 600 });
  const wins = createState<WinCtl[]>([]);
  const focusId = createState(-1);
  const iconSel = createState(-1);
  const startOpen = createState(false);
  const startHover = createState(-1);
  const startFly = createState<{ index: number; popup: Popup } | null>(null);
  const flyHover = createState(-1);
  const popup = createState<{ popup: Popup; winId?: number } | null>(null);
  const popupHover = createState(-1);
  const clock = createState("--:--");
  const themeId = createState<ThemeId>(macDesktop ? "aqua" : "classic");
  const theme = () => themeById(themeId());
  const metrics = () => theme().metrics;
  const uiSlot = () => theme().fontSlot("ui");
  /** Hit width of one menu title: its label in the UI face plus the theme's
   *  title padding on both sides (mirrors menuItem's px-[…]). */
  const menuW = (label: string) =>
    measure(label, uiSlot()) + metrics().menuPadX * 2;

  // Non-reactive input state (nothing renders from these directly).
  let stack: number[] = []; // window ids, bottom → top
  let drag: Drag = null;
  let mx = 0;
  let my = 0;
  let prevDown = false;
  let epoch = 0; // wall ms at hello, anchored to virtualNow() then
  let epochAt = 0;
  let lastCursor: CursorKind = "default";
  let lastClick = { key: "", t: -1, x: 0, y: 0 };
  let lastCaret = { x: -1, y: -1, h: 0 };
  let minesStart = 0;
  let taskMotionUntil = 0;

  const byId = (id: number) => wins().find((w) => w.id === id);
  const focused = () => byId(focusId());

  // ---- window management ----------------------------------------------------

  function applyZ() {
    stack.forEach((id, i) => {
      const w = byId(id);
      if (w) w.z.set(i + 1);
    });
  }

  function raise(id: number) {
    stack = stack.filter((x) => x !== id).concat(id);
    applyZ();
    focusId.set(id);
    const w = byId(id);
    if (w?.minimized()) w.minimized.set(false);
  }

  function addWin(w: WinCtl) {
    wins.set(wins().concat(w));
    stack = stack.concat(w.id);
    applyZ();
    focusId.set(w.id);
  }

  const layouts = new Map<number, ReturnType<typeof createPadLayout>>();
  onCleanup(() => { for (const layout of layouts.values()) layout.dispose(); });

  function closeWin(id: number) {
    layouts.get(id)?.dispose(); layouts.delete(id);
    wins.set(wins().filter((w) => w.id !== id));
    stack = stack.filter((x) => x !== id);
    applyZ();
    focusId.set(stack.length > 0 ? stack[stack.length - 1] : -1);
  }

  function minimize(id: number) {
    const w = byId(id);
    if (w) w.minimized.set(true);
    const next = stack.filter((x) => x !== id && !byId(x)?.minimized());
    focusId.set(next.length > 0 ? next[next.length - 1] : -1);
  }

  function toggleMax(w: WinCtl) {
    if (!w.resizable) return;
    if (w.maximized()) {
      w.maximized.set(false);
      if (w.restoreGeo) w.geo.set(w.restoreGeo);
    } else {
      w.restoreGeo = w.geo();
      w.maximized.set(true);
      w.geo.set(maximizedGeo(vp().w, vp().h, metrics()));
    }
  }

  function cycleWindows() {
    const visible = stack.filter((id) => !byId(id)?.minimized());
    if (visible.length < 2) return;
    raise(visible[0]); // bottom-most visible comes up — repeated ⌘` cycles
  }

  /** Keep each window's client rectangle stable while chrome metrics change.
   *  This is required for child CompositorSurfaces: their logical viewport
   *  must remain exact across a theme switch. */
  function setTheme(nextId: ThemeId) {
    if (nextId === themeId()) return;
    const previous = metrics();
    const next = themeById(nextId).metrics;
    themeId.set(nextId);
    for (const w of wins()) {
      // Menu-bar hit widths were measured in the outgoing face.
      for (const menu of w.menus ?? []) menu.width = menuW(menu.label);
      const opts = chromeOpts(w);
      const minimum = reframeGeo(
        { x: 0, y: 0, w: w.minW, h: w.minH },
        opts,
        previous,
        next,
      );
      w.minW = minimum.w;
      w.minH = minimum.h;
      if (w.restoreGeo)
        w.restoreGeo = reframeGeo(w.restoreGeo, opts, previous, next);
      if (w.maximized()) {
        w.geo.set(maximizedGeo(vp().w, vp().h, next));
        continue;
      }
      w.geo.set(clampMove(
        reframeGeo(w.geo(), opts, previous, next),
        vp().w,
        vp().h,
        next,
      ));
    }
    closeMenus();
  }

  // ---- clipboard (notepad selection ↔ host) ---------------------------------

  function focusedPad(): { w: WinCtl; d: PadData } | null {
    const w = focused();
    return w?.kind === "notepad" ? { w, d: padOf(w) } : null;
  }

  function copySel(): void {
    const p = focusedPad();
    if (!p) return;
    const text = selectedText(p.d.doc());
    if (text !== "" && svc) svc.send({ t: "copy", text });
  }

  function cutSel(): void {
    const p = focusedPad();
    if (!p || !hasSel(p.d.doc())) return;
    copySel();
    applyEdit(p.w, "other", deleteSel(p.d.doc()));
  }

  function pasteReq(): void {
    // The clipboard lives host-side; the paste line answers next frame.
    svc?.send({ t: "paste-req" });
  }

  function selectAllIn(w: WinCtl): void {
    const d = padOf(w);
    d.doc.set(selectAll(d.doc()));
  }

  // ---- programs ---------------------------------------------------------------

  function deviceViewport(w: WinCtl) {
    const g = w.geo();
    return {
      w: g.w - metrics().frame * 2,
      h: g.h - metrics().frame - contentTop(chromeOpts(w), metrics()),
    };
  }

  function fitDesktopGeo(geo: Geo): Geo {
    const w = Math.min(geo.w, vp().w - 16);
    const h = Math.min(geo.h, vp().h - metrics().screenBarH - metrics().taskH - 16);
    return { ...geo, w, h,
      x: Math.max(8, Math.min(geo.x, vp().w - w - 8)),
      y: Math.max(metrics().screenBarH + 8, Math.min(geo.y, vp().h - metrics().taskH - h - 8)),
    };
  }

  function openDevices(newWindow = false) {
    const existing = wins().find(w => w.kind === "devices");
    if (existing && !newWindow) return raise(existing.id);
    const w = createWin({
      kind: "devices", title: "Devices", icon: "devices",
      geo: fitDesktopGeo(cascadePos(wins().length, vp().w, vp().h, 660, 450, metrics())),
      minW: 560, minH: 380,
    });
    const data = createDevicesWindow(inventory, () => deviceViewport(w), () => svc?.send({ t: "devices-refresh" }));
    w.data = data;
    w.menus = [
      { label: "File", width: menuW("File"), items: () => [
        { label: "New Window", shortcut: "Cmd+N", act: () => openDevices(true) },
        { label: "Close Window", shortcut: "Cmd+W", act: () => closeWin(w.id) },
      ] },
      { label: "View", width: menuW("View"), items: () => [
        { label: "All Devices", act: () => data.go("all") },
        { label: "Game Consoles", act: () => data.go("handheld") },
        { label: "Media Players", act: () => data.go("media-player") },
        { label: "Expand Categories", checked: data.expanded(), act: () => data.expanded.set(!data.expanded()) },
        { label: "Refresh", shortcut: "Cmd+R", act: data.refresh },
      ] },
    ];
    addWin(w);
  }

  function openNotepad(title: string, content: string[]) {
    const existing = wins().find(
      (w) => w.kind === "notepad" && w.title() === title,
    );
    if (existing) return raise(existing.id);
    const data: PadData = {
      kind: "notepad",
      doc: createState<Doc>({
        lines: content.length > 0 ? content : [""],
        caret: { row: 0, col: 0 },
      }),
      scroll: createState(0),
      preedit: createState<{ s: string; c: number } | null>(null),
      wrap: createState(true),
      hist: emptyHistory(),
      layout: createState<PadData["layout"] extends () => infer T ? T : never>({ status: "pending", lines: [], rows: [], width: 0, slot: -1 }),
    };
    const w = createWin({
      kind: "notepad",
      title,
      icon: "notepad",
      geo: cascadePos(
        wins().length,
        vp().w,
        vp().h,
        400,
        300,
        metrics(),
      ),
      minW: 220,
      minH: 140,
      menus: [
        {
          label: "File",
          width: menuW("File"),
          items: () => [
            {
              label: "New",
              act: () => {
                applyEdit(w, "other", {
                  lines: [""],
                  caret: { row: 0, col: 0 },
                });
              },
            },
            { sep: true, label: "" },
            {
              label: "Exit",
              shortcut: "Cmd+W",
              act: () => {
                closeWin(w.id);
              },
            },
          ],
        },
        {
          label: "Edit",
          width: menuW("Edit"),
          items: () => [
            {
              label: "Undo",
              shortcut: "Cmd+Z",
              disabled: data.hist.undo.length === 0,
              act: () => {
                undoIn(w);
              },
            },
            {
              label: "Redo",
              shortcut: "Cmd+Shift+Z",
              disabled: data.hist.redo.length === 0,
              act: () => {
                redoIn(w);
              },
            },
            { sep: true, label: "" },
            {
              label: "Cut",
              shortcut: "Cmd+X",
              disabled: !hasSel(data.doc()),
              act: cutSel,
            },
            {
              label: "Copy",
              shortcut: "Cmd+C",
              disabled: !hasSel(data.doc()),
              act: copySel,
            },
            { label: "Paste", shortcut: "Cmd+V", act: pasteReq },
            {
              label: "Select All",
              shortcut: "Cmd+A",
              act: () => {
                selectAllIn(w);
              },
            },
            { sep: true, label: "" },
            {
              label: "Time/Date",
              shortcut: "F5",
              act: () => {
                insertTimeDate(w);
              },
            },
            { sep: true, label: "" },
            {
              label: "Word Wrap",
              checked: data.wrap(),
              act: () => {
                data.wrap.set(!data.wrap());
                scrollCaretIntoView(w);
              },
            },
          ],
        },
        {
          label: "Help",
          width: menuW("Help"),
          items: () => [{ label: "About Pocket Shell", act: openAbout }],
        },
      ],
      data,
    });
    layouts.set(w.id, createPadLayout(w));
    addWin(w);
  }

  function openMines() {
    const existing = wins().find((w) => w.kind === "mines");
    if (existing) return raise(existing.id);
    const data: MinesData = {
      kind: "mines",
      board: createState(newMines((virtualNow() * 1000) | 0), false),
      held: createState(-1),
      smileyHeld: createState(false),
      elapsed: createState(0),
    };
    const outer = reframeGeo(
      { x: 0, y: 0, w: MINES_GEO.w, h: MINES_GEO.h },
      {
        menuWidths: [menuW("Game"), menuW("Help")],
      },
      CLASSIC_THEME.metrics,
      metrics(),
    );
    const w = createWin({
      kind: "mines",
      title: "Minesweeper",
      icon: "mines",
      geo: {
        ...cascadePos(
          wins().length,
          vp().w,
          vp().h,
          outer.w,
          outer.h,
          metrics(),
        ),
      },
      buttons: ["min", "close"],
      resizable: false,
      menus: [
        {
          label: "Game",
          width: menuW("Game"),
          items: () => [
            {
              label: "New",
              shortcut: "F2",
              act: () => {
                minesNew(w);
              },
            },
            { sep: true, label: "" },
            {
              label: "Exit",
              shortcut: "Cmd+W",
              act: () => {
                closeWin(w.id);
              },
            },
          ],
        },
        {
          label: "Help",
          width: menuW("Help"),
          items: () => [{ label: "About Pocket Shell", act: openAbout }],
        },
      ],
      data,
    });
    addWin(w);
  }

  function openPocketApp(app: PocketAppSpec) {
    const existing = wins().find(
      (w) => w.kind === "pocket" && pocketOf(w).app.package === app.package,
    );
    if (existing) return raise(existing.id);
    const data: PocketData = {
      kind: "pocket",
      app,
    };
    // Content is exactly the child plan's logical viewport. Native surface
    // composition therefore needs no scale or second raster pass.
    const m = metrics();
    const outerW = app.viewport[0] + m.frame * 2;
    const outerH =
      app.viewport[1] + contentTop({ menuWidths: [] }, m) + m.frame;
    const w = createWin({
      kind: "pocket",
      title: `PocketJS: ${app.title}`,
      icon: "pocket",
      geo: cascadePos(
        wins().length,
        vp().w,
        vp().h,
        outerW,
        outerH,
        m,
      ),
      buttons: ["min", "close"],
      resizable: false,
      minW: outerW,
      minH: outerH,
      data,
    });
    addWin(w);
  }

  function minesNew(w: WinCtl) {
    const d = minesOf(w);
    d.board.set(newMines((virtualNow() * 1000) | 0));
    d.elapsed.set(0);
    minesStart = 0;
  }

  /** Rows of a place, with row actions bound to the window that shows
   *  them: drives and folders navigate in place, documents open Notepad. */
  function placeRows(id: PlaceId, w: WinCtl): FolderRow[] {
    if (macDesktop) {
      if (id === "computer") return MAC_PLACES.slice(1).map(place => ({
        icon: place.icon, name: place.label, size: "", type: "Folder",
        open: () => navigate(w, place.id),
      }));
      if (id === "drivec") return [
        { icon: "files", name: "Files", size: "", type: "Application", open: () => openFolder("computer", true) },
        { icon: "devices", name: "Devices", size: "", type: "Application", open: () => openDevices() },
        { icon: "mines", name: "Minesweeper", size: "", type: "Application", open: openMines },
      ];
      if (id === "documents") return [{
        icon: "notepad", name: "welcome.txt", size: "1 KB", type: "Text Document",
        open: () => openNotepad("welcome.txt - Notepad", [
          "Welcome to Pocket Shell.", "",
          "Open Files, Devices and Minesweeper from the desktop or Applications folder.", "",
          "Drag a title bar to move a window. Use the Dock to switch apps or restore a minimized window.", "",
          "Cmd+N opens another Files or Devices window. Cmd+W closes the focused window; Cmd+M minimizes it.", "",
          "These sample folders belong to the Pocket Shell desktop.",
        ]),
      }];
      return [];
    }
    switch (id) {
      case "computer":
        return [
          {
            icon: "drive",
            name: "(C:)",
            size: "",
            type: "Local Disk",
            open: () => {
              navigate(w, "drivec");
            },
          },
          { icon: "cdrom", name: "(D:)", size: "", type: "CD-ROM Disc" },
          { icon: "folder", name: "Control Panel", size: "", type: "System Folder" },
          { icon: "folder", name: "Printers", size: "", type: "System Folder" },
        ];
      case "drivec":
        return [
          { icon: "folder", name: "Program Files", size: "", type: "File Folder" },
          { icon: "folder", name: "Windows", size: "", type: "File Folder" },
          {
            icon: "folder",
            name: "My Documents",
            size: "",
            type: "File Folder",
            open: () => {
              navigate(w, "documents");
            },
          },
          { icon: "file", name: "AUTOEXEC.BAT", size: "1 KB", type: "MS-DOS Batch File" },
          { icon: "file", name: "CONFIG.SYS", size: "1 KB", type: "System file" },
          {
            icon: "notepad",
            name: "README.TXT",
            size: "2 KB",
            type: "Text Document",
            open: () => {
              openNotepad("README.TXT - Notepad", WELCOME);
            },
          },
        ];
      case "documents":
        return [
          {
            icon: "notepad",
            name: "welcome.txt",
            size: "1 KB",
            type: "Text Document",
            open: () => {
              openNotepad("welcome.txt - Notepad", WELCOME);
            },
          },
        ];
      case "recycle":
        return [];
    }
  }

  function placeOf(id: PlaceId): Place {
    const places = macDesktop ? MAC_PLACES : PLACES;
    return places.find((p) => p.id === id) ?? places[0];
  }

  /** Point a folder window at another place: title, icon, rows, selection.
   *  Pushes onto the history unless the move IS a history step. */
  function navigate(w: WinCtl, id: PlaceId, push = true) {
    const d = folderOf(w);
    const place = placeOf(id);
    if (push && d.place() !== id) {
      const h = d.hist();
      d.hist.set({ items: [...h.items.slice(0, h.at + 1), id], at: h.at + 1 });
    }
    d.place.set(id);
    d.rows.set(placeRows(id, w));
    d.selected.set(-1);
    w.title.set(macDesktop ? `${place.label} - Files` : place.label);
    w.icon.set(macDesktop ? "files" : place.icon);
  }

  /** The place a toolbar action leads to, or null when it does not apply. */
  function folderToolTarget(w: WinCtl, tool: FolderTool): PlaceId | null {
    const d = folderOf(w);
    if (!folderToolEnabled(d, tool)) return null;
    const h = d.hist();
    if (tool === "back") return h.items[h.at - 1];
    if (tool === "forward") return h.items[h.at + 1];
    // Up: (C:) and the Recycle Bin hang off My Computer, My Documents off (C:).
    return !macDesktop && d.place() === "documents" ? "drivec" : "computer";
  }

  function runFolderTool(w: WinCtl, tool: FolderTool) {
    const target = folderToolTarget(w, tool);
    if (target === null) return;
    const d = folderOf(w);
    if (tool === "back") d.hist.set({ ...d.hist(), at: d.hist().at - 1 });
    else if (tool === "forward")
      d.hist.set({ ...d.hist(), at: d.hist().at + 1 });
    navigate(w, target, tool === "up");
  }

  /** Raise the window already showing `id`, or open one there. */
  function openFolder(id: PlaceId, newWindow = false) {
    const existing = wins().find(
      (w) => w.kind === "folder" && folderOf(w).place() === id,
    );
    if (existing && !newWindow) return raise(existing.id);
    const place = placeOf(id);
    const data: FolderData = {
      kind: "folder",
      places: macDesktop ? MAC_PLACES : PLACES,
      place: createState<PlaceId>(id),
      rows: createState<FolderRow[]>([]),
      selected: createState(-1),
      hist: createState({ items: [id], at: 0 }),
      toolHeld: createState<FolderTool | null>(null),
    };
    const w = createWin({
      kind: "folder",
      title: macDesktop ? `${place.label} - Files` : place.label,
      icon: macDesktop ? "files" : place.icon,
      geo: cascadePos(wins().length, vp().w, vp().h, 560, 320, metrics()),
      minW: 380,
      minH: 180,
      data,
    });
    if (macDesktop) w.menus = [
      { label: "File", width: menuW("File"), items: () => [
        { label: "New Window", shortcut: "Cmd+N", act: () => openFolder(data.place(), true) },
        { label: "Open", shortcut: "Enter", disabled: !data.rows()[data.selected()]?.open,
          act: () => data.rows()[data.selected()]?.open?.() },
        { label: "Close Window", shortcut: "Cmd+W", act: () => closeWin(w.id) },
      ] },
      { label: "Go", width: menuW("Go"), items: () => [
        { label: "Back", disabled: !folderToolEnabled(data, "back"), act: () => runFolderTool(w, "back") },
        { label: "Forward", disabled: !folderToolEnabled(data, "forward"), act: () => runFolderTool(w, "forward") },
        { label: "Enclosing Folder", disabled: !folderToolEnabled(data, "up"), act: () => runFolderTool(w, "up") },
        { sep: true, label: "" },
        ...data.places.map(place => ({ label: place.label, act: () => navigate(w, place.id) })),
      ] },
    ];
    data.rows.set(placeRows(id, w));
    addWin(w);
  }

  const openMyComputer = () => openFolder("computer");
  const openDocuments = () => openFolder("documents");
  const openRecycle = () => openFolder("recycle");

  function openAbout() {
    const existing = wins().find((w) => w.kind === "about");
    if (existing) return raise(existing.id);
    const data: AboutData = { kind: "about", armed: createState<string | null>(null) };
    const w = createWin({
      kind: "about",
      title: "About Pocket Shell",
      icon: "computer",
      geo: centered(ABOUT_GEO.w, ABOUT_GEO.h),
      buttons: ["close"],
      resizable: false,
      data,
    });
    addWin(w);
  }

  function openShutdown() {
    const existing = wins().find((w) => w.kind === "shutdown");
    if (existing) return raise(existing.id);
    const data: ShutdownData = {
      kind: "shutdown",
      choice: createState(0),
      armed: createState<string | null>(null),
    };
    const w = createWin({
      kind: "shutdown",
      title: "Shut Down Windows",
      icon: "shutdown",
      geo: centered(SHUTDOWN_GEO.w, SHUTDOWN_GEO.h),
      buttons: ["close"],
      resizable: false,
      data,
    });
    addWin(w);
  }

  function centered(w: number, h: number): Geo {
    const outer = reframeGeo(
      { x: 0, y: 0, w, h },
      { menuWidths: [] },
      CLASSIC_THEME.metrics,
      metrics(),
    );
    const bar = metrics().screenBarH;
    return {
      x: Math.max(0, Math.round((vp().w - outer.w) / 2)),
      y: Math.max(
        bar,
        bar + Math.round((vp().h - bar - metrics().taskH - outer.h) / 2),
      ),
      w: outer.w,
      h: outer.h,
    };
  }

  function restartSession() {
    for (const w of wins().slice()) closeWin(w.id);
    boot();
  }

  function insertTimeDate(w: WinCtl) {
    const d = padOf(w);
    const t = new Date(epoch + (virtualNow() - epochAt) * 1000);
    const stamp = `${pad2(t.getHours())}:${pad2(t.getMinutes())} ${pad2(t.getMonth() + 1)}/${pad2(t.getDate())}/${t.getFullYear()}`;
    applyEdit(w, "other", insertText(d.doc(), stamp));
  }

  // ---- desktop icons + start menu ----------------------------------------------

  const icons: DeskIcon[] = macDesktop ? [
    { icon: "devices", label: "Devices", open: () => openDevices() },
    { icon: "files", label: "Files", open: () => openFolder("computer") },
    { icon: "mines", label: "Minesweeper", open: openMines },
  ] : [
    { icon: "computer", label: "My Computer", open: openMyComputer },
    { icon: "documents", label: "My Documents", open: openDocuments },
    { icon: "recycle", label: "Recycle Bin", open: openRecycle },
    {
      icon: "notepad",
      label: "Notepad",
      open: () => {
        openNotepad("Untitled - Notepad", [""]);
      },
    },
    { icon: "mines", label: "Minesweeper", open: openMines },
    ...POCKET_APPS.map((app): DeskIcon => ({
      icon: "pocket",
      label: app.title,
      open: () => openPocketApp(app),
    })),
  ];

  function iconAt(x: number, y: number): number {
    return desktopIconAt(
      x,
      y,
      icons.length,
      desktopIconRows(vp().h, metrics()),
      metrics(),
      vp().w,
    );
  }

  /** Programs flyout contents — the Classic "Programs" submenu and the XP
   *  panel's "All Programs" share one list. */
  const programItems = (): PopupItem[] => [
    {
      label: "Notepad",
      icon: "notepad",
      act: () => {
        openNotepad("Untitled - Notepad", [""]);
      },
    },
    { label: "Minesweeper", icon: "mines", act: openMines },
    ...POCKET_APPS.map((app): PopupItem => ({
      label: app.title,
      icon: "pocket",
      act: () => openPocketApp(app),
    })),
  ];

  const themeItems = (): PopupItem[] =>
    THEMES.map((item) => ({
      label: item.label,
      checked: item.id === themeId(),
      act: () => {
        setTheme(item.id);
      },
    }));

  const documentItems = (): PopupItem[] => [
    {
      label: "welcome.txt",
      icon: "notepad",
      act: () => {
        openNotepad("welcome.txt - Notepad", WELCOME);
      },
    },
  ];

  /** XP's panel: pinned programs and recent apps on the left, places and
   *  system entries on the right, Turn Off Computer in the bottom strip. */
  const xpStartItems = (): PopupItem[] => [
    {
      label: "Notepad",
      icon: "notepad",
      act: () => {
        openNotepad("Untitled - Notepad", [""]);
      },
    },
    { label: "Minesweeper", icon: "mines", act: openMines },
    { sep: true, label: "" },
    ...POCKET_APPS.slice(0, 5).map((app): PopupItem => ({
      label: app.title,
      icon: "pocket",
      act: () => openPocketApp(app),
    })),
    { sep: true, label: "", bottom: true },
    {
      label: "All Programs",
      icon: "folder",
      bottom: true,
      sub: programItems(),
    },
    {
      label: "My Documents",
      icon: "folder",
      col: "right",
      sub: documentItems(),
    },
    {
      label: "My Computer",
      icon: "computer",
      col: "right",
      act: openMyComputer,
    },
    { sep: true, label: "", col: "right" },
    {
      label: "Settings",
      icon: "settings",
      col: "right",
      sub: themeItems(),
    },
    {
      label: "Help",
      icon: "help",
      col: "right",
      act: openAbout,
    },
    { sep: true, label: "", col: "right" },
    {
      label: "Run...",
      icon: "run",
      col: "right",
      disabled: true,
    },
    {
      label: "Turn Off Computer",
      icon: "power",
      foot: true,
      act: openShutdown,
    },
  ];

  const classicStartItems = (): PopupItem[] => [
    {
      label: "Programs",
      icon: "folder",
      sub: [
        {
          label: "Notepad",
          icon: "notepad",
          act: () => {
            openNotepad("Untitled - Notepad", [""]);
          },
        },
        { label: "Minesweeper", icon: "mines", act: openMines },
        ...POCKET_APPS.map((app): PopupItem => ({
          label: app.title,
          icon: "pocket",
          act: () => openPocketApp(app),
        })),
      ],
    },
    {
      label: "Documents",
      icon: "folder",
      sub: [
        {
          label: "welcome.txt",
          icon: "notepad",
          act: () => {
            openNotepad("welcome.txt - Notepad", WELCOME);
          },
        },
      ],
    },
    {
      label: "Settings",
      icon: "settings",
      sub: THEMES.map((item) => ({
        label: item.label,
        checked: item.id === themeId(),
        act: () => {
          setTheme(item.id);
        },
      })),
    },
    { label: "Find", icon: "find", disabled: true },
    { label: "Help", icon: "help", act: openAbout },
    { label: "Run...", icon: "run", disabled: true },
    { sep: true, label: "" },
    { label: "Shut Down...", icon: "shutdown", act: openShutdown },
  ];

  /** Aqua's logo menu: About first, the places and the theme picker, the
   *  session commands last — the shape of the menu under the mark. */
  const aquaStartItems = (): PopupItem[] => [
    { label: "About Pocket Shell", act: openAbout },
    { sep: true, label: "" },
    { label: "Programs", icon: "folder", sub: programItems() },
    { label: "Documents", icon: "documents", sub: documentItems() },
    { label: "My Computer", icon: "computer", act: openMyComputer },
    { sep: true, label: "" },
    { label: "Settings", icon: "settings", sub: themeItems() },
    { sep: true, label: "" },
    { label: "Shut Down...", icon: "shutdown", act: openShutdown },
  ];

  const startItems = (): PopupItem[] => {
    if (macDesktop) return [
      { label: "About Pocket Shell", act: openAbout },
      { sep: true, label: "" },
      { label: "Files", icon: "files", act: () => openFolder("computer") },
      { label: "Devices", icon: "devices", act: () => openDevices() },
      { label: "Minesweeper", icon: "mines", act: openMines },
      { label: "Appearance", icon: "settings", sub: themeItems() },
      { sep: true, label: "" },
      { label: "Shut Down...", icon: "shutdown", act: openShutdown },
    ];
    const style = theme().startStyle;
    if (style === "panel") return xpStartItems();
    if (style === "menu") return aquaStartItems();
    return classicStartItems();
  };

  /** The panel rectangle both the render and hit testing read. */
  const startGeo = () => startLayout(startItems(), vp().h, metrics());

  function startItemAt(x: number, y: number): number {
    return startRowAt(startGeo(), x, y);
  }

  function buildPopup(x: number, y: number, items: PopupItem[]): Popup {
    let w = 0;
    for (const it of items) {
      if (it.sep) continue;
      w = Math.max(
        w,
        26 +
          measure(it.label, uiSlot()) +
          (it.shortcut ? 20 + measure(it.shortcut, uiSlot()) : 0) +
          (it.sub ? 14 : 0) +
          14,
      );
    }
    const h = popupHeight(items, metrics());
    return {
      x: Math.min(x, vp().w - w - 2),
      y: Math.max(
        metrics().screenBarH,
        Math.min(y, vp().h - metrics().taskH - h),
      ),
      w: Math.max(w, 120),
      items,
    };
  }

  function popupItemAt(p: Popup, x: number, y: number): number {
    return popupRowAt(p.items, x - p.x, y - p.y, p.w, metrics());
  }

  /** Whether a point lies on the popup panel itself (rows, separators or
   *  padding). A flyout overlaps the launcher panel it grew from, so while
   *  the pointer is on the flyout the rows underneath must not react. */
  function popupContains(p: Popup, x: number, y: number): boolean {
    return (
      x >= p.x &&
      x < p.x + p.w &&
      y >= p.y &&
      y < p.y + popupHeight(p.items, metrics())
    );
  }

  function closeMenus() {
    startOpen.set(false);
    startFly.set(null);
    popup.set(null);
    startHover.set(-1);
    flyHover.set(-1);
    popupHover.set(-1);
    for (const w of wins()) w.openMenu.set(-1);
  }

  function toggleStart() {
    popup.set(null);
    startOpen.set(!startOpen());
    if (!startOpen()) {
      startFly.set(null);
      startHover.set(-1);
      flyHover.set(-1);
    }
  }

  // ---- menus ----------------------------------------------------------------------

  /** Program name the screen bar shows beside the logo — the focused
   *  window's program, or the shell's own when nothing is focused. */
  function appNameOf(w: WinCtl | undefined): string {
    if (!w) return "Pocket Shell";
    if (w.kind === "notepad") return "Notepad";
    if (w.kind === "mines") return "Minesweeper";
    if (w.kind === "folder") return "Files";
    if (w.kind === "devices") return "Devices";
    if (w.kind === "pocket") return pocketOf(w).app.title;
    return "Pocket Shell";
  }

  /** Left x of the first menu title in the screen bar: after the logo and
   *  the program name (bold face plus the screenBarApp px-[8] pads). */
  function screenMenuX0(): number {
    const name = appNameOf(focused());
    return (
      metrics().taskStartW +
      (name !== "" ? measure(name, theme().fontSlot("bold")) + 16 : 0)
    );
  }

  /** Where a menu title's dropdown hangs: under the window's own bar, or
   *  under the screen bar when the theme hoists menus there. */
  function menuPopupOrigin(w: WinCtl, index: number): { x: number; y: number } {
    const widths = (w.menus ?? []).map((m) => m.width);
    if (metrics().screenBarH > 0)
      return {
        x: menuTitleX(index, screenMenuX0(), widths),
        y: metrics().screenBarH,
      };
    const g = w.geo();
    return {
      x: menuTitleX(index, g.x + metrics().frame, widths),
      y:
        g.y +
        metrics().captionTop +
        metrics().titleH +
        metrics().titleGap +
        metrics().menuH,
    };
  }

  /** Menu title under the pointer for the window whose dropdown is open. */
  function menuTitleAt(w: WinCtl, x: number, y: number): number {
    if (!w.menus) return -1;
    if (metrics().screenBarH > 0) {
      if (y >= metrics().screenBarH || focusId() !== w.id) return -1;
      return menuIndexAt(x, screenMenuX0(), w.menus.map((m) => m.width));
    }
    const r = hitRegion(w.geo(), chromeOpts(w), x, y, metrics());
    return r?.kind === "menu" ? r.index : -1;
  }

  function openWindowMenu(w: WinCtl, index: number) {
    const open = w.openMenu() === index ? -1 : index;
    w.openMenu.set(open);
    if (open >= 0 && w.menus) {
      const o = menuPopupOrigin(w, open);
      popup.set({
        popup: buildPopup(o.x, o.y, w.menus[open].items()),
        winId: w.id,
      });
    }
  }

  // ---- helpers ------------------------------------------------------------------

  function chromeOpts(w: WinCtl) {
    return {
      buttons: w.buttons,
      resizable: w.resizable,
      maximized: w.maximized(),
      menuWidths: (w.menus ?? []).map((m) => m.width),
    };
  }

  /** Topmost visible window under the point, with its chrome region. */
  function hitWindows(
    x: number,
    y: number,
  ): { win: WinCtl; region: Region } | null {
    for (let i = stack.length - 1; i >= 0; i--) {
      const w = byId(stack[i]);
      if (!w || w.minimized()) continue;
      const region = hitRegion(w.geo(), chromeOpts(w), x, y, metrics());
      if (region) return { win: w, region };
    }
    return null;
  }

  function isDblClick(key: string): boolean {
    const now = virtualNow();
    const hit =
      lastClick.key === key &&
      now - lastClick.t < 0.4 &&
      Math.abs(mx - lastClick.x) < 4 &&
      Math.abs(my - lastClick.y) < 4;
    lastClick = hit
      ? { key: "", t: -1, x: 0, y: 0 }
      : { key, t: now, x: mx, y: my };
    return hit;
  }

  function pad2(n: number): string {
    return String(n).padStart(2, "0");
  }

  function sendCursor(k: CursorKind) {
    if (svc && k !== lastCursor) {
      lastCursor = k;
      svc.send({ t: "cursor", k });
    }
  }

  /** Notepad caret for a content-local point, over the wrapped layout
   *  (visual row from y, column from x inside that segment). */
  function padCaretAt(w: WinCtl, cx: number, cy: number): Caret {
    const d = padOf(w);
    if (padSegs(w, metrics().frame, uiSlot()).length === 0) return d.doc().caret;
    const vrow = Math.floor((cy - 3 + d.scroll()) / PAD_LINE_H);
    return caretAtPoint(
      padSegs(w, metrics().frame, uiSlot()),
      d.doc().lines,
      vrow,
      cx - 3,
      padWidthFor(uiSlot()),
    );
  }

  // ---- input routing --------------------------------------------------------------

  function onPrimaryDown(shift: boolean) {
    // Open menus swallow the click (classic: outside-click only dismisses).
    if (startOpen()) {
      const fly = startFly();
      if (fly && popupContains(fly.popup, mx, my)) {
        const i = popupItemAt(fly.popup, mx, my);
        if (i >= 0) {
          const item = fly.popup.items[i];
          if (!item.disabled && item.act) {
            item.act();
            closeMenus();
          }
        }
        return;
      }
      const i = startItemAt(mx, my);
      if (i >= 0) {
        const item = startItems()[i];
        if (item.sub) return; // hover already opened the flyout; stay open
        if (!item.disabled && item.act) {
          item.act();
          closeMenus();
        }
        return;
      }
      // Outside click (the Start button included) dismisses and is consumed.
      closeMenus();
      return;
    }
    const pop = popup();
    if (pop) {
      const i = popupItemAt(pop.popup, mx, my);
      closeMenus();
      if (i >= 0) {
        const item = pop.popup.items[i];
        if (!item.disabled && item.act) item.act();
      }
      return;
    }

    // Launcher: the Start button, or the logo in the screen bar.
    if (launcherHit(mx, my, vp().h, metrics())) {
      startOpen.set(!startOpen());
      return;
    }

    // Screen bar: the focused window's menu titles; the rest swallows.
    if (metrics().screenBarH > 0 && my < metrics().screenBarH) {
      const w = focused();
      if (w) {
        const i = menuTitleAt(w, mx, my);
        if (i >= 0) openWindowMenu(w, i);
      }
      return;
    }

    // Task strip.
    if (my >= vp().h - metrics().taskH) {
      const entry = taskEntryAt(mx, my);
      if (entry !== -1) {
        const id = wins()[entry].id;
        const w = byId(id);
        if (!w) return;
        if (focusId() === id && !w.minimized()) minimize(id);
        else raise(id);
      }
      return;
    }

    // Windows, top-down.
    const hit = hitWindows(mx, my);
    if (hit) {
      const { win: w, region } = hit;
      raise(w.id);
      if (region.kind === "button") {
        drag = { type: "capbtn", id: w.id, btn: region.button };
        w.pressedBtn.set(region.button);
        return;
      }
      if (region.kind === "caption") {
        if (isDblClick(`cap:${w.id}`)) {
          toggleMax(w);
          return;
        }
        if (!w.maximized()) {
          drag = { type: "move", id: w.id, sx: mx, sy: my, orig: w.geo() };
        }
        return;
      }
      if (region.kind === "resize") {
        drag = {
          type: "resize",
          id: w.id,
          dir: region.dir,
          sx: mx,
          sy: my,
          orig: w.geo(),
        };
        return;
      }
      if (region.kind === "menu") {
        openWindowMenu(w, region.index);
        return;
      }
      routeContentDown(w, region.cx, region.cy, shift);
      return;
    }

    // Desktop: select an icon (double-click opens), deactivate windows.
    const icon = iconAt(mx, my);
    iconSel.set(icon);
    focusId.set(-1);
    if (icon >= 0 && isDblClick(`icon:${icon}`)) icons[icon].open();
  }

  function routeContentDown(w: WinCtl, cx: number, cy: number, shift: boolean) {
    if (w.kind === "devices") {
      devicesOf(w).click(cx, cy);
      return;
    }
    if (w.kind === "notepad") {
      const d = padOf(w);
      const doc = d.doc();
      const caret = padCaretAt(w, cx, cy);
      if (isDblClick(`pad:${w.id}`)) {
        // Double-click: select the word under the pointer.
        const r = wordRangeAt(doc.lines[caret.row], caret.col);
        d.doc.set({
          lines: doc.lines,
          caret: { row: caret.row, col: r.to },
          anchor: { row: caret.row, col: r.from },
        });
        return;
      }
      // Click places the caret; shift-click extends; dragging selects.
      const anchor = shift
        ? (doc.anchor ?? doc.caret)
        : { row: caret.row, col: caret.col };
      d.doc.set({ lines: doc.lines, caret, anchor });
      drag = { type: "textsel", id: w.id };
      return;
    }
    if (w.kind === "mines") {
      const d = minesOf(w);
      const hit = minesHit(cx, cy);
      if (hit?.type === "cell") {
        drag = { type: "minehold", id: w.id };
        d.held.set(hit.i);
      } else if (hit?.type === "smiley") {
        drag = { type: "smiley", id: w.id };
        d.smileyHeld.set(true);
      }
      return;
    }
    if (w.kind === "folder") {
      const d = folderOf(w);
      const hit = folderHit(cx, cy, d.rows().length, d.places.length, theme());
      if (hit?.kind === "tool") {
        if (folderToolEnabled(d, hit.tool)) {
          drag = { type: "toolbtn", id: w.id, tool: hit.tool };
          d.toolHeld.set(hit.tool);
        }
        return;
      }
      if (hit?.kind === "place") {
        navigate(w, d.places[hit.i].id);
        return;
      }
      const row = hit?.kind === "row" ? hit.i : -1;
      d.selected.set(row);
      if (row >= 0 && isDblClick(`row:${w.id}:${row}`)) d.rows()[row].open?.();
      return;
    }
    if (w.kind === "about") {
      const g = w.geo();
      const hit = aboutHit(
        g.w - metrics().frame * 2,
        g.h - metrics().frame - contentTop({ menuWidths: [] }, metrics()),
        cx,
        cy,
      );
      if (hit === "ok") {
        drag = { type: "dialogbtn", id: w.id, tag: "ok" };
        aboutOf(w).armed.set("ok");
      }
      return;
    }
    if (w.kind === "shutdown") {
      const g = w.geo();
      const d = shutdownOf(w);
      const hit = shutdownHit(
        g.w - metrics().frame * 2,
        g.h - metrics().frame - contentTop({ menuWidths: [] }, metrics()),
        cx,
        cy,
      );
      if (hit === "radio0") d.choice.set(0);
      else if (hit === "radio1") d.choice.set(1);
      else if (hit === "ok" || hit === "cancel") {
        drag = { type: "dialogbtn", id: w.id, tag: hit };
        d.armed.set(hit);
      }
    }
  }

  function onRightDown() {
    if (startOpen() || popup()) {
      closeMenus();
      return;
    }
    const hit = hitWindows(mx, my);
    if (hit) {
      const { win: w, region } = hit;
      if (region.kind === "content" && w.kind === "mines") {
        raise(w.id);
        const d = minesOf(w);
        const cell = minesHit(region.cx, region.cy);
        if (cell?.type === "cell") {
          d.board.set(toggleFlag(d.board(), cell.i));
          d.board.set(d.board());
        }
        return;
      }
      if (region.kind === "content" && w.kind === "notepad") {
        raise(w.id);
        const d = padOf(w);
        const has = hasSel(d.doc());
        popup.set({
          popup: buildPopup(mx, my, [
            { label: "Cut", shortcut: "Cmd+X", disabled: !has, act: cutSel },
            { label: "Copy", shortcut: "Cmd+C", disabled: !has, act: copySel },
            { label: "Paste", shortcut: "Cmd+V", act: pasteReq },
            { sep: true, label: "" },
            {
              label: "Select All",
              shortcut: "Cmd+A",
              act: () => {
                selectAllIn(w);
              },
            },
          ]),
        });
        return;
      }
      if (region.kind === "caption") {
        raise(w.id);
        popup.set({
          popup: buildPopup(mx, my, [
            {
              label: "Minimize",
              shortcut: "Cmd+M",
              act: () => {
                minimize(w.id);
              },
            },
            {
              label: w.maximized() ? "Restore" : "Maximize",
              disabled: !w.resizable,
              act: () => {
                toggleMax(w);
              },
            },
            { sep: true, label: "" },
            {
              label: "Close",
              shortcut: "Cmd+W",
              act: () => {
                closeWin(w.id);
              },
            },
          ]),
          winId: w.id,
        });
      }
      return;
    }
    if (my >= metrics().screenBarH && my < vp().h - metrics().taskH) {
      const icon = iconAt(mx, my);
      iconSel.set(icon);
      popup.set({
        popup: buildPopup(mx, my, macDesktop ? [
          { label: "Open Devices", act: () => openDevices() },
          { label: "Open Files", act: () => openFolder("computer") },
          { label: "Minesweeper", act: openMines },
          { label: "Next Theme", act: () => setTheme(nextThemeId(themeId())) },
        ] : [
          { label: "Arrange Icons", act: () => {} },
          { label: "Refresh", act: () => {} },
          { sep: true, label: "" },
          {
            label: "New Text Document",
            act: () => {
              openNotepad("Untitled - Notepad", [""]);
            },
          },
          { sep: true, label: "" },
          { label: "Properties", disabled: true },
        ]),
      });
    }
  }

  function onMove() {
    // Menu hover states. An open flyout takes the pointer first: it overlaps
    // the panel's other column, and the rows under it must neither steal the
    // hover nor close it.
    if (startOpen()) {
      const fly = startFly();
      if (fly && popupContains(fly.popup, mx, my)) {
        flyHover.set(popupItemAt(fly.popup, mx, my));
      } else {
        const i = startItemAt(mx, my);
        startHover.set(i);
        if (i >= 0) {
          const item = startItems()[i];
          if (item.sub) {
            if (startFly()?.index !== i) {
              const geo = startGeo();
              const row = geo.rows.find((r: StartRow) => r.index === i);
              startFly.set({
                index: i,
                popup: buildPopup(
                  (row?.x ?? geo.x) + (row?.w ?? geo.w) - 3,
                  row?.y ?? geo.y,
                  item.sub,
                ),
              });
            }
          } else if (startFly()) {
            startFly.set(null);
          }
        }
        flyHover.set(-1);
      }
    }
    const pop = popup();
    if (pop) {
      popupHover.set(popupItemAt(pop.popup, mx, my));
      // A menu-bar dropdown follows the hovered menu title (classic).
      if (pop.winId !== undefined) {
        const w = byId(pop.winId);
        if (w?.menus) {
          const i = menuTitleAt(w, mx, my);
          if (i >= 0 && i !== w.openMenu()) {
            w.openMenu.set(i);
            const o = menuPopupOrigin(w, i);
            popup.set({
              popup: buildPopup(o.x, o.y, w.menus[i].items()),
              winId: w.id,
            });
          }
        }
      }
    }

    // Drags.
    if (drag?.type === "move") {
      const w = byId(drag.id);
      if (w) {
        w.geo.set(clampMove(
          {
            ...drag.orig,
            x: drag.orig.x + (mx - drag.sx),
            y: drag.orig.y + (my - drag.sy),
          },
          vp().w,
          vp().h,
          metrics(),
        ));
      }
      return;
    }
    if (drag?.type === "resize") {
      const w = byId(drag.id);
      if (w) {
        w.geo.set(resizeGeo(
          drag.orig,
          drag.dir,
          mx - drag.sx,
          my - drag.sy,
          w.minW,
          w.minH,
        ));
      }
      sendCursor(cursorForDir(drag.dir));
      return;
    }
    if (drag?.type === "textsel") {
      const w = byId(drag.id);
      if (w) {
        const d = padOf(w);
        const g = w.geo();
        const cx = mx - g.x - metrics().frame;
        const cy = my - g.y - contentTop(chromeOpts(w), metrics());
        const doc = d.doc();
        const caret = padCaretAt(w, Math.max(0, cx), cy);
        if (
          caret.row !== doc.caret.row ||
          caret.col !== doc.caret.col ||
          (caret.end ?? false) !== (doc.caret.end ?? false)
        ) {
          d.doc.set({
            lines: doc.lines,
            caret,
            anchor: doc.anchor ?? doc.caret,
          });
        }
      }
      sendCursor("text");
      return;
    }
    if (drag?.type === "capbtn") {
      const w = byId(drag.id);
      if (w) {
        const r = hitRegion(
          w.geo(),
          chromeOpts(w),
          mx,
          my,
          metrics(),
        );
        w.pressedBtn.set(r?.kind === "button" && r.button === drag.btn ? drag.btn : null);
      }
      return;
    }
    if (drag?.type === "minehold") {
      const w = byId(drag.id);
      if (w) {
        const d = minesOf(w);
        const r = hitRegion(
          w.geo(),
          chromeOpts(w),
          mx,
          my,
          metrics(),
        );
        const cell = r?.kind === "content" ? minesHit(r.cx, r.cy) : null;
        d.held.set(cell?.type === "cell" ? cell.i : -1);
      }
      return;
    }
    if (drag?.type === "toolbtn") {
      const w = byId(drag.id);
      if (w) {
        const r = hitRegion(w.geo(), chromeOpts(w), mx, my, metrics());
        const d = folderOf(w);
        const hit =
          r?.kind === "content"
            ? folderHit(r.cx, r.cy, d.rows().length, d.places.length, theme())
            : null;
        d.toolHeld.set(hit?.kind === "tool" && hit.tool === drag.tool ? drag.tool : null);
      }
      return;
    }
    if (drag?.type === "dialogbtn") {
      const w = byId(drag.id);
      if (w) {
        const r = hitRegion(
          w.geo(),
          chromeOpts(w),
          mx,
          my,
          metrics(),
        );
        const g = w.geo();
        const cw = g.w - metrics().frame * 2;
        const chh =
          g.h -
          metrics().frame -
          contentTop({ menuWidths: [] }, metrics());
        let over: string | null = null;
        if (r?.kind === "content") {
          over =
            w.kind === "about"
              ? aboutHit(cw, chh, r.cx, r.cy)
              : shutdownHit(cw, chh, r.cx, r.cy);
        }
        const armed =
          w.kind === "about" ? aboutOf(w).armed : shutdownOf(w).armed;
        armed.set(over === drag.tag ? drag.tag : null);
      }
      return;
    }

    // Hover cursor shape, and which caption's control cluster is under the
    // pointer (themes may reveal the control glyphs only then).
    let k: CursorKind = "default";
    const hover = hitWindows(mx, my);
    if (hover) {
      if (hover.region.kind === "resize") k = cursorForDir(hover.region.dir);
      else if (hover.region.kind === "content" && hover.win.kind === "notepad")
        k = "text";
    }
    const hoverCluster = hover?.region.kind === "button" ? hover.win.id : -1;
    for (const w of wins()) {
      const on = w.id === hoverCluster;
      if (w.captionHover() !== on) w.captionHover.set(on);
    }
    sendCursor(k);
  }

  function onPrimaryUp() {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.type === "capbtn") {
      const w = byId(d.id);
      if (w && w.pressedBtn() === d.btn) {
        w.pressedBtn.set(null);
        if (d.btn === "close") closeWin(d.id);
        else if (d.btn === "min") minimize(d.id);
        else if (d.btn === "max") toggleMax(w);
      } else if (w) w.pressedBtn.set(null);
      return;
    }
    if (d.type === "minehold") {
      const w = byId(d.id);
      if (w) {
        const md = minesOf(w);
        const i = md.held();
        md.held.set(-1);
        if (i >= 0) {
          const was = md.board().phase;
          md.board.set(reveal(md.board(), i));
          md.board.set(md.board());
          if (was === "ready" && md.board().phase === "playing")
            minesStart = virtualNow();
        }
      }
      return;
    }
    if (d.type === "smiley") {
      const w = byId(d.id);
      if (w) {
        minesOf(w).smileyHeld.set(false);
        const r = hitRegion(
          w.geo(),
          chromeOpts(w),
          mx,
          my,
          metrics(),
        );
        if (r?.kind === "content" && minesHit(r.cx, r.cy)?.type === "smiley")
          minesNew(w);
      }
      return;
    }
    if (d.type === "toolbtn") {
      const w = byId(d.id);
      if (w) {
        const fd = folderOf(w);
        const held = fd.toolHeld();
        fd.toolHeld.set(null);
        if (held === d.tool) runFolderTool(w, d.tool);
      }
      return;
    }
    if (d.type === "dialogbtn") {
      const w = byId(d.id);
      if (w) {
        const armedRef =
          w.kind === "about" ? aboutOf(w).armed : shutdownOf(w).armed;
        const armed = armedRef();
        armedRef.set(null);
        if (armed === d.tag) {
          if (w.kind === "about") closeWin(w.id);
          else if (w.kind === "shutdown") {
            const choice = shutdownOf(w).choice();
            if (d.tag === "cancel") closeWin(w.id);
            else if (choice === 0) svc?.send({ t: "quit" });
            else restartSession();
          }
        }
      }
      return;
    }
    if (d.type === "resize") sendCursor("default");
  }

  /** macOS-style ⌘ chords (host forwards them cmd-flagged, raw lowercase k). */
  function onCmd(k: string, shift: boolean) {
    switch (k) {
      case "z": {
        const p = focusedPad();
        if (p) {
          if (shift) redoIn(p.w);
          else undoIn(p.w);
        }
        return;
      }
      case "escape":
        toggleStart();
        return;
      case "`":
        cycleWindows();
        return;
      case "r":
        if (focused()?.kind === "devices") devicesOf(focused()!).refresh();
        return;
      case "n":
        if (macDesktop) {
          const w = focused();
          if (w?.kind === "devices") return openDevices(true);
          if (w?.kind === "mines") return minesNew(w);
          return openFolder(w?.kind === "folder" ? folderOf(w).place() : "computer", true);
        }
        openNotepad("Untitled - Notepad", [""]);
        return;
      case "w": {
        const w = focused();
        if (w) closeWin(w.id);
        return;
      }
      case "m": {
        const w = focused();
        if (w) minimize(w.id);
        return;
      }
      case "t":
        if (shift) setTheme(nextThemeId(themeId()));
        return;
      case "a": {
        const p = focusedPad();
        if (p) selectAllIn(p.w);
        return;
      }
      case "c":
        copySel();
        return;
      case "x":
        cutSel();
        return;
    }
  }

  function onKey(ev: HostEvent) {
    const k = ev.k ?? "";
    if (ev.cmd) {
      onCmd(k, ev.sh ?? false);
      return;
    }
    if (k === "Escape") {
      if (startOpen() || popup()) closeMenus();
      else if (focused()?.kind === "devices") devicesOf(focused()!).key(k);
      return;
    }
    const w = focused();
    if (!w) return;
    if (w.kind === "devices") {
      devicesOf(w).key(k);
      return;
    }
    if (w.kind === "pocket") {
      // The CompositorSurface focused flag routes input natively.
      return;
    }
    if (w.kind === "folder") {
      const d = folderOf(w);
      if (k === "Enter") d.rows()[d.selected()]?.open?.();
      else if (k === "Backspace") runFolderTool(w, "back");
      else if (k === "Up" || k === "Down") d.selected.set(Math.max(0, Math.min(
        d.rows().length - 1, d.selected() + (k === "Down" ? 1 : -1),
      )));
      return;
    }
    if (w.kind === "mines" && k === "F2") {
      minesNew(w);
      return;
    }
    if (w.kind === "notepad") {
      if (k === "F5") {
        insertTimeDate(w);
        return;
      }
      const d = padOf(w);
      const doc = d.doc();
      switch (k) {
        case "Enter":
          applyEdit(w, "other", insertText(doc, "\n"));
          return;
        case "Backspace":
          applyEdit(w, "erase", backspace(doc));
          return;
        case "Delete":
          applyEdit(w, "erase", del(doc));
          return;
        case "Tab":
          applyEdit(w, "type", insertText(doc, "    "));
          return;
        case "Left":
        case "Right":
        case "Up":
        case "Down":
        case "Home":
        case "End":
          d.doc.set(applyMoveWrapped(
            doc,
            k as CaretMove,
            ev.sh ?? false,
            padSegs(w, metrics().frame, uiSlot()),
            padWidthFor(uiSlot()),
          ));
          break;
        default:
          return;
      }
      scrollCaretIntoView(w);
      return;
    }
    if (w.kind === "shutdown" && k === "Enter") {
      const choice = shutdownOf(w).choice();
      if (choice === 0) svc?.send({ t: "quit" });
      else restartSession();
      return;
    }
    if (w.kind === "about" && k === "Enter") closeWin(w.id);
  }

  function padViewH(w: WinCtl): number {
    return (
      w.geo().h -
      metrics().frame -
      contentTop(chromeOpts(w), metrics()) -
      2
    );
  }

  function scrollCaretIntoView(w: WinCtl) {
    const d = padOf(w);
    const vrow = caretXY(
      padSegs(w, metrics().frame, uiSlot()),
      d.doc().lines,
      d.doc().caret,
      padWidthFor(uiSlot()),
    ).vrow;
    const y = vrow * PAD_LINE_H;
    const viewH = padViewH(w);
    if (y - d.scroll() < 0) d.scroll.set(Math.max(0, y));
    else if (y - d.scroll() > viewH - PAD_LINE_H)
      d.scroll.set(y - viewH + PAD_LINE_H);
  }

  /** Apply an EDIT (never a plain caret/selection move) with an undo
   *  snapshot. Coalescing lives in notepad.ts record(); no-op edits record
   *  nothing. */
  function applyEdit(w: WinCtl, kind: EditKind, next: Doc) {
    const d = padOf(w);
    const prev = d.doc();
    if (docEquals(prev, next)) return;
    d.hist = record(d.hist, prev, next, kind);
    d.doc.set(next);
    scrollCaretIntoView(w);
  }

  function undoIn(w: WinCtl) {
    const d = padOf(w);
    const r = undoStep(d.hist, d.doc());
    if (!r) return;
    d.hist = r.h;
    d.doc.set(r.doc);
    d.preedit.set(null);
    scrollCaretIntoView(w);
  }

  function redoIn(w: WinCtl) {
    const d = padOf(w);
    const r = redoStep(d.hist, d.doc());
    if (!r) return;
    d.hist = r.h;
    d.doc.set(r.doc);
    d.preedit.set(null);
    scrollCaretIntoView(w);
  }

  function typeInto(w: WinCtl, s: string, kind: EditKind = "type") {
    applyEdit(w, kind, insertText(padOf(w).doc(), s));
  }

  // ---- taskbar --------------------------------------------------------------------

  const taskEntries = (): TaskEntry[] =>
    wins()
      .filter((w) => w.kind !== "shutdown")
      .map((w) => ({ id: w.id, title: w.title(), icon: w.icon() }));
  const taskButtonW = () =>
    taskLayout(vp().w, vp().h, taskEntries().length, metrics()).buttonW;

  function taskEntryAt(x: number, y: number): number {
    if (metrics().screenBarH > 0 && virtualNow() < taskMotionUntil) return -1;
    const entries = taskEntries();
    const i = taskEntryIndexAt(
      x,
      y,
      vp().w,
      vp().h,
      entries.length,
      metrics(),
    );
    return i < 0 ? -1 : wins().findIndex((win) => win.id === entries[i].id);
  }

  // ---- frame pump -------------------------------------------------------------------

  function handleEvent(ev: HostEvent) {
    switch (ev.t) {
      case "devices":
        inventory.accept(ev, virtualNow());
        break;
      case "hello": {
        handleEvent({ t: "resize", w: ev.w ?? 800, h: ev.h ?? 600 });
        epoch = ev.epoch ?? 0;
        epochAt = virtualNow();
        break;
      }
      case "resize": {
        const w = ev.w ?? vp().w;
        const h = ev.h ?? vp().h;
        vp.set({ w, h });
        for (const win of wins()) {
          if (win.maximized())
            win.geo.set(maximizedGeo(w, h, metrics()));
          else {
            const geo = macDesktop ? fitDesktopGeo(win.geo()) : win.geo();
            win.geo.set(clampMove(geo, w, h, metrics()));
          }
        }
        break;
      }
      case "mouse": {
        if (ev.b === 2) {
          if (ev.d) {
            mx = ev.x ?? mx;
            my = ev.y ?? my;
            onRightDown();
          }
          break;
        }
        mx = ev.x ?? mx;
        my = ev.y ?? my;
        const down = ev.d ?? false;
        if (down && !prevDown) onPrimaryDown(ev.sh ?? false);
        else if (!down && prevDown) {
          onMove();
          onPrimaryUp();
        } else onMove();
        prevDown = down;
        break;
      }
      case "key":
        onKey(ev);
        break;
      case "ch": {
        const w = focused();
        if (w?.kind === "notepad" && ev.s) typeInto(w, ev.s);
        break;
      }
      case "paste": {
        const w = focused();
        if (w?.kind === "notepad" && ev.text) typeInto(w, ev.text, "other");
        break;
      }
      case "ime": {
        const w = focused();
        if (w?.kind === "notepad") {
          const d = padOf(w);
          // Composition replaces the selection the moment it starts.
          if (ev.s && hasSel(d.doc()))
            applyEdit(w, "other", deleteSel(d.doc()));
          d.preedit.set(ev.s ? { s: ev.s, c: ev.c ?? ev.s.length } : null);
        }
        break;
      }
      case "scroll": {
        const hover = hitWindows(mx, my);
        if (hover?.win.kind === "devices" && hover.region.kind === "content") devicesOf(hover.win).scroll(ev.dy ?? 0);
        if (hover?.win.kind === "notepad") {
          const d = padOf(hover.win);
          const contentH =
            padSegs(hover.win, metrics().frame, uiSlot()).length * PAD_LINE_H + 6;
          const maxY = Math.max(0, contentH - padViewH(hover.win));
          d.scroll.set(Math.max(
            0,
            Math.min(maxY, d.scroll() + (ev.dy ?? 0)),
          ));
        }
        break;
      }
    }
  }

  function boot() {
    if (macDesktop) {
      openDevices();
      const devices = focused()!;
      devices.geo.set(fitDesktopGeo({ x: 116, y: 148, w: 660, h: 390 }));
      openFolder("computer");
      const files = focused()!;
      files.geo.set(fitDesktopGeo({ x: 24, y: 54, w: 540, h: 340 }));
      openMines();
      const mines = focused()!;
      mines.geo.set(fitDesktopGeo({ ...mines.geo(), x: 580, y: 64 }));
      return;
    }
    openNotepad("welcome.txt - Notepad", WELCOME);
    if (!svc) {
      // Standalone (sim, goldens): a lively static arrangement.
      openMines();
      openMyComputer();
    }
  }

  boot();

  onFrame(() => {
    if (svc) for (const ev of svc.poll()) handleEvent(ev);
    if (macDesktop) {
      inventory.tick(virtualNow());
      for (const w of wins()) if (w.kind === "devices") devicesOf(w).sync();
    }
    for (const layout of layouts.values()) layout.step(metrics().frame, uiSlot());

    // Taskbar clock (minute precision, anchored at the hello epoch).
    if (epoch > 0) {
      const t = new Date(epoch + (virtualNow() - epochAt) * 1000);
      const s = `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
      if (s !== clock()) clock.set(s);
    }

    // Minesweeper timer.
    const mw = wins().find((w) => w.kind === "mines");
    if (mw) {
      const d = minesOf(mw);
      if (d.board().phase === "playing" && minesStart > 0) {
        const e = Math.min(999, Math.floor(virtualNow() - minesStart));
        if (e !== d.elapsed()) d.elapsed.set(e);
      }
    }

    // IME candidate window docking: report the focused notepad caret.
    const fw = focused();
    if (svc && fw?.kind === "notepad") {
      const d = padOf(fw);
      const g = fw.geo();
      const doc = d.doc();
      const pos = caretXY(
        padSegs(fw, metrics().frame, uiSlot()),
        doc.lines,
        doc.caret,
        padWidthFor(uiSlot()),
      );
      const x = g.x + metrics().frame + 4 + pos.x;
      const y =
        g.y +
        contentTop(chromeOpts(fw), metrics()) +
        3 +
        pos.vrow * PAD_LINE_H -
        d.scroll();
      if (x !== lastCaret.x || y !== lastCaret.y) {
        lastCaret = { x, y, h: PAD_LINE_H };
        svc.send({ t: "caret", x, y, h: PAD_LINE_H });
      }
    }

  });

  // ---- render -------------------------------------------------------------

  return (
    <View class={theme().desktop}>
      {theme().desktopLayers.map((cls) => (
        <View class={cls} />
      ))}
      <DesktopIcons
        icons={icons}
        selected={iconSel()}
        rows={desktopIconRows(vp().h, metrics())}
        viewportW={vp().w}
        theme={theme()}
      />
      <For each={wins()}>{(w) => (
        <DesktopWindow
          win={w}
          active={focusId() === w.id}
          theme={theme()}
        />
      )}</For>
      {startOpen() && metrics().startHeaderH > 0 ? (
        <StartPanel
          x={startGeo().x}
          y={startGeo().y}
          w={startGeo().w}
          h={startGeo().h}
          items={startItems()}
          hover={startHover()}
          user="Pocket"
          theme={theme()}
        />
      ) : null}
      {startOpen() && metrics().startHeaderH === 0 ? (
        <StartMenu
          x={startGeo().x}
          y={startGeo().y}
          w={startGeo().w}
          h={startGeo().h}
          items={startItems()}
          hover={startHover()}
          theme={theme()}
        />
      ) : null}
      {startOpen() && startFly() ? (
        <PopupPanel
          popup={startFly()!.popup}
          hover={flyHover()}
          theme={theme()}
        />
      ) : null}
      {popup() ? (
        <PopupPanel
          popup={popup()!.popup}
          hover={popupHover()}
          theme={theme()}
        />
      ) : null}
      {metrics().screenBarH > 0 ? (
        <ScreenBar
          startOpen={startOpen()}
          appName={appNameOf(focused())}
          menus={focused()?.menus ?? null}
          openMenu={focused()?.openMenu() ?? -1}
          clock={clock()}
          theme={theme()}
        />
      ) : null}
      <Taskbar
        entries={taskEntries()}
        activeId={focusId()}
        startOpen={startOpen()}
        clock={clock()}
        buttonW={taskButtonW()}
        theme={theme()}
        onTransition={until => { taskMotionUntil = until; }}
      />
    </View>
  );
}
