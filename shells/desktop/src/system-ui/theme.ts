// SPDX-License-Identifier: GPL-3.0-only
// System UI theme boundary. Product code consumes one DesktopTheme; every
// period-specific color, metric, glyph and chrome class stays in this file.
// Changing the active theme never changes the Pocket System manifest, native
// host, AppSupervisor or child application plans.
//
// The contract is a headless one: chrome.tsx / programs.tsx / app.tsx render
// SEMANTIC parts (a caption, its control cluster, a menu bar, a task strip,
// a launcher, a popup, a selection, a push button…) and wm.ts hit-tests the
// same parts from the same ChromeMetrics. A theme decides what each part
// looks like and, through its metrics, where it sits — Classic and Luna put
// the controls on the right and the menu bar in the window; Aqua puts the
// controls on the left, hoists the menu bar to the top of the screen and
// turns the task strip into a centered Dock. None of that is special-cased
// by theme id anywhere outside this file.

/** Baked font slots (src/system-ui/gen-assets.ts -> pak.json). 19-21 are the
 *  W95FA bitmap face, 22-23 the antialiased Inter face shared by every
 *  smooth-text theme (Luna and Aqua): spec.ts caps the atlas at 24 slots and
 *  the framework pins 0..18, so these five are the whole app budget. */
export const FONT = 19;
export const FONT_B = 20;
export const FONT_XL = 21;
export const FONT_SMOOTH = 22;
export const FONT_SMOOTH_B = 23;
/** Luna's original names for the smooth slots. */
export const FONT_XP = FONT_SMOOTH;
export const FONT_XP_B = FONT_SMOOTH_B;

/** Text roles a theme maps onto its baked slots. The smooth face has no
 *  third size, so `xl` lands on its bold face. */
export type FontRole = "ui" | "bold" | "xl";

export type ThemeId = "classic" | "xp" | "aqua";

/** Caption controls. The name is the SEMANTIC action ("max" zooms on Aqua);
 *  a theme's `buttonOrder` decides where each one sits in the cluster. */
export type CaptionButton = "min" | "max" | "close";

/** Everything a caption control's paint depends on. `present` is false for
 *  a control the window does not offer (a dialog's minimize); themes with
 *  `buttonGhosts` still draw it, disabled, so the cluster keeps its shape. */
export interface CaptionState {
  pressed: boolean;
  /** Pointer over the cluster — Aqua reveals its glyphs only then. */
  hover: boolean;
  active: boolean;
  present: boolean;
}

/** Semantic icon vocabulary. Product code names WHAT an icon stands for;
 *  the theme resolves the artwork, so a theme switch re-skins every icon on
 *  screen — desktop, captions, task strip, menus — without touching state. */
export type IconName =
  | "disk"
  | "home"
  | "desktop-place"
  | "documents-place"
  | "downloads"
  | "native-apps"
  | "pocket-apps"
  | "document-file"
  | "trash"
  | "openstrike"
  | "files"
  | "devices"
  | "handheld"
  | "media-player"
  | "computer"
  | "documents"
  | "folder"
  | "recycle"
  | "notepad"
  | "mines"
  | "pocket"
  | "drive"
  | "cdrom"
  | "file"
  | "shutdown"
  | "power"
  | "settings"
  | "find"
  | "help"
  | "run"
  | "check"
  | "menuArrow"
  | "grip"
  | "user"
  | "start"
  | "back"
  | "forward"
  | "up";

/** File-manager toolbar actions a theme chooses to show, in order. */
export type FolderTool = "back" | "forward" | "up";

export type IconSize = 16 | 32;

/** Paint-only strips a surface stacks beneath its content: absolutely
 *  positioned children the chrome renders BEFORE the content, so they paint
 *  under it. Classic chrome is flat fills plus bevel rings and needs none;
 *  Luna's and Aqua's gel surfaces are a base gradient plus a rounded top
 *  cap, a 1px highlight band and 1px edge lines, which is what these carry. */
export type ChromeLayers = readonly string[];

const NO_LAYERS: ChromeLayers = [];

/** Geometry the window manager and the chrome share. Anything here moves a
 *  hit target; anything that only changes paint lives on DesktopTheme. */
export interface ChromeMetrics {
  frame: number;
  /** Top of the caption inside the window box. Classic insets the caption by
   *  the whole frame; Luna and Aqua run it edge to edge under a 1px border. */
  captionTop: number;
  titleH: number;
  titleGap: number;
  buttonW: number;
  buttonH: number;
  buttonTop: number;
  /** Inset of the control cluster from the frame on its `buttonSide`. */
  buttonRight: number;
  buttonGap: number;
  /** Which edge of the caption the control cluster hugs. */
  buttonSide: "left" | "right";
  /** Visual order of the cluster, left to right. */
  buttonOrder: readonly CaptionButton[];
  /** Draw controls the window lacks as disabled placeholders (Aqua). */
  buttonGhosts: boolean;
  /** In-window menu bar height (unused while `screenBarH > 0`). */
  menuH: number;
  /** Horizontal padding of one menu title — the hit width is the measured
   *  label plus twice this. */
  menuPadX: number;
  /** Screen-top bar height. When > 0 the menu bar, the launcher button and
   *  the clock move out of the windows and the task strip into this bar;
   *  the task strip below becomes a Dock (Aqua). 0 for in-window menus. */
  screenBarH: number;
  taskH: number;
  taskLeft: number;
  /** Launcher (Start / logo) button width, in the task strip or screen bar. */
  taskStartW: number;
  /** Width of the divider between the launcher and the task buttons. */
  taskDividerW: number;
  taskGap: number;
  /** Task strip layout: buttons flow from the left after the launcher, or
   *  sit centered in a shelf (the Dock). */
  taskAlign: "left" | "center";
  /** Horizontal padding of the centered shelf (0 for a left-aligned strip). */
  taskPad: number;
  taskButtonMaxW: number;
  /** Width reserved on the right for the clock tray (0 when the clock lives
   *  in the screen bar). */
  taskTrayW: number;
  /** Start panel. `startHeaderH > 0` selects the XP two-column panel (user
   *  header, programs column, places column, a blue strip along the bottom);
   *  otherwise a single column beside a rail of `startRailW` (0 for none).
   *  The panel rises from the task strip, or hangs from the screen bar when
   *  there is one. */
  startX: number;
  startW: number;
  startRowH: number;
  startSepH: number;
  startHeaderH: number;
  startFooterH: number;
  startRailW: number;
  startLeftW: number;
  /** Panel padding around the launcher rows (mirrors startMenu's p-[…]). */
  startPadX: number;
  startPadY: number;
  /** Dropdown / context / flyout popup rows and panel padding. */
  popupRowH: number;
  popupSepH: number;
  popupPadX: number;
  popupPadY: number;
  /** File-manager toolbar: height, left padding, button cell and gap. The
   *  buttons are the theme's `folderTools`, laid out left to right. */
  folderToolH: number;
  folderToolPadX: number;
  folderToolBtnW: number;
  folderToolBtnH: number;
  folderToolGap: number;
  /** File-manager sidebar: width (its right rule inside), splitter gap to
   *  the list, y of the first place row, row height. */
  folderSideW: number;
  folderSideGap: number;
  folderSideTop: number;
  folderSideRowH: number;
  /** Desktop icon column anchored to the left or the right screen edge. */
  iconsSide: "left" | "right";
  resizeBand: number;
  resizeCorner: number;
}

export interface DesktopTheme {
  id: ThemeId;
  label: string;
  devices: {
    toolbar: string; status: string; sidebar: string; header: string; details: string;
    treeRow: (selected: boolean, active: boolean) => string;
    listRow: (selected: boolean, zebra: boolean) => string;
    selectedText: string;
  };
  metrics: ChromeMetrics;
  fontSlot: (role: FontRole) => number;
  /** Artwork for a semantic icon at a logical size. */
  icon: (name: IconName, size: IconSize, selected?: boolean) => string;
  /** Which launcher panel the shell builds: the Classic rail menu, the XP
   *  two-column panel, or a plain dropdown under a screen-bar logo. */
  startStyle: "rail" | "panel" | "menu";
  /** Whether launcher rows carry an icon slot (Aqua's logo menu does not). */
  launcherIcons: boolean;
  desktop: string;
  desktopLayers: ChromeLayers;
  /** Maximized windows drop their rounded top corners: the caption runs
   *  into the screen corner with nothing behind it to show through. */
  windowFrame: (active: boolean, maximized: boolean) => string;
  windowLayers: (active: boolean) => ChromeLayers;
  /** Wrapper between the chrome and the client area (Luna's 1px light ring). */
  windowInner: string;
  windowBody: string;
  caption: (active: boolean) => string;
  captionLayers: (active: boolean, maximized: boolean) => ChromeLayers;
  /** Box around the icon and title: leading (Windows) or centered (Aqua). */
  captionTitleBox: string;
  captionTitle: (active: boolean) => string;
  captionIcon: string;
  /** Balancing spacer opposite the control cluster so a centered title
   *  stays on the caption's midline; "" renders nothing. */
  captionSpacer: string;
  captionControls: string;
  captionButton: (button: CaptionButton, state: CaptionState) => string;
  captionButtonLayers: (
    button: CaptionButton,
    state: CaptionState,
  ) => ChromeLayers;
  /** Baked face artwork filling the control cell; "" paints none. Aqua's
   *  gel lights are images because the core bands gradient fills inside
   *  small rounded boxes into visible rows. */
  captionFace: (button: CaptionButton, state: CaptionState) => string;
  captionFaceClass: string;
  captionGlyphClass: (state: CaptionState) => string;
  /** Glyph artwork; "" draws none (Aqua's plain gel until hovered). */
  captionGlyphSource: (
    button: CaptionButton,
    maximized: boolean,
    state: CaptionState,
  ) => string;
  menuBar: string;
  menuItem: (open: boolean) => string;
  menuText: (open: boolean) => string;
  /** Screen-top bar (only rendered while `metrics.screenBarH > 0`). */
  screenBar: string;
  screenBarLayers: ChromeLayers;
  screenBarLogo: (open: boolean) => string;
  screenBarApp: string;
  screenBarAppText: string;
  taskbar: string;
  taskbarLayers: ChromeLayers;
  startButton: (open: boolean) => string;
  startLayers: (open: boolean) => ChromeLayers;
  /** Baked launcher-button face (Luna's pill: its gradient inside a 14px
   *  radius would band as rows otherwise); "" paints none. */
  startFace: (open: boolean) => string;
  startFaceClass: string;
  startText: string;
  taskDivider: string;
  taskList: string;
  taskButton: (active: boolean) => string;
  taskButtonLayers: (active: boolean) => ChromeLayers;
  taskIcon: string;
  taskShowLabel: boolean;
  taskText: (active: boolean) => string;
  /** Running indicator under a task tile (the Dock's triangle); "" none. */
  taskMark: (active: boolean) => string;
  taskMarkClass: string;
  tray: string;
  trayLayers: ChromeLayers;
  trayText: string;
  popup: string;
  popupLayers: ChromeLayers;
  popupSeparator: string;
  popupSeparatorDark: string;
  popupSeparatorLight: string;
  popupItem: (hover: boolean) => string;
  popupText: (state: "normal" | "hover" | "disabled") => string;
  startMenu: string;
  startMenuLayers: ChromeLayers;
  startRail: string;
  startItem: (hover: boolean) => string;
  /** XP two-column panel (unused while `metrics.startHeaderH` is 0). */
  startHeader: string;
  startHeaderLayers: ChromeLayers;
  startHeaderIcon: string;
  startHeaderName: string;
  startColumn: (side: "left" | "right") => string;
  /** 1px rule between the two columns (absolute, inside the right one). */
  startColumnDivider: string;
  startSeparator: string;
  startFooter: string;
  startFooterLayers: ChromeLayers;
  startFooterItem: (hover: boolean) => string;
  startFooterText: string;
  /** Start-button mark; "" leaves the button its label alone (Luna). */
  startLogo: string;
  desktopSelection: string;
  desktopLabelPlain: string;
  desktopLabel: string;
  notepadWell: string;
  selection: string;
  selectionText: string;
  mutedText: string;
  pocketLoading: string;
  minesRoot: string;
  minesPanel: string;
  minesCounter: string;
  minesSmiley: (pressed: boolean) => string;
  minesField: string;
  minesCell: (state: "hidden" | "held" | "revealed" | "bust") => string;
  /** File-manager toolbar: navigation buttons, an
   *  address / breadcrumb strip and a search field. `folderAddressLabel` and
   *  `folderSearch` of "" hide those parts. */
  folderTools: readonly FolderTool[];
  folderToolbar: string;
  folderToolLayers: ChromeLayers;
  folderToolButton: (enabled: boolean, pressed: boolean) => string;
  folderAddressLabel: string;
  folderAddress: string;
  folderAddressText: string;
  folderSearch: string;
  folderSearchText: string;
  /** File-manager sidebar: the places pane beside the list. A heading label
   *  of "" hides the heading row. `active` lets a theme gray the selected
   *  place in a background window. */
  folderSidebar: string;
  folderSideLayers: ChromeLayers;
  folderSideHeadingLabel: string;
  folderSideHeading: string;
  folderSideHeadingText: string;
  folderSidePanel: string;
  folderSideItem: (selected: boolean, active: boolean) => string;
  folderSideText: (selected: boolean, active: boolean) => string;
  folderWell: string;
  folderHeader: (segment: "name" | "size" | "type") => string;
  folderRow: (selected: boolean, zebra: boolean) => string;
  statusWell: string;
  dialogButton: (pressed: boolean, primary: boolean) => string;
  dialogButtonText: (primary: boolean) => string;
}

// ---------------------------------------------------------------------------
// Icon tables. Full literal paths: the build discovers pak images from the
// string literals in the bundle, so every artwork name must appear here as
// one whole string.
// ---------------------------------------------------------------------------

/** Themes override semantic application and device-class artwork. Missing
 * overrides fall back to Aqua; identities and window state never change. */
type Artwork = "files" | "devices" | "handheld" | "media-player" | "disk" | "home" | "desktop-place" | "documents-place" | "downloads" | "native-apps" | "pocket-apps" | "document-file" | "trash" | "openstrike" | "mines";
const APP_ART: Partial<Record<ThemeId, Partial<Record<Artwork, readonly [string, string, string]>>>> = {
  aqua: {
    "files": ["icons/files-16.png", "icons/files-32.png", "icons/files-selected-32.png"],
    "devices": ["icons/devices-16.png", "icons/devices-32.png", "icons/devices-selected-32.png"],
    "handheld": ["icons/handheld-16.png", "icons/handheld-32.png", "icons/handheld-selected-32.png"],
    "media-player": ["icons/media-player-16.png", "icons/media-player-32.png", "icons/media-player-selected-32.png"],
    "disk": ["icons/disk-16.png", "icons/disk-32.png", "icons/disk-selected-32.png"],
    "home": ["icons/home-16.png", "icons/home-32.png", "icons/home-selected-32.png"],
    "desktop-place": ["icons/desktop-place-16.png", "icons/desktop-place-32.png", "icons/desktop-place-selected-32.png"],
    "documents-place": ["icons/documents-place-16.png", "icons/documents-place-32.png", "icons/documents-place-selected-32.png"],
    "downloads": ["icons/downloads-16.png", "icons/downloads-32.png", "icons/downloads-selected-32.png"],
    "native-apps": ["icons/native-apps-16.png", "icons/native-apps-32.png", "icons/native-apps-selected-32.png"],
    "pocket-apps": ["icons/pocket-apps-16.png", "icons/pocket-apps-32.png", "icons/pocket-apps-selected-32.png"],
    "document-file": ["icons/document-file-16.png", "icons/document-file-32.png", "icons/document-file-selected-32.png"],
    "trash": ["icons/trash-16.png", "icons/trash-32.png", "icons/trash-selected-32.png"],
    "openstrike": ["icons/openstrike-16.png", "icons/openstrike-32.png", "icons/openstrike-selected-32.png"],
    "mines": ["icons/mines-16.png", "icons/mines-32.png", "icons/mines-selected-32.png"],
  },
  classic: {
    "files": ["icons/classic-files-16.png", "icons/classic-files-32.png", "icons/classic-files-selected-32.png"],
    "devices": ["icons/classic-devices-16.png", "icons/classic-devices-32.png", "icons/classic-devices-selected-32.png"],
    "handheld": ["icons/classic-handheld-16.png", "icons/classic-handheld-32.png", "icons/classic-handheld-selected-32.png"],
    "media-player": ["icons/classic-media-player-16.png", "icons/classic-media-player-32.png", "icons/classic-media-player-selected-32.png"],
    "disk": ["icons/classic-disk-16.png", "icons/classic-disk-32.png", "icons/classic-disk-selected-32.png"],
    "home": ["icons/classic-home-16.png", "icons/classic-home-32.png", "icons/classic-home-selected-32.png"],
    "desktop-place": ["icons/classic-desktop-place-16.png", "icons/classic-desktop-place-32.png", "icons/classic-desktop-place-selected-32.png"],
    "documents-place": ["icons/classic-documents-place-16.png", "icons/classic-documents-place-32.png", "icons/classic-documents-place-selected-32.png"],
    "downloads": ["icons/classic-downloads-16.png", "icons/classic-downloads-32.png", "icons/classic-downloads-selected-32.png"],
    "native-apps": ["icons/classic-native-apps-16.png", "icons/classic-native-apps-32.png", "icons/classic-native-apps-selected-32.png"],
    "pocket-apps": ["icons/classic-pocket-apps-16.png", "icons/classic-pocket-apps-32.png", "icons/classic-pocket-apps-selected-32.png"],
    "document-file": ["icons/classic-document-file-16.png", "icons/classic-document-file-32.png", "icons/classic-document-file-selected-32.png"],
    "trash": ["icons/classic-trash-16.png", "icons/classic-trash-32.png", "icons/classic-trash-selected-32.png"],
    "openstrike": ["icons/classic-openstrike-16.png", "icons/classic-openstrike-32.png", "icons/classic-openstrike-selected-32.png"],
    "mines": ["icons/classic-mines-16.png", "icons/classic-mines-32.png", "icons/classic-mines-selected-32.png"],
  },
  xp: {
    "files": ["icons/xp-files-16.png", "icons/xp-files-32.png", "icons/xp-files-selected-32.png"],
    "devices": ["icons/xp-devices-16.png", "icons/xp-devices-32.png", "icons/xp-devices-selected-32.png"],
    "handheld": ["icons/xp-handheld-16.png", "icons/xp-handheld-32.png", "icons/xp-handheld-selected-32.png"],
    "media-player": ["icons/xp-media-player-16.png", "icons/xp-media-player-32.png", "icons/xp-media-player-selected-32.png"],
    "disk": ["icons/xp-disk-16.png", "icons/xp-disk-32.png", "icons/xp-disk-selected-32.png"],
    "home": ["icons/xp-home-16.png", "icons/xp-home-32.png", "icons/xp-home-selected-32.png"],
    "desktop-place": ["icons/xp-desktop-place-16.png", "icons/xp-desktop-place-32.png", "icons/xp-desktop-place-selected-32.png"],
    "documents-place": ["icons/xp-documents-place-16.png", "icons/xp-documents-place-32.png", "icons/xp-documents-place-selected-32.png"],
    "downloads": ["icons/xp-downloads-16.png", "icons/xp-downloads-32.png", "icons/xp-downloads-selected-32.png"],
    "native-apps": ["icons/xp-native-apps-16.png", "icons/xp-native-apps-32.png", "icons/xp-native-apps-selected-32.png"],
    "pocket-apps": ["icons/xp-pocket-apps-16.png", "icons/xp-pocket-apps-32.png", "icons/xp-pocket-apps-selected-32.png"],
    "document-file": ["icons/xp-document-file-16.png", "icons/xp-document-file-32.png", "icons/xp-document-file-selected-32.png"],
    "trash": ["icons/xp-trash-16.png", "icons/xp-trash-32.png", "icons/xp-trash-selected-32.png"],
    "openstrike": ["icons/xp-openstrike-16.png", "icons/xp-openstrike-32.png", "icons/xp-openstrike-selected-32.png"],
    "mines": ["icons/xp-mines-16.png", "icons/xp-mines-32.png", "icons/xp-mines-selected-32.png"],
  },
};
function artworkName(name: IconName): Artwork | undefined {
  const aliases: Partial<Record<IconName, Artwork>> = {
    computer: "desktop-place", documents: "documents-place", folder: "files", recycle: "trash",
    drive: "disk", file: "document-file", notepad: "document-file", pocket: "pocket-apps",
  };
  return aliases[name] ?? (APP_ART.aqua?.[name as Artwork] ? name as Artwork : undefined);
}
function applicationIcon(theme: ThemeId, name: Artwork, size: IconSize, selected = false): string {
  const art = APP_ART[theme]?.[name] ?? APP_ART.aqua![name]!;
  return art[size === 32 ? selected ? 2 : 1 : 0];
}

/** The pixel-art set drawn for Classic (gen-icons.ts ICONS/NATIVE). */
function classicIcon(name: IconName, size: IconSize, selected = false): string {
  const art = artworkName(name);
  if (art) return applicationIcon("classic", art, size, selected);
  switch (name) {
    case "cdrom":
      return "icons/cdrom-16.svg";
    case "shutdown":
    case "power":
      return size === 32 ? "icons/shutdown.svg" : "icons/shutdown-16.svg";
    case "settings":
      return "icons/settings-16.svg";
    case "find":
      return "icons/find-16.svg";
    case "help":
      return "icons/help-16.svg";
    case "run":
      return "icons/run-16.svg";
    case "check":
      return "icons/check-16.svg";
    case "menuArrow":
      return "icons/menu-arrow.svg";
    case "grip":
      return "icons/grip.svg";
    case "user":
      return "icons/xp-user.svg";
    case "start":
      return "icons/start-logo.svg";
    case "back":
      return "icons/nav-back-16.svg";
    case "forward":
      return "icons/nav-forward-16.svg";
    case "up":
      return "icons/nav-up-16.svg";
    default: return applicationIcon("classic", "document-file", size, selected);
  }
}

/** Luna: its own softly shaded desktop subjects (gen-icons.ts XP) and plate
 *  system art; the neutral small objects (drives, pages, gear, magnifier,
 *  help, run, check) share the Aqua vectors, which read as smooth 3D the way
 *  XP's own did. Pixel art remains only for the menu chevron and the grip. */
function xpIcon(name: IconName, size: IconSize, selected = false): string {
  const art = artworkName(name);
  if (art) return applicationIcon("xp", art, size, selected);
  switch (name) {
    case "back":
      return "icons/xp-back-16.svg";
    case "forward":
      return "icons/xp-forward-16.svg";
    case "up":
      return "icons/xp-up-16.svg";
    case "power":
      return "icons/xp-power.svg";
    case "user":
      return "icons/xp-user.svg";
    case "cdrom":
    case "settings":
    case "find":
    case "help":
    case "run":
    case "check":
      return aquaIcon(name, size);
    default:
      return classicIcon(name, size);
  }
}

/** The Aqua vector set (gen-icons.ts AQUA): gel folders, a flat-panel
 *  display, a metal trash can, blue gel plates. */
function aquaIcon(name: IconName, size: IconSize, selected = false): string {
  const art = artworkName(name);
  if (art) return applicationIcon("aqua", art, size, selected);
  switch (name) {
    case "user":
    case "start":
      return size === 32
        ? "icons/aqua-pocket-app.svg"
        : "icons/aqua-pocket-app-16.svg";
    case "cdrom":
      return "icons/aqua-cdrom-16.svg";
    case "shutdown":
    case "power":
      return size === 32 ? "icons/aqua-power.svg" : "icons/aqua-power-16.svg";
    case "settings":
      return "icons/aqua-settings-16.svg";
    case "find":
      return "icons/aqua-find-16.svg";
    case "help":
      return "icons/aqua-help-16.svg";
    case "run":
      return "icons/aqua-run-16.svg";
    case "check":
      return "icons/aqua-check-16.svg";
    case "menuArrow":
      return "icons/aqua-menu-arrow.svg";
    case "grip":
      return "icons/aqua-grip.svg";
    case "back":
      return "icons/aqua-back-16.svg";
    case "forward":
      return "icons/aqua-forward-16.svg";
    case "up":
      return "icons/aqua-up-16.svg";
    default: return applicationIcon("aqua", "document-file", size, selected);
  }
}

// ---------------------------------------------------------------------------
// Classic 98
// ---------------------------------------------------------------------------

// Classic raised chrome is a two-ring outset bevel. Pressing inverts it;
// content wells are sunken. These are full literals because the PocketJS
// compiler resolves the complete class table at build time.
export const CLASSIC_THEME: DesktopTheme = {
  id: "classic",
  devices: {
    toolbar: "absolute left-0 right-0 top-0 h-[38] bg-[#c0c0c0]",
    status: "absolute left-0 right-0 bottom-0 h-[22] flex-row items-center px-[8] bg-[#c0c0c0] border-[#808080] overflow-hidden",
    sidebar: "absolute left-0 top-[38] bottom-[22] w-[168] bg-[#ffffff] border-[#808080] overflow-hidden",
    header: "absolute left-[168] right-0 top-[38] h-[24] flex-row bg-[#c0c0c0] border-[#808080]",
    details: "absolute left-[168] right-0 bottom-[22] h-[94] bg-[#c0c0c0] border-[#808080] overflow-hidden",
    treeRow: (selected, active) => selected
      ? active ? "absolute left-0 right-0 h-[28] flex-row items-center bg-[#000080]" : "absolute left-0 right-0 h-[28] flex-row items-center bg-[#b8bec6]"
      : "absolute left-0 right-0 h-[28] flex-row items-center",
    listRow: (selected, zebra) => selected
      ? "absolute left-0 right-0 h-[32] flex-row bg-[#000080]"
      : zebra ? "absolute left-0 right-0 h-[32] flex-row bg-[#f0f4f8]" : "absolute left-0 right-0 h-[32] flex-row bg-[#ffffff]",
    selectedText: "text-[#ffffff]",
  },
  label: "Classic 98",
  fontSlot: (role) =>
    role === "xl" ? FONT_XL : role === "bold" ? FONT_B : FONT,
  icon: classicIcon,
  startStyle: "rail",
  launcherIcons: true,
  metrics: {
    frame: 3,
    captionTop: 3,
    titleH: 18,
    titleGap: 1,
    buttonW: 16,
    buttonH: 14,
    buttonTop: 2,
    buttonRight: 2,
    buttonGap: 0,
    buttonSide: "right",
    buttonOrder: ["min", "max", "close"],
    buttonGhosts: false,
    menuH: 18,
    menuPadX: 6,
    screenBarH: 0,
    taskH: 28,
    taskLeft: 2,
    taskStartW: 54,
    taskDividerW: 1,
    taskGap: 3,
    taskAlign: "left",
    taskPad: 0,
    taskButtonMaxW: 160,
    taskTrayW: 72,
    startX: 2,
    startW: 182,
    startRowH: 26,
    startSepH: 8,
    startHeaderH: 0,
    startFooterH: 0,
    startRailW: 24,
    startLeftW: 0,
    startPadX: 1,
    startPadY: 1,
    popupRowH: 18,
    popupSepH: 8,
    popupPadX: 1,
    popupPadY: 1,
    // Explorer's coolbar: 24x22 raised buttons on a 30px strip.
    folderToolH: 30,
    folderToolPadX: 4,
    folderToolBtnW: 24,
    folderToolBtnH: 22,
    folderToolGap: 2,
    // Explorer's folder pane: a sunken well with a "Folders" bar, a 3px
    // splitter to the list.
    folderSideW: 128,
    folderSideGap: 3,
    folderSideTop: 21,
    folderSideRowH: 20,
    iconsSide: "left",
    resizeBand: 4,
    resizeCorner: 14,
  },
  desktop: "absolute inset-0 bg-[#008080] overflow-hidden",
  desktopLayers: NO_LAYERS,
  windowFrame: () =>
    "absolute flex-col bg-[#c0c0c0] p-[3] bevel-[#dfdfdf,#000000,#ffffff,#808080]",
  windowLayers: () => NO_LAYERS,
  windowInner: "flex-1 flex-col",
  windowBody: "flex-1 flex-col overflow-hidden bg-[#c0c0c0]",
  caption: (active) =>
    active
      ? "flex-row items-center h-[18] pl-[3] pr-[2] bg-gradient-to-r from-[#000080] to-[#1084d0] mb-[1]"
      : "flex-row items-center h-[18] pl-[3] pr-[2] bg-gradient-to-r from-[#808080] to-[#b5b5b5] mb-[1]",
  captionLayers: () => NO_LAYERS,
  captionTitleBox: "flex-1 flex-row items-center overflow-hidden",
  captionTitle: (active) =>
    active ? "text-[#ffffff]" : "text-[#c0c0c0]",
  captionIcon: "w-[16] h-[16] mr-[3]",
  captionSpacer: "",
  captionControls: "flex-row items-center",
  captionButton: (_button, s) =>
    s.pressed
      ? "w-[16] h-[14] flex-col justify-center items-center bg-[#c0c0c0] bevel-[#000000,#ffffff,#808080,#dfdfdf]"
      : "w-[16] h-[14] flex-col justify-center items-center bg-[#c0c0c0] bevel-[#ffffff,#000000,#dfdfdf,#808080]",
  captionButtonLayers: () => NO_LAYERS,
  captionFace: () => "",
  captionFaceClass: "",
  captionGlyphClass: (s) =>
    s.pressed ? "w-[8] h-[8] ml-[1] mt-[1]" : "w-[8] h-[8]",
  captionGlyphSource: (button, maximized) => {
    if (maximized) return "icons/cap-restore.svg";
    if (button === "min") return "icons/cap-min.svg";
    if (button === "close") return "icons/cap-close.svg";
    return "icons/cap-max.svg";
  },
  menuBar: "flex-row items-center h-[18] bg-[#c0c0c0]",
  menuItem: (open) =>
    open
      ? "h-[17] px-[6] flex-col justify-center bg-[#000080]"
      : "h-[17] px-[6] flex-col justify-center",
  menuText: (open) => (open ? "text-[#ffffff]" : "text-[#000000]"),
  screenBar: "",
  screenBarLayers: NO_LAYERS,
  screenBarLogo: () => "",
  screenBarApp: "",
  screenBarAppText: "",
  taskbar:
    "absolute left-0 right-0 bottom-0 h-[28] flex-row items-center bg-[#c0c0c0] bevel-[#ffffff,#808080] pl-[2] pr-[2] gap-[3]",
  taskbarLayers: NO_LAYERS,
  startButton: (open) =>
    open
      ? "h-[22] w-[54] flex-row justify-center items-center gap-[3] bg-[#c0c0c0] bevel-[#000000,#ffffff,#808080,#dfdfdf]"
      : "h-[22] w-[54] flex-row justify-center items-center gap-[3] bg-[#c0c0c0] bevel-[#ffffff,#000000,#dfdfdf,#808080]",
  startLayers: () => NO_LAYERS,
  startFace: () => "",
  startFaceClass: "",
  startText: "text-[#000000]",
  taskDivider: "w-[1] h-[22] bevel-[#808080,#ffffff]",
  taskList: "flex-1 flex-row items-center gap-[3] overflow-hidden",
  taskButton: (active) =>
    active
      ? "h-[22] flex-row items-center gap-[4] px-[4] bg-[#dfdfdf] bevel-[#808080,#ffffff]"
      : "h-[22] flex-row items-center gap-[4] px-[4] bg-[#c0c0c0] bevel-[#ffffff,#000000,#dfdfdf,#808080]",
  taskButtonLayers: () => NO_LAYERS,
  taskIcon: "w-[16] h-[16]",
  taskShowLabel: true,
  taskText: () => "text-[#000000]",
  taskMark: () => "",
  taskMarkClass: "",
  tray: "h-[22] flex-row items-center px-[8] bevel-[#808080,#ffffff]",
  trayLayers: NO_LAYERS,
  trayText: "text-[#000000]",
  popup:
    "absolute flex-col bg-[#c0c0c0] p-[1] bevel-[#dfdfdf,#000000,#ffffff,#808080]",
  popupLayers: NO_LAYERS,
  popupSeparator: "h-[8] flex-col justify-center px-[1]",
  popupSeparatorDark: "h-[1] bg-[#808080]",
  popupSeparatorLight: "h-[1] bg-[#ffffff]",
  popupItem: (hover) =>
    hover
      ? "h-[18] flex-row items-center gap-[5] pl-[4] pr-[8] bg-[#000080]"
      : "h-[18] flex-row items-center gap-[5] pl-[4] pr-[8]",
  popupText: (state) =>
    state === "disabled"
      ? "text-[#808080]"
      : state === "hover"
        ? "text-[#ffffff]"
        : "text-[#000000]",
  startMenu:
    "absolute flex-row bg-[#c0c0c0] p-[1] bevel-[#dfdfdf,#000000,#ffffff,#808080]",
  startMenuLayers: NO_LAYERS,
  startRail: "w-[24] h-full bg-gradient-to-t from-[#000080] to-[#1084d0]",
  startItem: (hover) =>
    hover
      ? "h-[26] flex-row items-center gap-[6] pl-[6] pr-[6] bg-[#000080]"
      : "h-[26] flex-row items-center gap-[6] pl-[6] pr-[6]",
  startHeader: "",
  startHeaderLayers: NO_LAYERS,
  startHeaderIcon: "",
  startHeaderName: "",
  startColumn: () => "",
  startColumnDivider: "",
  startSeparator: "",
  startFooter: "",
  startFooterLayers: NO_LAYERS,
  startFooterItem: () => "",
  startFooterText: "",
  startLogo: "icons/start-logo.svg",
  desktopSelection: "bg-[#000080] px-[2]",
  desktopLabelPlain: "px-[2]",
  desktopLabel: "text-[#ffffff]",
  notepadWell:
    "flex-1 flex-col bg-[#ffffff] bevel-[#808080,#ffffff,#000000,#dfdfdf] overflow-hidden",
  selection: "bg-[#000080] flex-row",
  selectionText: "text-[#ffffff]",
  mutedText: "text-[#808080]",
  pocketLoading:
    "absolute inset-0 flex-col items-center justify-center bg-[#c0c0c0] px-[20]",
  minesRoot: "flex-1 flex-col p-[5] bg-[#c0c0c0]",
  minesPanel:
    "h-[36] flex-row items-center justify-between px-[5] bevel-[#808080,#ffffff] bevel-w-[2]",
  minesCounter: "flex-row bevel-[#808080,#ffffff] p-[1] gap-0",
  minesSmiley: (pressed) =>
    pressed
      ? "w-[26] h-[26] flex-col justify-center items-center bg-[#c0c0c0] bevel-[#808080,#ffffff]"
      : "w-[26] h-[26] flex-col justify-center items-center bg-[#c0c0c0] bevel-[#ffffff,#808080] bevel-w-[2]",
  minesField: "flex-col bevel-[#808080,#ffffff] bevel-w-[3] p-[3]",
  minesCell: (state) => {
    if (state === "hidden")
      return "absolute inset-0 bg-[#c0c0c0] bevel-[#ffffff,#808080] bevel-w-[2] flex-col justify-center items-center";
    if (state === "bust")
      return "absolute inset-0 bg-[#ff0000] bevel-[#808080,#ff0000] flex-col justify-center items-center";
    return "absolute inset-0 bg-[#c0c0c0] bevel-[#808080,#c0c0c0] flex-col justify-center items-center";
  },
  folderTools: ["back", "forward", "up"],
  folderToolbar:
    "h-[30] flex-row items-center gap-[2] px-[4] bg-[#c0c0c0] bevel-[#ffffff,#808080]",
  folderToolLayers: NO_LAYERS,
  folderToolButton: (enabled, pressed) => {
    if (!enabled)
      return "w-[24] h-[22] flex-col justify-center items-center bg-[#c0c0c0] opacity-40";
    return pressed
      ? "w-[24] h-[22] flex-col justify-center items-center bg-[#c0c0c0] bevel-[#808080,#ffffff]"
      : "w-[24] h-[22] flex-col justify-center items-center bg-[#c0c0c0] bevel-[#ffffff,#808080]";
  },
  folderAddressLabel: "Address",
  folderAddress:
    "flex-1 h-[22] ml-[2] flex-row items-center gap-[4] px-[3] bg-[#ffffff] bevel-[#808080,#ffffff,#000000,#dfdfdf]",
  folderAddressText: "text-[#000000]",
  folderSearch:
    "w-[110] h-[22] ml-[4] flex-row items-center gap-[4] px-[3] bg-[#ffffff] bevel-[#808080,#ffffff,#000000,#dfdfdf]",
  folderSearchText: "text-[#808080]",
  folderSidebar:
    "w-[128] mr-[3] flex-col bg-[#ffffff] bevel-[#808080,#ffffff,#000000,#dfdfdf] p-[1] overflow-hidden",
  folderSideLayers: NO_LAYERS,
  folderSideHeadingLabel: "Folders",
  folderSideHeading:
    "h-[18] mb-[2] flex-row items-center px-[4] bg-[#c0c0c0] bevel-[#ffffff,#808080]",
  folderSideHeadingText: "text-[#000000]",
  folderSidePanel: "flex-col",
  folderSideItem: (selected) =>
    selected
      ? "h-[20] flex-row items-center gap-[4] px-[3] bg-[#000080]"
      : "h-[20] flex-row items-center gap-[4] px-[3]",
  folderSideText: (selected) =>
    selected ? "text-[#ffffff]" : "text-[#000000]",
  folderWell:
    "flex-1 flex-col bg-[#ffffff] bevel-[#808080,#ffffff,#000000,#dfdfdf] p-[1] overflow-hidden",
  folderHeader: (segment) => {
    if (segment === "size")
      return "w-[64] flex-row items-center justify-end px-[6] bg-[#c0c0c0] bevel-[#ffffff,#000000,#dfdfdf,#808080]";
    if (segment === "type")
      return "w-[104] flex-row items-center px-[6] bg-[#c0c0c0] bevel-[#ffffff,#000000,#dfdfdf,#808080]";
    return "flex-1 flex-row items-center px-[6] bg-[#c0c0c0] bevel-[#ffffff,#000000,#dfdfdf,#808080]";
  },
  folderRow: (selected) =>
    selected
      ? "h-[17] flex-row items-center px-[2] bg-[#000080] shrink-0"
      : "h-[17] flex-row items-center px-[2] shrink-0",
  statusWell:
    "flex-1 h-[18] flex-row items-center px-[6] bevel-[#808080,#ffffff]",
  dialogButton: (pressed) =>
    pressed
      ? "w-[75] h-[23] flex-col justify-center items-center bg-[#c0c0c0] bevel-[#000000,#ffffff,#808080,#dfdfdf]"
      : "w-[75] h-[23] flex-col justify-center items-center bg-[#c0c0c0] bevel-[#ffffff,#000000,#dfdfdf,#808080]",
  dialogButtonText: () => "text-[#000000]",
};

// ---------------------------------------------------------------------------
// Windows XP (Luna)
// ---------------------------------------------------------------------------

// Luna is a gel style: every raised surface is one rounded shape carrying a
// three-stop base gradient, plus stacked 1px strips for the edges the three
// stops cannot reach (the bright 2px crown, the dark seat line). Colors below
// are sampled from a 96dpi Windows XP capture, so the row offsets in the
// comments are that capture's pixel rows.
//
// Two shapes make a corner-selective rounding the single `radius` prop cannot:
// a rounded cap layer paints the top corners and a square layer painted over
// it from the cap's radius downwards restores the square bottom (Luna windows
// round the top corners only). The Start button inverts it — the rounded body
// overhangs the taskbar's left edge and its container clips the overhang, so
// the button meets the screen edge square and curves on the right.
export const XP_THEME: DesktopTheme = {
  id: "xp",
  devices: {
    toolbar: "absolute left-0 right-0 top-0 h-[38] bg-[#ece9d8]",
    status: "absolute left-0 right-0 bottom-0 h-[22] flex-row items-center px-[8] bg-[#ece9d8] border-[#aca899] overflow-hidden",
    sidebar: "absolute left-0 top-[38] bottom-[22] w-[168] bg-[#d6dff7] border-[#aca899] overflow-hidden",
    header: "absolute left-[168] right-0 top-[38] h-[24] flex-row bg-[#ece9d8] border-[#aca899]",
    details: "absolute left-[168] right-0 bottom-[22] h-[94] bg-[#ece9d8] border-[#aca899] overflow-hidden",
    treeRow: (selected, active) => selected
      ? active ? "absolute left-0 right-0 h-[28] flex-row items-center bg-[#316ac5]" : "absolute left-0 right-0 h-[28] flex-row items-center bg-[#b8bec6]"
      : "absolute left-0 right-0 h-[28] flex-row items-center",
    listRow: (selected, zebra) => selected
      ? "absolute left-0 right-0 h-[32] flex-row bg-[#316ac5]"
      : zebra ? "absolute left-0 right-0 h-[32] flex-row bg-[#f0f4f8]" : "absolute left-0 right-0 h-[32] flex-row bg-[#ffffff]",
    selectedText: "text-[#ffffff]",
  },
  label: "Windows XP",
  fontSlot: (role) => (role === "ui" ? FONT_SMOOTH : FONT_SMOOTH_B),
  icon: xpIcon,
  startStyle: "panel",
  launcherIcons: true,
  metrics: {
    // frame = 1px outer border + 2px blue band + 1px light client ring.
    frame: 4,
    captionTop: 1,
    titleH: 28,
    titleGap: 1,
    buttonW: 21,
    buttonH: 21,
    buttonTop: 4,
    buttonRight: 1,
    buttonGap: 2,
    buttonSide: "right",
    buttonOrder: ["min", "max", "close"],
    buttonGhosts: false,
    menuH: 21,
    menuPadX: 6,
    screenBarH: 0,
    taskH: 30,
    taskLeft: 0,
    taskStartW: 84,
    taskDividerW: 2,
    taskGap: 3,
    taskAlign: "left",
    taskPad: 0,
    taskButtonMaxW: 160,
    taskTrayW: 72,
    startX: 0,
    startW: 304,
    startRowH: 28,
    startSepH: 9,
    startHeaderH: 48,
    startFooterH: 36,
    startRailW: 0,
    startLeftW: 172,
    startPadX: 1,
    startPadY: 1,
    popupRowH: 19,
    popupSepH: 8,
    popupPadX: 2,
    popupPadY: 2,
    // Luna's toolbar: flat 26px buttons on the beige strip.
    folderToolH: 34,
    folderToolPadX: 6,
    folderToolBtnW: 26,
    folderToolBtnH: 26,
    folderToolGap: 4,
    // The Luna task pane: a 10px margin, a 20px card head, 8px into the card.
    folderSideW: 168,
    folderSideGap: 0,
    folderSideTop: 38,
    folderSideRowH: 20,
    iconsSide: "left",
    resizeBand: 4,
    resizeCorner: 16,
  },
  // Sky gradient plus one grass band that fades in over it: three stops in a
  // single node can only cross blue to green through mud.
  desktop:
    "absolute inset-0 bg-gradient-to-b from-[#1a5fbb] via-[#3f92dd] to-[#9ccff1] overflow-hidden",
  desktopLayers: [
    "absolute left-0 right-0 bottom-0 h-[240] bg-gradient-to-b from-[#7cb04c00] via-[#5d9a36] to-[#3a7020]",
  ],
  windowFrame: (active, maximized) => {
    if (maximized)
      return active
        ? "absolute flex-col border-[#0831d9] bg-[#2758c9]"
        : "absolute flex-col border-[#6673bd] bg-[#7b88cf]";
    return active
      ? "absolute flex-col rounded-[6] border-[#0831d9] bg-[#2758c9] shadow-md"
      : "absolute flex-col rounded-[6] border-[#6673bd] bg-[#7b88cf] shadow-md";
  },
  // Square-bottom patch: covers the frame's rounded bottom corners from below
  // the top radius down. Its own top border line hides under the caption.
  windowLayers: (active) =>
    active
      ? ["absolute left-0 right-0 top-[8] bottom-0 bg-[#2758c9] border-[#0831d9]"]
      : ["absolute left-0 right-0 top-[8] bottom-0 bg-[#7b88cf] border-[#6673bd]"],
  windowInner: "flex-1 flex-col mx-[3] mb-[3] p-[1] bg-[#dee8fe]",
  windowBody: "flex-1 flex-col overflow-hidden bg-[#ece9d8]",
  caption: () =>
    "flex-row items-center h-[28] mt-[1] mx-[1] pl-[3] pr-[4]",
  captionLayers: (active, maximized) =>
    active
      ? [
          // rows 0-9, top corners rounded; rows 5-9 hidden by the body layer
          maximized
            ? "absolute left-0 right-0 top-0 h-[10] bg-gradient-to-b from-[#55a0ff] via-[#0060f0] to-[#0054e3]"
            : "absolute left-0 right-0 top-0 h-[10] rounded-[5] bg-gradient-to-b from-[#55a0ff] via-[#0060f0] to-[#0054e3]",
          // rows 5-25: the dark plateau lifting back to the bright seat
          "absolute left-0 right-0 top-[5] bottom-[2] bg-gradient-to-b from-[#0060f0] via-[#0056e8] to-[#0369fe]",
          "absolute left-0 right-0 bottom-[1] h-[1] bg-[#004fe0]",
          "absolute left-0 right-0 bottom-0 h-[1] bg-[#0d42a8]",
        ]
      : [
          maximized
            ? "absolute left-0 right-0 top-0 h-[10] bg-gradient-to-b from-[#9ab8f5] via-[#7f9de1] to-[#7a97dd]"
            : "absolute left-0 right-0 top-0 h-[10] rounded-[5] bg-gradient-to-b from-[#9ab8f5] via-[#7f9de1] to-[#7a97dd]",
          "absolute left-0 right-0 top-[5] bottom-[2] bg-gradient-to-b from-[#7f9de1] via-[#7c99e0] to-[#82a9ea]",
          "absolute left-0 right-0 bottom-[1] h-[1] bg-[#7590d5]",
          "absolute left-0 right-0 bottom-0 h-[1] bg-[#6f8ace]",
        ],
  captionTitleBox: "flex-1 flex-row items-center overflow-hidden",
  captionTitle: (active) =>
    active ? "text-[#ffffff]" : "text-[#dae5f8]",
  captionIcon: "w-[16] h-[16] mr-[5]",
  captionSpacer: "",
  captionControls: "h-[28] flex-row items-start pt-[4] gap-[2]",
  // The cell is the white ring plus the dark inner rim; the face layer below
  // paints the gel gradient inside both.
  captionButton: (button, s) => {
    if (!s.active)
      return "w-[21] h-[21] flex-col justify-center items-center rounded-[3] border-[#dbe6f8] bg-[#8e9fd0]";
    if (button === "close")
      return "w-[21] h-[21] flex-col justify-center items-center rounded-[3] border-[#ffffff] bg-[#ae6350]";
    return "w-[21] h-[21] flex-col justify-center items-center rounded-[3] border-[#e8f1ff] bg-[#4a6ec2]";
  },
  captionButtonLayers: (button, s) => {
    if (!s.active)
      return [
        "absolute inset-[2] rounded-[1] bg-gradient-to-b from-[#c2d0f0] via-[#a2b5e4] to-[#8397d2]",
      ];
    if (button === "close")
      return s.pressed
        ? ["absolute inset-[2] rounded-[1] bg-gradient-to-b from-[#a33513] via-[#d1552e] to-[#f2a993]"]
        : ["absolute inset-[2] rounded-[1] bg-gradient-to-b from-[#f7a794] via-[#ec7a5b] to-[#c8401a]"];
    return s.pressed
      ? ["absolute inset-[2] rounded-[1] bg-gradient-to-b from-[#1b4bc0] via-[#3f72dd] to-[#8fb2fb]"]
      : ["absolute inset-[2] rounded-[1] bg-gradient-to-b from-[#8dabfb] via-[#4d84f4] to-[#1f56db]"];
  },
  captionFace: () => "",
  captionFaceClass: "",
  captionGlyphClass: () => "w-[16] h-[16]",
  captionGlyphSource: (button, maximized) => {
    if (maximized) return "icons/xp-cap-restore.svg";
    if (button === "min") return "icons/xp-cap-min.svg";
    if (button === "close") return "icons/xp-cap-close.svg";
    return "icons/xp-cap-max.svg";
  },
  menuBar: "flex-row items-center h-[21] bg-[#ece9d8]",
  menuItem: (open) =>
    open
      ? "h-[21] px-[6] flex-col justify-center bg-[#316ac5]"
      : "h-[21] px-[6] flex-col justify-center",
  menuText: (open) => (open ? "text-[#ffffff]" : "text-[#000000]"),
  screenBar: "",
  screenBarLayers: NO_LAYERS,
  screenBarLogo: () => "",
  screenBarApp: "",
  screenBarAppText: "",
  taskbar:
    "absolute left-0 right-0 bottom-0 h-[30] flex-row items-center gap-[3] bg-gradient-to-b from-[#2059d4] via-[#245cdc] to-[#2864e6]",
  // The crown is a 2px lift, not a bright band: Luna's taskbar edge is a
  // subtle highlight, and anything brighter shows up beyond the Start
  // pill's curve as a stray strip of blue.
  taskbarLayers: [
    "absolute left-0 right-0 top-0 h-[1] bg-[#0e3f9e]",
    "absolute left-0 right-0 top-[1] h-[2] bg-gradient-to-b from-[#3a7fe8] to-[#2a66dc]",
    "absolute left-0 right-0 bottom-[1] h-[1] bg-[#1e50be]",
    "absolute left-0 right-0 bottom-0 h-[1] bg-[#1243ac]",
  ],
  // overflow-hidden clips the body's left overhang, so the button is square
  // against the screen edge and rounded on the taskbar side.
  startButton: () =>
    "h-[30] w-[84] overflow-hidden flex-row justify-center items-center gap-[4]",
  // The pill is a baked 128x32 face (gen-icons.ts xpStart): a gradient
  // inside a 14px radius would band into rows and stair-step its curve.
  startLayers: () => NO_LAYERS,
  startFace: (open) => (open ? "icons/xp-start-down.svg" : "icons/xp-start.svg"),
  startFaceClass: "absolute left-[-14] top-[-1] w-[128] h-[32]",
  startText: "text-[#ffffff]",
  // The toolbar grip Luna draws after the Start button: a light/dark pair
  // that closes the pill off from the task buttons.
  taskDivider: "w-[2] h-[24] mt-[1] bevel-[#5a9af8,#173f9e]",
  taskList: "flex-1 flex-row items-center gap-[3] overflow-hidden",
  taskButton: (active) =>
    active
      ? "h-[25] mt-[1] flex-row items-center gap-[5] px-[6] rounded-[3] border-[#0b3691] bg-gradient-to-b from-[#16489f] via-[#1b50b8] to-[#2154bc]"
      : "h-[25] mt-[1] flex-row items-center gap-[5] px-[6] rounded-[3] border-[#2a6ad0] bg-gradient-to-b from-[#4b93f6] via-[#3b81f2] to-[#2e6fdf]",
  taskButtonLayers: () => NO_LAYERS,
  taskIcon: "w-[16] h-[16]",
  taskShowLabel: true,
  taskText: () => "text-[#ffffff]",
  taskMark: () => "",
  taskMarkClass: "",
  tray: "h-[29] mt-[1] flex-row items-center pl-[10] pr-[9]",
  trayLayers: [
    "absolute inset-0 bg-gradient-to-b from-[#1495e5] via-[#1187e4] to-[#0f8fea]",
    "absolute left-0 right-0 top-0 h-[3] bg-gradient-to-b from-[#28a4f8] via-[#26adf8] to-[#1596e6]",
    "absolute left-0 top-0 bottom-0 w-[1] bg-[#00337e]",
    "absolute left-[1] top-0 bottom-0 w-[1] bg-[#2fbdee]",
    "absolute left-0 right-0 bottom-0 h-[1] bg-[#0062c5]",
  ],
  trayText: "text-[#ffffff]",
  popup: "absolute flex-col bg-[#ffffff] p-[2] border-[#aca899] shadow-md",
  popupLayers: NO_LAYERS,
  popupSeparator: "h-[8] flex-col justify-center px-[1]",
  popupSeparatorDark: "h-[1] bg-[#c5c2b4]",
  popupSeparatorLight: "h-[1] bg-[#ffffff]",
  popupItem: (hover) =>
    hover
      ? "h-[19] flex-row items-center gap-[5] pl-[4] pr-[8] bg-[#316ac5]"
      : "h-[19] flex-row items-center gap-[5] pl-[4] pr-[8]",
  popupText: (state) =>
    state === "disabled"
      ? "text-[#aca899]"
      : state === "hover"
        ? "text-[#ffffff]"
        : "text-[#000000]",
  // The panel is a window in miniature: rounded top corners over a square
  // patch, a gel header, and a gel strip along the bottom.
  startMenu:
    "absolute flex-col rounded-[8] border-[#1c4d9c] bg-[#ffffff] p-[1] shadow-md",
  startMenuLayers: [
    "absolute left-0 right-0 top-[10] bottom-0 bg-[#ffffff] border-[#1c4d9c]",
  ],
  startRail: "",
  startItem: (hover) =>
    hover
      ? "h-[28] flex-row items-center gap-[7] pl-[8] pr-[8] bg-[#2f71cd]"
      : "h-[28] flex-row items-center gap-[7] pl-[8] pr-[8]",
  startHeader: "h-[48] flex-row items-center gap-[8] pl-[7] pr-[8]",
  startHeaderLayers: [
    "absolute left-0 right-0 top-0 h-[12] rounded-[7] bg-gradient-to-b from-[#74acf8] via-[#0d60ca] to-[#0b5eca]",
    "absolute left-0 right-0 top-[6] bottom-[1] bg-gradient-to-b from-[#0d60ca] via-[#2274d9] to-[#3e8eeb]",
    "absolute left-0 right-0 bottom-0 h-[1] bg-[#1e5fb0]",
  ],
  startHeaderIcon: "w-[32] h-[32] rounded-[3]",
  startHeaderName: "text-[#ffffff]",
  startColumn: (side) =>
    side === "left"
      ? "w-[172] flex-col bg-[#ffffff]"
      : "flex-1 flex-col bg-[#d2e5fa]",
  startColumnDivider: "absolute left-0 top-0 bottom-0 w-[1] bg-[#b5d0ef]",
  startSeparator: "h-[9] flex-col justify-center px-[10]",
  startFooter: "h-[36] flex-row justify-end items-center",
  startFooterLayers: [
    "absolute left-0 right-0 top-0 bottom-0 bg-gradient-to-b from-[#4189e5] via-[#2474e1] to-[#0f5cb9]",
    "absolute left-0 right-0 top-0 h-[1] bg-[#2a68ad]",
  ],
  startFooterItem: (hover) =>
    hover
      ? "w-[152] h-[36] flex-row items-center justify-center gap-[7] bg-[#ffffff2e]"
      : "w-[152] h-[36] flex-row items-center justify-center gap-[7]",
  startFooterText: "text-[#ffffff]",
  startLogo: "",
  desktopSelection: "bg-[#316ac5] px-[3]",
  desktopLabelPlain: "px-[3]",
  desktopLabel: "text-[#ffffff]",
  notepadWell: "flex-1 flex-col bg-[#ffffff] overflow-hidden",
  selection: "bg-[#316ac5] flex-row",
  selectionText: "text-[#ffffff]",
  mutedText: "text-[#6f6e64]",
  pocketLoading:
    "absolute inset-0 flex-col items-center justify-center bg-[#ece9d8] px-[20]",
  // The game keeps its classic gray board on Luna, as XP's own did.
  minesRoot: "flex-1 flex-col p-[5] bg-[#ece9d8]",
  minesPanel:
    "h-[36] flex-row items-center justify-between px-[5] bevel-[#808080,#ffffff] bevel-w-[2]",
  minesCounter: "flex-row bevel-[#808080,#ffffff] p-[1] gap-0",
  minesSmiley: (pressed) =>
    pressed
      ? "w-[26] h-[26] flex-col justify-center items-center bg-[#c0c0c0] bevel-[#808080,#ffffff]"
      : "w-[26] h-[26] flex-col justify-center items-center bg-[#c0c0c0] bevel-[#ffffff,#808080] bevel-w-[2]",
  minesField: "flex-col bevel-[#808080,#ffffff] bevel-w-[3] p-[3]",
  minesCell: (state) => {
    if (state === "hidden")
      return "absolute inset-0 bg-[#c0c0c0] bevel-[#ffffff,#808080] bevel-w-[2] flex-col justify-center items-center";
    if (state === "bust")
      return "absolute inset-0 bg-[#ff0000] bevel-[#808080,#ff0000] flex-col justify-center items-center";
    return "absolute inset-0 bg-[#c0c0c0] bevel-[#808080,#c0c0c0] flex-col justify-center items-center";
  },
  folderTools: ["back", "forward", "up"],
  folderToolbar: "h-[34] flex-row items-center gap-[4] px-[6] bg-[#ece9d8]",
  folderToolLayers: ["absolute left-0 right-0 bottom-0 h-[1] bg-[#d5d2c4]"],
  // Flat until pressed; the pressed face is a sunk beige plate.
  folderToolButton: (enabled, pressed) => {
    if (!enabled)
      return "w-[26] h-[26] flex-col justify-center items-center rounded-[3] opacity-40";
    return pressed
      ? "w-[26] h-[26] flex-col justify-center items-center rounded-[3] bg-[#dcd9cb] border-[#aca899]"
      : "w-[26] h-[26] flex-col justify-center items-center rounded-[3]";
  },
  folderAddressLabel: "Address",
  folderAddress:
    "flex-1 h-[22] ml-[2] flex-row items-center gap-[4] px-[3] bg-[#ffffff] border-[#7f9db9]",
  folderAddressText: "text-[#000000]",
  folderSearch:
    "w-[110] h-[22] ml-[4] flex-row items-center gap-[4] px-[3] bg-[#ffffff] border-[#7f9db9]",
  folderSearchText: "text-[#6f6e64]",
  // The Explorer task pane: a blue gradient carrying a rounded card whose
  // white-to-blue head reads "Other Places"; entries are link-blue text.
  folderSidebar:
    "w-[168] flex-col bg-gradient-to-b from-[#7ba2e7] to-[#6375d6] pt-[10] pb-[10] pl-[10] pr-[10] overflow-hidden",
  folderSideLayers: NO_LAYERS,
  folderSideHeadingLabel: "Other Places",
  folderSideHeading:
    "h-[24] flex-row items-center px-[10] rounded-[4] bg-gradient-to-r from-[#ffffff] to-[#c6d3f7]",
  folderSideHeadingText: "text-[#215dc6]",
  // Overlaps the head's rounded foot so the card joins square.
  folderSidePanel: "flex-col mt-[-4] pt-[8] pb-[6] bg-[#d6dff7]",
  folderSideItem: (selected) =>
    selected
      ? "h-[20] flex-row items-center gap-[6] pl-[10] pr-[6] bg-[#c1d0f2]"
      : "h-[20] flex-row items-center gap-[6] pl-[10] pr-[6]",
  folderSideText: (selected) =>
    selected ? "text-[#0a246a]" : "text-[#215dc6]",
  folderWell:
    "flex-1 flex-col bg-[#ffffff] border-[#7f9db9] p-[1] overflow-hidden",
  folderHeader: (segment) => {
    if (segment === "size")
      return "w-[64] flex-row items-center justify-end px-[6] bg-gradient-to-b from-[#ffffff] via-[#f6f4ec] to-[#e4e1d3] border-[#d5d2c4]";
    if (segment === "type")
      return "w-[104] flex-row items-center px-[6] bg-gradient-to-b from-[#ffffff] via-[#f6f4ec] to-[#e4e1d3] border-[#d5d2c4]";
    return "flex-1 flex-row items-center px-[6] bg-gradient-to-b from-[#ffffff] via-[#f6f4ec] to-[#e4e1d3] border-[#d5d2c4]";
  },
  folderRow: (selected) =>
    selected
      ? "h-[17] flex-row items-center px-[2] bg-[#316ac5] shrink-0"
      : "h-[17] flex-row items-center px-[2] shrink-0",
  statusWell:
    "flex-1 h-[18] flex-row items-center px-[6] bg-[#ece9d8] border-[#aca899]",
  dialogButton: (pressed) =>
    pressed
      ? "w-[75] h-[23] flex-col justify-center items-center rounded-[3] border-[#003c74] bg-gradient-to-b from-[#c8c4b8] via-[#dedad0] to-[#f0eee8]"
      : "w-[75] h-[23] flex-col justify-center items-center rounded-[3] border-[#003c74] bg-gradient-to-b from-[#ffffff] via-[#f5f3ed] to-[#dcd6c8]",
  dialogButtonText: () => "text-[#000000]",
};

// ---------------------------------------------------------------------------
// Aqua (Mac OS X 10.2–10.4)
// ---------------------------------------------------------------------------

// Aqua is glass over brushed light gray: a glossy white-to-gray title bar
// with left-side traffic lights, a matte inactive state, a blue-to-deeper-blue
// selection gradient, light-blue text selection with black text, zebra
// list rows, and white gel pills for push buttons. Structurally the menu
// bar belongs to the screen, the launcher is the logo at its left end, the
// clock its right end, and the task strip is a translucent Dock.
//
// The core paints flat rounded fills with antialiased disc sprites but
// gradient fills inside rounded boxes as per-row spans, so small gels band.
// Every small gel here is therefore either flat AA shapes or baked artwork
// (the traffic lights are 16px faces from gen-icons.ts); gradients stay on
// tall square surfaces (the caption plateau, the screen bar) where rows are
// invisible. Selection highlights are the two-stop #6c9ef0 → #3875d7
// gradient. Menus hang from the screen bar with square top
// corners and rounded bottom ones — a rounded panel under a square patch.
export const AQUA_THEME: DesktopTheme = {
  id: "aqua",
  devices: {
    toolbar: "absolute left-0 right-0 top-0 h-[38] bg-gradient-to-b from-[#f0f0f0] to-[#d6d6d6]",
    status: "absolute left-0 right-0 bottom-0 h-[22] flex-row items-center px-[8] bg-[#ededed] border-[#a8a8a8] overflow-hidden",
    sidebar: "absolute left-0 top-[38] bottom-[22] w-[168] bg-[#dee3e9] border-[#a8a8a8] overflow-hidden",
    header: "absolute left-[168] right-0 top-[38] h-[24] flex-row bg-[#ededed] border-[#a8a8a8]",
    details: "absolute left-[168] right-0 bottom-[22] h-[94] bg-[#ededed] border-[#a8a8a8] overflow-hidden",
    treeRow: (selected, active) => selected
      ? active ? "absolute left-0 right-0 h-[28] flex-row items-center bg-[#3875d7]" : "absolute left-0 right-0 h-[28] flex-row items-center bg-[#b8bec6]"
      : "absolute left-0 right-0 h-[28] flex-row items-center",
    listRow: (selected, zebra) => selected
      ? "absolute left-0 right-0 h-[32] flex-row bg-[#3875d7]"
      : zebra ? "absolute left-0 right-0 h-[32] flex-row bg-[#f0f4f8]" : "absolute left-0 right-0 h-[32] flex-row bg-[#ffffff]",
    selectedText: "text-[#ffffff]",
  },
  label: "Aqua",
  fontSlot: (role) => (role === "ui" ? FONT_SMOOTH : FONT_SMOOTH_B),
  icon: aquaIcon,
  startStyle: "menu",
  launcherIcons: false,
  metrics: {
    // A 1px border is the whole frame; the client ring is the body itself.
    frame: 1,
    captionTop: 1,
    titleH: 22,
    titleGap: 0,
    buttonW: 14,
    buttonH: 14,
    buttonTop: 4,
    buttonRight: 6,
    buttonGap: 6,
    buttonSide: "left",
    buttonOrder: ["close", "min", "max"],
    buttonGhosts: true,
    menuH: 22,
    menuPadX: 10,
    screenBarH: 22,
    // The Dock: 44px tiles in a shelf with 4px vertical padding.
    taskH: 52,
    taskLeft: 0,
    taskStartW: 40,
    taskDividerW: 0,
    taskGap: 4,
    taskAlign: "center",
    taskPad: 8,
    taskButtonMaxW: 44,
    taskTrayW: 0,
    startX: 0,
    startW: 208,
    startRowH: 19,
    startSepH: 9,
    startHeaderH: 0,
    startFooterH: 0,
    startRailW: 0,
    startLeftW: 0,
    // Menus hang flush: no side padding (the highlight spans edge to edge),
    // a 4px breath above the first and below the last row.
    startPadX: 0,
    startPadY: 4,
    popupRowH: 19,
    popupSepH: 9,
    popupPadX: 0,
    popupPadY: 4,
    // Tiger's toolbar: gel pills on a 38px brushed strip.
    folderToolH: 38,
    folderToolPadX: 8,
    folderToolBtnW: 28,
    folderToolBtnH: 22,
    folderToolGap: 4,
    // Tiger's sidebar: a pale blue-gray pane with a hairline on its right.
    folderSideW: 140,
    folderSideGap: 0,
    folderSideTop: 4,
    folderSideRowH: 20,
    iconsSide: "right",
    resizeBand: 4,
    resizeCorner: 16,
  },
  // "Aqua Blue": a mid-blue field with pale swirl bands. Two translucent
  // pills and one soft band stand in for the wallpaper's streaks.
  desktop:
    "absolute inset-0 bg-gradient-to-b from-[#2b6bd2] via-[#4a92e8] to-[#2660c2] overflow-hidden",
  desktopLayers: [
    "absolute left-0 right-0 top-[160] h-[260] bg-gradient-to-b from-[#ffffff00] via-[#c2e2ff30] to-[#ffffff00]",
    "absolute left-[-240] right-[-120] top-[120] h-[110] rounded-[55] bg-[#ffffff12]",
    "absolute left-[-80] right-[-360] top-[330] h-[90] rounded-[45] bg-[#ffffff0e]",
  ],
  // A mid-gray 1px rim: soft enough that the 5px corner's antialiasing reads
  // as a curve, not a staircase, against the light caption.
  windowFrame: (active, maximized) => {
    if (maximized)
      return active
        ? "absolute flex-col border-[#7d7d7d] bg-[#e8e8e8]"
        : "absolute flex-col border-[#a6a6a6] bg-[#e8e8e8]";
    return active
      ? "absolute flex-col rounded-[5] border-[#7d7d7d] bg-[#e8e8e8] shadow-lg"
      : "absolute flex-col rounded-[5] border-[#a6a6a6] bg-[#e8e8e8] shadow-md";
  },
  // Aqua rounds the top corners only: the square patch restores the bottom.
  windowLayers: (active) =>
    active
      ? ["absolute left-0 right-0 top-[8] bottom-0 bg-[#e8e8e8] border-[#7d7d7d]"]
      : ["absolute left-0 right-0 top-[8] bottom-0 bg-[#e8e8e8] border-[#a6a6a6]"],
  windowInner: "flex-1 flex-col mx-[1] mb-[1]",
  windowBody: "flex-1 flex-col overflow-hidden bg-[#e8e8e8]",
  caption: () => "flex-row items-center h-[22] mt-[1] mx-[1] pl-[6] pr-[6]",
  // Focused: a glossy crown falling to a gray seat over a dark rule.
  // Unfocused: the gloss goes matte — the signature Aqua cue.
  captionLayers: (active, maximized) =>
    active
      ? [
          maximized
            ? "absolute left-0 right-0 top-0 h-[10] bg-gradient-to-b from-[#fdfdfd] to-[#e9e9e9]"
            : "absolute left-0 right-0 top-0 h-[10] rounded-[4] bg-gradient-to-b from-[#fdfdfd] to-[#e9e9e9]",
          "absolute left-0 right-0 top-[5] bottom-[1] bg-gradient-to-b from-[#ececec] via-[#d9d9d9] to-[#c5c5c5]",
          "absolute left-0 right-0 bottom-0 h-[1] bg-[#8a8a8a]",
        ]
      : [
          maximized
            ? "absolute left-0 right-0 top-0 h-[10] bg-gradient-to-b from-[#fafafa] to-[#f1f1f1]"
            : "absolute left-0 right-0 top-0 h-[10] rounded-[4] bg-gradient-to-b from-[#fafafa] to-[#f1f1f1]",
          "absolute left-0 right-0 top-[5] bottom-[1] bg-gradient-to-b from-[#f3f3f3] via-[#ebebeb] to-[#e0e0e0]",
          "absolute left-0 right-0 bottom-0 h-[1] bg-[#b0b0b0]",
        ],
  captionTitleBox: "flex-1 flex-row items-center justify-center overflow-hidden",
  captionTitle: (active) =>
    active ? "text-[#1e1e1e]" : "text-[#8a8a8a]",
  captionIcon: "w-[16] h-[16] mr-[4]",
  // Three 14px lights plus two 6px gaps.
  captionSpacer: "w-[54]",
  captionControls: "flex-row items-center gap-[6]",
  // The cell is an empty 14px box; the face image (16px tile, disc centered)
  // paints the whole light, so nothing here is a rounded gradient.
  captionButton: () => "w-[14] h-[14] flex-col justify-center items-center",
  captionButtonLayers: () => NO_LAYERS,
  // Inactive windows carry gray lights until the pointer reaches the
  // cluster, which restores the colors.
  captionFace: (button, s) => {
    if (!s.present || (!s.active && !s.hover && !s.pressed))
      return "icons/aqua-light-gray.svg";
    if (button === "close")
      return s.pressed
        ? "icons/aqua-light-close-down.svg"
        : "icons/aqua-light-close.svg";
    if (button === "min")
      return s.pressed
        ? "icons/aqua-light-min-down.svg"
        : "icons/aqua-light-min.svg";
    return s.pressed
      ? "icons/aqua-light-zoom-down.svg"
      : "icons/aqua-light-zoom.svg";
  },
  captionFaceClass: "absolute left-[-1] top-[-1] w-[16] h-[16]",
  captionGlyphClass: () => "w-[8] h-[8]",
  // Glyphs surface only while the pointer is over the cluster or a light is
  // pressed; a ghost light never shows one.
  captionGlyphSource: (button, _maximized, s) => {
    if (!s.present || !(s.hover || s.pressed)) return "";
    if (button === "close") return "icons/aqua-cap-close.svg";
    if (button === "min") return "icons/aqua-cap-min.svg";
    return "icons/aqua-cap-zoom.svg";
  },
  // In-window menu bar is never mounted (screenBarH > 0); classes kept
  // coherent so the contract stays total.
  menuBar: "flex-row items-center h-[22] bg-[#e8e8e8]",
  menuItem: (open) =>
    open
      ? "h-[22] px-[10] flex-col justify-center bg-gradient-to-b from-[#6c9ef0] to-[#3875d7]"
      : "h-[22] px-[10] flex-col justify-center",
  menuText: (open) => (open ? "text-[#ffffff]" : "text-[#000000]"),
  screenBar:
    "absolute left-0 right-0 top-0 h-[22] flex-row items-center bg-gradient-to-b from-[#fdfdfd] via-[#ececec] to-[#d4d4d4]",
  screenBarLayers: [
    "absolute left-0 right-0 bottom-0 h-[1] bg-[#7c7c7c]",
  ],
  screenBarLogo: (open) =>
    open
      ? "w-[40] h-[22] flex-col justify-center items-center bg-gradient-to-b from-[#6c9ef0] to-[#3875d7]"
      : "w-[40] h-[22] flex-col justify-center items-center",
  screenBarApp: "h-[22] px-[8] flex-col justify-center",
  screenBarAppText: "text-[#000000]",
  // The Dock strip is transparent; the shelf is the task list itself.
  taskbar:
    "absolute left-0 right-0 bottom-0 h-[52] flex-row items-end justify-center",
  taskbarLayers: NO_LAYERS,
  startButton: () => "",
  startLayers: () => NO_LAYERS,
  startFace: () => "",
  startFaceClass: "",
  startText: "",
  taskDivider: "",
  // The shelf overhangs the screen edge by 8px (negative bottom margin,
  // clipped by the desktop) so only its top corners read as rounded, like
  // the Tiger Dock; a thin dark rim, no drop shadow.
  taskList:
    "flex-row items-end gap-[4] px-[8] pt-[4] pb-[12] mb-[-8] rounded-[6] bg-[#ffffff9e] border-[#00000047]",
  taskButton: (active) =>
    active
      ? "w-[44] h-[44] flex-col items-center pt-[4] rounded-[6] bg-[#00000014]"
      : "w-[44] h-[44] flex-col items-center pt-[4] rounded-[6]",
  taskButtonLayers: () => NO_LAYERS,
  taskIcon: "w-[32] h-[32]",
  taskShowLabel: false,
  taskText: () => "text-[#000000]",
  taskMark: () => "icons/aqua-dock-mark.svg",
  taskMarkClass: "w-[8] h-[8]",
  // The clock sits in the screen bar.
  tray: "h-[22] flex-row items-center px-[10]",
  trayLayers: NO_LAYERS,
  trayText: "text-[#000000]",
  popup:
    "absolute flex-col bg-[#ffffff] pt-[4] pb-[4] rounded-[5] border-[#a3a3a3] shadow-md",
  // Square top: a patch over the rounded top corners plus its three edges.
  popupLayers: [
    "absolute left-0 right-0 top-0 h-[10] bg-[#ffffff]",
    "absolute left-0 right-0 top-0 h-[1] bg-[#a3a3a3]",
    "absolute left-0 top-0 w-[1] h-[10] bg-[#a3a3a3]",
    "absolute right-0 top-0 w-[1] h-[10] bg-[#a3a3a3]",
  ],
  popupSeparator: "h-[9] flex-col justify-center px-0",
  popupSeparatorDark: "h-[1] bg-[#d5d5d5]",
  popupSeparatorLight: "h-0",
  // 16px mark column + 5px gap puts the label 25px in, the OS X check column.
  popupItem: (hover) =>
    hover
      ? "h-[19] flex-row items-center gap-[5] pl-[4] pr-[16] bg-gradient-to-b from-[#6c9ef0] to-[#3875d7]"
      : "h-[19] flex-row items-center gap-[5] pl-[4] pr-[16]",
  popupText: (state) =>
    state === "disabled"
      ? "text-[#9b9b9b]"
      : state === "hover"
        ? "text-[#ffffff]"
        : "text-[#000000]",
  // The logo dropdown: a white menu flush under the bar, square on top,
  // rounded below, labels 21px in with no icon column.
  startMenu:
    "absolute flex-row bg-[#ffffff] pt-[4] pb-[4] rounded-[5] border-[#a3a3a3] shadow-md",
  startMenuLayers: [
    "absolute left-0 right-0 top-0 h-[10] bg-[#ffffff]",
    "absolute left-0 right-0 top-0 h-[1] bg-[#a3a3a3]",
    "absolute left-0 top-0 w-[1] h-[10] bg-[#a3a3a3]",
    "absolute right-0 top-0 w-[1] h-[10] bg-[#a3a3a3]",
  ],
  startRail: "w-0",
  startItem: (hover) =>
    hover
      ? "h-[19] flex-row items-center pl-[21] pr-[16] bg-gradient-to-b from-[#6c9ef0] to-[#3875d7]"
      : "h-[19] flex-row items-center pl-[21] pr-[16]",
  startHeader: "",
  startHeaderLayers: NO_LAYERS,
  startHeaderIcon: "",
  startHeaderName: "",
  startColumn: () => "",
  startColumnDivider: "",
  startSeparator: "",
  startFooter: "",
  startFooterLayers: NO_LAYERS,
  startFooterItem: () => "",
  startFooterText: "",
  startLogo: "",
  // Finder labels: a rounded blue pill when selected.
  desktopSelection: "bg-[#3875d7] rounded-[8] px-[5]",
  desktopLabelPlain: "px-[5]",
  desktopLabel: "text-[#ffffff]",
  notepadWell: "flex-1 flex-col bg-[#ffffff] overflow-hidden",
  // Text selection is the pale Aqua blue with the text left black.
  selection: "bg-[#b5d5ff] flex-row",
  selectionText: "text-[#000000]",
  mutedText: "text-[#7a7a7a]",
  pocketLoading:
    "absolute inset-0 flex-col items-center justify-center bg-[#e8e8e8] px-[20]",
  // The board re-skins to gel tiles on a soft gray field; the LED counters
  // and the smiley stay the game's own.
  minesRoot: "flex-1 flex-col p-[5] bg-[#e8e8e8]",
  minesPanel:
    "h-[36] flex-row items-center justify-between px-[5] rounded-[6] bg-[#d3d3d3] border-[#a6a6a6]",
  minesCounter: "flex-row rounded-[3] bg-[#000000] border-[#6a6a6a] p-[1] gap-0",
  minesSmiley: (pressed) =>
    pressed
      ? "w-[26] h-[26] flex-col justify-center items-center rounded-[13] border-[#8a8a8a] bg-gradient-to-b from-[#d4d4d4] to-[#bcbcbc]"
      : "w-[26] h-[26] flex-col justify-center items-center rounded-[13] border-[#8a8a8a] bg-gradient-to-b from-[#ffffff] to-[#d6d6d6]",
  minesField: "flex-col rounded-[4] bg-[#bdbdbd] border-[#9a9a9a] p-[3]",
  minesCell: (state) => {
    if (state === "hidden")
      return "absolute inset-0 rounded-[2] border-[#a2a2a2] bg-gradient-to-b from-[#fbfbfb] to-[#d3d3d3] flex-col justify-center items-center";
    if (state === "held")
      return "absolute inset-0 rounded-[2] border-[#a2a2a2] bg-[#c8c8c8] flex-col justify-center items-center";
    if (state === "bust")
      return "absolute inset-0 border-[#c6c6c6] bg-[#e8584b] flex-col justify-center items-center";
    return "absolute inset-0 border-[#c6c6c6] bg-[#e2e2e2] flex-col justify-center items-center";
  },
  // White gel pills for back / forward, the place as a breadcrumb, a round
  // search well; the strip is the caption's brushed gray continued.
  folderTools: ["back", "forward"],
  folderToolbar:
    "h-[38] flex-row items-center gap-[4] px-[8] bg-gradient-to-b from-[#f0f0f0] to-[#d6d6d6]",
  folderToolLayers: ["absolute left-0 right-0 bottom-0 h-[1] bg-[#9c9c9c]"],
  folderToolButton: (enabled, pressed) => {
    if (!enabled)
      return "w-[28] h-[22] flex-col justify-center items-center rounded-[11] border-[#b4b4b4] bg-[#ececec] opacity-60";
    return pressed
      ? "w-[28] h-[22] flex-col justify-center items-center rounded-[11] border-[#6f6f6f] bg-gradient-to-b from-[#c9c9c9] via-[#bcbcbc] to-[#c4c4c4]"
      : "w-[28] h-[22] flex-col justify-center items-center rounded-[11] border-[#8a8a8a] bg-gradient-to-b from-[#ffffff] via-[#f3f3f3] to-[#dedede]";
  },
  folderAddressLabel: "",
  folderAddress: "flex-1 h-[22] ml-[6] flex-row items-center gap-[6] px-[4]",
  folderAddressText: "text-[#1e1e1e]",
  folderSearch:
    "w-[124] h-[20] flex-row items-center gap-[4] px-[8] rounded-[10] border-[#9a9a9a] bg-[#ffffff]",
  folderSearchText: "text-[#8a8a8a]",
  // Sidebar rows take the selection gradient, gray in a background window.
  folderSidebar: "w-[140] flex-col bg-[#dee3e9] pt-[4] overflow-hidden",
  folderSideLayers: ["absolute right-0 top-0 bottom-0 w-[1] bg-[#a8a8a8]"],
  folderSideHeadingLabel: "",
  folderSideHeading: "",
  folderSideHeadingText: "",
  folderSidePanel: "flex-col",
  folderSideItem: (selected, active) => {
    if (!selected) return "h-[20] flex-row items-center gap-[6] pl-[8] pr-[5]";
    return active
      ? "h-[20] flex-row items-center gap-[6] pl-[8] pr-[5] bg-gradient-to-b from-[#6c9ef0] to-[#3875d7]"
      : "h-[20] flex-row items-center gap-[6] pl-[8] pr-[5] bg-gradient-to-b from-[#c4c4c4] to-[#a8a8a8]";
  },
  folderSideText: (selected) =>
    selected ? "text-[#ffffff]" : "text-[#1e1e1e]",
  // The list runs to the window's own 1px rim: no second ring around it.
  folderWell: "flex-1 flex-col bg-[#ffffff] p-[1] overflow-hidden",
  folderHeader: (segment) => {
    if (segment === "size")
      return "w-[64] flex-row items-center justify-end px-[6] bg-gradient-to-b from-[#ffffff] via-[#f0f0f0] to-[#dcdcdc] border-[#b8b8b8]";
    if (segment === "type")
      return "w-[104] flex-row items-center px-[6] bg-gradient-to-b from-[#ffffff] via-[#f0f0f0] to-[#dcdcdc] border-[#b8b8b8]";
    return "flex-1 flex-row items-center px-[6] bg-gradient-to-b from-[#ffffff] via-[#f0f0f0] to-[#dcdcdc] border-[#b8b8b8]";
  },
  // Finder stripes: every second row tinted blue, selection the blue gel.
  folderRow: (selected, zebra) => {
    if (selected)
      return "h-[17] flex-row items-center px-[2] bg-gradient-to-b from-[#6c9ef0] to-[#3875d7] shrink-0";
    if (zebra)
      return "h-[17] flex-row items-center px-[2] bg-[#edf3fe] shrink-0";
    return "h-[17] flex-row items-center px-[2] shrink-0";
  },
  statusWell:
    "flex-1 h-[18] flex-row items-center justify-center bg-[#e8e8e8]",
  // White gel pills; the default button is the blue gel.
  dialogButton: (pressed, primary) => {
    if (primary)
      return pressed
        ? "w-[75] h-[23] flex-col justify-center items-center rounded-[11] border-[#1f4f9f] bg-gradient-to-b from-[#5b8fdc] via-[#3670cf] to-[#4b8be0]"
        : "w-[75] h-[23] flex-col justify-center items-center rounded-[11] border-[#2a5fbe] bg-gradient-to-b from-[#b4d4f8] via-[#5a9bee] to-[#78b8f6]";
    return pressed
      ? "w-[75] h-[23] flex-col justify-center items-center rounded-[11] border-[#6f6f6f] bg-gradient-to-b from-[#d4d4d4] via-[#c6c6c6] to-[#cccccc]"
      : "w-[75] h-[23] flex-col justify-center items-center rounded-[11] border-[#7a7a7a] bg-gradient-to-b from-[#ffffff] via-[#f1f1f1] to-[#dadada]";
  },
  dialogButtonText: (primary) =>
    primary ? "text-[#ffffff]" : "text-[#000000]",
};

export const THEMES: readonly DesktopTheme[] = [
  CLASSIC_THEME,
  XP_THEME,
  AQUA_THEME,
];

export function themeById(id: ThemeId): DesktopTheme {
  if (id === "xp") return XP_THEME;
  if (id === "aqua") return AQUA_THEME;
  return CLASSIC_THEME;
}

/** The theme after `id` in picker order (⌘⇧T cycles through them). */
export function nextThemeId(id: ThemeId): ThemeId {
  const i = THEMES.findIndex((t) => t.id === id);
  return THEMES[(i + 1) % THEMES.length].id;
}
