// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/wm.ts — pure window-manager math: chrome hit regions, resize
// arithmetic, movement clamps, task-strip and launcher-panel layout. No
// framework imports — unit-tested directly (tests/system-ui.test.ts). The
// compositor (app.tsx) owns the state; this module owns the geometry rules.
//
// Chrome anatomy comes from the active System UI theme. The same metrics feed
// paint and hit testing so a dynamic theme change cannot leave stale click,
// drag, resize or compositor-surface geometry behind. Everything a theme can
// move — the side of the control cluster, whether the menu bar lives in the
// window or along the top of the screen, whether the task strip flows from
// the left or centers as a Dock — is a ChromeMetrics field read here.

import {
  CLASSIC_THEME,
  type CaptionButton,
  type ChromeMetrics,
} from "./theme.ts";

export type { CaptionButton } from "./theme.ts";

const DEFAULT_METRICS = CLASSIC_THEME.metrics;

export interface Geo {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DESK_ICON_X = 8;
export const DESK_ICON_Y = 8;
export const DESK_ICON_W = 74;
export const DESK_ICON_H = 48;
export const DESK_ICON_X_STRIDE = 82;
export const DESK_ICON_Y_STRIDE = 58;

/** Column-major desktop icon grid. More icons add columns while every cell
 *  between the screen bar and the task strip keeps the same theme-
 *  independent 74x48 hit target. */
export function desktopIconRows(
  viewportH: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
): number {
  return Math.max(
    1,
    Math.floor(
      (viewportH - metrics.screenBarH - metrics.taskH - DESK_ICON_Y * 2) /
        DESK_ICON_Y_STRIDE,
    ),
  );
}

/** Cell origin. Columns grow from the theme's `iconsSide` edge — the left
 *  one needs no viewport width, the right one (Aqua) does. */
export function desktopIconPosition(
  index: number,
  rows: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
  viewportW = 0,
): { x: number; y: number } {
  const col = Math.floor(index / Math.max(1, rows));
  const x =
    metrics.iconsSide === "right"
      ? viewportW - DESK_ICON_X - DESK_ICON_W - col * DESK_ICON_X_STRIDE
      : DESK_ICON_X + col * DESK_ICON_X_STRIDE;
  return {
    x,
    y:
      metrics.screenBarH +
      DESK_ICON_Y +
      (index % Math.max(1, rows)) * DESK_ICON_Y_STRIDE,
  };
}

export function desktopIconAt(
  x: number,
  y: number,
  count: number,
  rows: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
  viewportW = 0,
): number {
  for (let i = 0; i < count; i++) {
    const p = desktopIconPosition(i, rows, metrics, viewportW);
    if (x >= p.x && x < p.x + DESK_ICON_W && y >= p.y && y < p.y + DESK_ICON_H)
      return i;
  }
  return -1;
}

export type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type Region =
  | { kind: "caption" }
  | { kind: "button"; button: CaptionButton }
  | { kind: "menu"; index: number }
  | { kind: "content"; cx: number; cy: number }
  | { kind: "resize"; dir: Dir };

export interface ChromeOpts {
  /** Caption controls the window offers (any order; the theme sorts them). */
  buttons: readonly CaptionButton[];
  resizable: boolean;
  maximized: boolean;
  /** Menu-bar item widths in px (empty = no menu bar). */
  menuWidths: readonly number[];
}

/** One cell of the control cluster in window-local x. Ghost cells belong to
 *  controls the window lacks; themes with `buttonGhosts` paint them disabled
 *  and hit testing skips them. */
export interface CaptionSlot {
  button: CaptionButton;
  x: number;
  present: boolean;
}

/** The control cluster laid out in the theme's visual order, hugging the
 *  theme's caption edge. Paint (chrome.tsx) and hit testing read this. */
export function captionSlots(
  w: number,
  buttons: readonly CaptionButton[],
  metrics: ChromeMetrics = DEFAULT_METRICS,
): CaptionSlot[] {
  const shown = metrics.buttonOrder.filter(
    (b) => metrics.buttonGhosts || buttons.includes(b),
  );
  const slots: CaptionSlot[] = [];
  if (metrics.buttonSide === "left") {
    let x = metrics.frame + metrics.buttonRight;
    for (const b of shown) {
      slots.push({ button: b, x, present: buttons.includes(b) });
      x += metrics.buttonW + metrics.buttonGap;
    }
  } else {
    let right = w - metrics.frame - metrics.buttonRight;
    for (let i = shown.length - 1; i >= 0; i--) {
      slots.unshift({
        button: shown[i],
        x: right - metrics.buttonW,
        present: buttons.includes(shown[i]),
      });
      right -= metrics.buttonW + metrics.buttonGap;
    }
  }
  return slots;
}

/** Left x of each of `buttons`, in the order given. */
export function captionButtonXs(
  w: number,
  buttons: readonly CaptionButton[],
  metrics: ChromeMetrics = DEFAULT_METRICS,
): number[] {
  const slots = captionSlots(w, buttons, metrics);
  return buttons.map((b) => slots.find((s) => s.button === b)?.x ?? 0);
}

/** Whether the window carries its own menu bar strip under the caption.
 *  A screen bar takes the menus out of every window. */
export function hasWindowMenuBar(
  opts: Pick<ChromeOpts, "menuWidths">,
  metrics: ChromeMetrics = DEFAULT_METRICS,
): boolean {
  return opts.menuWidths.length > 0 && metrics.screenBarH === 0;
}

/** Content-area top inside the window (frame + caption + menu bar). */
export function contentTop(
  opts: Pick<ChromeOpts, "menuWidths">,
  metrics: ChromeMetrics = DEFAULT_METRICS,
): number {
  return (
    metrics.captionTop +
    metrics.titleH +
    metrics.titleGap +
    (hasWindowMenuBar(opts, metrics) ? metrics.menuH : 0)
  );
}

/** Change only chrome around an existing client rectangle. Child application
 *  surfaces depend on this invariant because their resolved logical viewport
 *  is the client size, independent of the System UI theme. */
export function reframeGeo(
  geo: Geo,
  opts: Pick<ChromeOpts, "menuWidths">,
  previous: ChromeMetrics,
  next: ChromeMetrics,
): Geo {
  const clientW = geo.w - previous.frame * 2;
  const clientH = geo.h - previous.frame - contentTop(opts, previous);
  return {
    ...geo,
    w: clientW + next.frame * 2,
    h: clientH + next.frame + contentTop(opts, next),
  };
}

/** Hit-test a point in window-local coordinates against the chrome. */
export function hitRegion(
  geo: Geo,
  opts: ChromeOpts,
  px: number,
  py: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
): Region | null {
  const x = px - geo.x;
  const y = py - geo.y;
  if (x < 0 || y < 0 || x >= geo.w || y >= geo.h) return null;

  // Resize bands claim the outer edge before anything else.
  if (opts.resizable && !opts.maximized) {
    const corner = metrics.resizeCorner;
    const n = y < metrics.resizeBand;
    const s = y >= geo.h - metrics.resizeBand;
    const w = x < metrics.resizeBand;
    const e = x >= geo.w - metrics.resizeBand;
    if (n || s || w || e) {
      const nearL = x < corner;
      const nearR = x >= geo.w - corner;
      const nearT = y < corner;
      const nearB = y >= geo.h - corner;
      let dir: Dir;
      if ((n && nearL) || (w && nearT)) dir = "nw";
      else if ((n && nearR) || (e && nearT)) dir = "ne";
      else if ((s && nearL) || (w && nearB)) dir = "sw";
      else if ((s && nearR) || (e && nearB)) dir = "se";
      else if (n) dir = "n";
      else if (s) dir = "s";
      else if (w) dir = "w";
      else dir = "e";
      return { kind: "resize", dir };
    }
  }

  // Caption strip.
  if (y >= metrics.captionTop && y < metrics.captionTop + metrics.titleH) {
    const btnTop = metrics.captionTop + metrics.buttonTop;
    if (y >= btnTop && y < btnTop + metrics.buttonH) {
      for (const slot of captionSlots(geo.w, opts.buttons, metrics)) {
        if (slot.present && x >= slot.x && x < slot.x + metrics.buttonW) {
          return { kind: "button", button: slot.button };
        }
      }
    }
    if (x >= metrics.frame && x < geo.w - metrics.frame)
      return { kind: "caption" };
  }

  // Menu bar.
  const menuTop = metrics.captionTop + metrics.titleH + metrics.titleGap;
  if (
    hasWindowMenuBar(opts, metrics) &&
    y >= menuTop &&
    y < menuTop + metrics.menuH
  ) {
    const i = menuIndexAt(x, metrics.frame, opts.menuWidths);
    if (i >= 0) return { kind: "menu", index: i };
  }

  const top = contentTop(opts, metrics);
  if (
    x >= metrics.frame &&
    x < geo.w - metrics.frame &&
    y >= top &&
    y < geo.h - metrics.frame
  ) {
    return { kind: "content", cx: x - metrics.frame, cy: y - top };
  }
  return { kind: "caption" }; // exposed frame padding drags with the caption
}

/** Index of the menu title under x in a row of titles starting at x0. */
export function menuIndexAt(
  x: number,
  x0: number,
  widths: readonly number[],
): number {
  let mx = x0;
  for (let i = 0; i < widths.length; i++) {
    if (x >= mx && x < mx + widths[i]) return i;
    mx += widths[i];
  }
  return -1;
}

/** Left x of the i-th menu title in a row starting at x0. */
export function menuTitleX(
  index: number,
  x0: number,
  widths: readonly number[],
): number {
  return x0 + widths.slice(0, index).reduce((a, w) => a + w, 0);
}

/** Apply a resize drag: dir edge follows the pointer, mins hold, the
 *  anchored edge never moves. */
export function resizeGeo(
  orig: Geo,
  dir: Dir,
  dx: number,
  dy: number,
  minW: number,
  minH: number,
): Geo {
  let { x, y, w, h } = orig;
  if (dir.includes("e")) w = Math.max(minW, orig.w + dx);
  if (dir.includes("s")) h = Math.max(minH, orig.h + dy);
  if (dir.includes("w")) {
    w = Math.max(minW, orig.w - dx);
    x = orig.x + orig.w - w;
  }
  if (dir.includes("n")) {
    h = Math.max(minH, orig.h - dy);
    y = orig.y + orig.h - h;
  }
  return { x, y, w, h };
}

/** Clamp a moved window so its caption stays reachable: some strip of the
 *  title bar remains on screen, below the screen bar and above the task
 *  strip. */
export function clampMove(
  geo: Geo,
  vpW: number,
  vpH: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
): Geo {
  const grip = 48; // px of caption that must stay visible
  const x = Math.min(Math.max(geo.x, grip - geo.w), vpW - grip);
  const y = Math.min(
    Math.max(geo.y, metrics.screenBarH),
    vpH - metrics.taskH - metrics.titleH,
  );
  return { ...geo, x, y };
}

/** Maximized geometry: the desktop between the screen bar and the task
 *  strip. */
export function maximizedGeo(
  vpW: number,
  vpH: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
): Geo {
  return {
    x: 0,
    y: metrics.screenBarH,
    w: vpW,
    h: vpH - metrics.screenBarH - metrics.taskH,
  };
}

/** Cascade position for the i-th opened window. */
export function cascadePos(
  i: number,
  vpW: number,
  vpH: number,
  w: number,
  h: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
): Geo {
  const step = 24;
  const cols = Math.max(
    1,
    Math.floor((vpH - metrics.screenBarH - metrics.taskH - h - 8) / step) + 1,
  );
  const k = i % Math.max(1, cols);
  const x = Math.min(64 + i * step, Math.max(8, vpW - w - 8));
  const y = metrics.screenBarH + 28 + k * step;
  return { x, y, w, h };
}

/** The resize cursor for a band direction ({t:"cursor"} intent keys). */
export function cursorForDir(dir: Dir): "ew" | "ns" | "nwse" | "nesw" {
  switch (dir) {
    case "e":
    case "w":
      return "ew";
    case "n":
    case "s":
      return "ns";
    case "nw":
    case "se":
      return "nwse";
    case "ne":
    case "sw":
      return "nesw";
  }
}

// ---------------------------------------------------------------------------
// Task strip (taskbar buttons / Dock tiles)
// ---------------------------------------------------------------------------

export interface TaskLayout {
  /** Width of one button. */
  buttonW: number;
  /** Left x of the first button. */
  x0: number;
  /** Top y of the button row. */
  y0: number;
  h: number;
}

/** Where the task buttons sit for `count` entries. A left-aligned strip
 *  starts after the launcher and shares the width left of the tray; a
 *  centered shelf (the Dock) wraps its tiles and floats mid-screen. Paint
 *  lets the flex engine place the same boxes; the arithmetic here mirrors
 *  it so hit testing lands on the painted buttons. */
export function taskLayout(
  vpW: number,
  vpH: number,
  count: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
): TaskLayout {
  const n = Math.max(1, count);
  if (metrics.taskAlign === "center") {
    const buttonW = metrics.taskButtonMaxW;
    const total =
      n * buttonW + (n - 1) * metrics.taskGap + metrics.taskPad * 2;
    return {
      buttonW,
      x0: Math.floor((vpW - total) / 2) + metrics.taskPad,
      y0: vpH - metrics.taskH,
      h: metrics.taskH,
    };
  }
  const buttonW = Math.min(
    metrics.taskButtonMaxW,
    Math.floor(
      (vpW -
        metrics.taskLeft -
        metrics.taskStartW -
        metrics.taskTrayW -
        n * metrics.taskGap) /
        n,
    ),
  );
  return {
    buttonW,
    x0:
      metrics.taskLeft +
      metrics.taskStartW +
      metrics.taskGap * 2 +
      metrics.taskDividerW,
    y0: vpH - metrics.taskH + 3,
    h: metrics.taskH - 3,
  };
}

/** Index of the task button under a point, or -1. */
export function taskEntryIndexAt(
  x: number,
  y: number,
  vpW: number,
  vpH: number,
  count: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
): number {
  const layout = taskLayout(vpW, vpH, count, metrics);
  if (y < layout.y0 || y >= layout.y0 + layout.h) return -1;
  for (let i = 0; i < count; i++) {
    const bx = layout.x0 + i * (layout.buttonW + metrics.taskGap);
    if (x >= bx && x < bx + layout.buttonW) return i;
  }
  return -1;
}

/** Whether a point is on the launcher button. With a screen bar the
 *  launcher is the logo at the bar's left end; otherwise it is the Start
 *  button at the task strip's left end. */
export function launcherHit(
  x: number,
  y: number,
  vpH: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
): boolean {
  const inRow =
    metrics.screenBarH > 0
      ? y < metrics.screenBarH
      : y >= vpH - metrics.taskH;
  return (
    inRow &&
    x >= metrics.taskLeft &&
    x < metrics.taskLeft + metrics.taskStartW
  );
}

// ---------------------------------------------------------------------------
// Start panel
// ---------------------------------------------------------------------------

/** One hit/paint rectangle in the Start panel, in desktop coordinates. */
export interface StartRow {
  /** Index into the item list the layout was built from. */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StartLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Column split (0 when the theme paints one column beside a rail). */
  leftW: number;
  /** The places column's width (0 for one column). */
  rightW: number;
  headerH: number;
  footerH: number;
  bodyY: number;
  bodyH: number;
  rows: StartRow[];
}

interface StartItem {
  sep?: boolean;
  col?: "right";
  bottom?: boolean;
  foot?: boolean;
}

/** Panel geometry for a Start item list. One function serves every panel:
 *  Classic stacks every item in one column beside its rail, XP splits them
 *  into a programs column and a places column, pins `bottom` items under the
 *  programs column and lays `foot` items along the bottom strip, Aqua stacks
 *  one column under the screen bar. Paint (chrome.tsx) and hit testing
 *  (app.tsx) both read these rectangles, so a theme switch can never leave
 *  one of them behind.
 *
 *  The panel is as wide as its rows: `rowW(i)` is item i's natural width
 *  (its label, icon slot, arrow and padding), and a column the theme draws
 *  at `startLeftW` or `startW` grows to its widest row, up to `maxW` for the
 *  whole panel. A row wider than what is left past `maxW` has its label cut
 *  (`fitLabel` in chrome.tsx). Without `rowW` the panel keeps the theme's widths. */
export function startLayout(
  items: readonly StartItem[],
  vpH: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
  rowW: (index: number) => number = () => 0,
  maxW = Number.POSITIVE_INFINITY,
): StartLayout {
  const {
    startRowH: row,
    startSepH: sep,
    startPadX: padX,
    startPadY: padY,
  } = metrics;
  const twoColumn = metrics.startHeaderH > 0;
  const widest = (which: (it: StartItem) => boolean) =>
    items.reduce((a, it, i) => (it.sep || it.foot || !which(it) ? a : Math.max(a, Math.ceil(rowW(i)))), 0);

  let leftW = metrics.startLeftW;
  let rightW = metrics.startW - metrics.startLeftW - padX * 2;
  let panelW = metrics.startW;
  if (twoColumn) {
    const leftMin = leftW;
    const rightMin = rightW;
    leftW = Math.max(leftMin, widest((it) => it.col !== "right"));
    rightW = Math.max(rightMin, widest((it) => it.col === "right"));
    // Past the maximum the places column gives back its growth first.
    let over = padX * 2 + leftW + rightW - Math.max(metrics.startW, maxW);
    if (over > 0) {
      const back = Math.min(over, rightW - rightMin);
      rightW -= back;
      over -= back;
      leftW -= Math.min(over, leftW - leftMin);
    }
    panelW = padX * 2 + leftW + rightW;
  } else {
    const content = widest(() => true) + padX * 2 + metrics.startRailW;
    panelW = Math.max(metrics.startW, Math.min(content, maxW));
  }

  const height = (which: (it: StartItem) => boolean) =>
    items.filter(which).reduce((a, it) => a + (it.sep ? sep : row), 0);

  let bodyH: number;
  if (twoColumn) {
    const left = height((it) => !it.foot && it.col !== "right" && !it.bottom);
    const bottom = height((it) => !it.foot && !!it.bottom);
    const right = height((it) => !it.foot && it.col === "right");
    // Pinned rows (their own separator included) sit at the column's foot.
    bodyH = Math.max(left + bottom, right);
  } else {
    bodyH = height((it) => true);
  }

  const h = metrics.startHeaderH + bodyH + metrics.startFooterH + padY * 2;
  const x = metrics.startX;
  // Rises from the task strip, or hangs from the screen bar.
  const y = metrics.screenBarH > 0 ? metrics.screenBarH : vpH - metrics.taskH - h;
  const bodyY = y + padY + metrics.startHeaderH;

  const rows: StartRow[] = [];
  if (twoColumn) {
    let ly = bodyY;
    let ry = bodyY;
    const bottomH = height((it) => !it.foot && !!it.bottom);
    const bottomY = bodyY + bodyH - bottomH;
    let by = bottomY;
    let fx = x + panelW - padX;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const h = it.sep ? sep : row;
      if (it.foot) {
        const w = Math.round(metrics.startW / 2);
        fx -= w;
        rows.push({
          index: i,
          x: fx,
          y: y + padY + metrics.startHeaderH + bodyH,
          w,
          h: metrics.startFooterH,
        });
        continue;
      }
      if (it.bottom) {
        if (!it.sep) rows.push({ index: i, x: x + padX, y: by, w: leftW, h });
        by += h;
        continue;
      }
      if (it.col === "right") {
        if (!it.sep)
          rows.push({ index: i, x: x + padX + leftW, y: ry, w: rightW, h });
        ry += h;
        continue;
      }
      if (!it.sep) rows.push({ index: i, x: x + padX, y: ly, w: leftW, h });
      ly += h;
    }
  } else {
    let oy = y + padY;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const h = it.sep ? sep : row;
      if (!it.sep)
        rows.push({
          index: i,
          x: x + padX + metrics.startRailW,
          y: oy,
          w: panelW - padX * 2 - metrics.startRailW,
          h,
        });
      oy += h;
    }
  }

  return {
    x,
    y,
    w: panelW,
    h,
    leftW: twoColumn ? leftW : 0,
    rightW: twoColumn ? rightW : 0,
    headerH: metrics.startHeaderH,
    footerH: metrics.startFooterH,
    bodyY,
    bodyH,
    rows,
  };
}

/** The item index under a point, or -1. */
export function startRowAt(layout: StartLayout, x: number, y: number): number {
  for (const r of layout.rows) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.index;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Popups
// ---------------------------------------------------------------------------

interface PopupItemLike {
  sep?: boolean;
}

/** Height of a popup panel for its items, padding included. */
export function popupHeight(
  items: readonly PopupItemLike[],
  metrics: ChromeMetrics = DEFAULT_METRICS,
): number {
  return (
    metrics.popupPadY * 2 +
    items.reduce(
      (a, it) => a + (it.sep ? metrics.popupSepH : metrics.popupRowH),
      0,
    )
  );
}

/** Index of the popup row under a point (in the panel's own frame of
 *  reference), -1 for padding, separators or outside. */
export function popupRowAt(
  items: readonly PopupItemLike[],
  x: number,
  y: number,
  w: number,
  metrics: ChromeMetrics = DEFAULT_METRICS,
): number {
  if (x < metrics.popupPadX || x >= w - metrics.popupPadX) return -1;
  let oy = metrics.popupPadY;
  for (let i = 0; i < items.length; i++) {
    const h = items[i].sep ? metrics.popupSepH : metrics.popupRowH;
    if (y >= oy && y < oy + h) return items[i].sep ? -1 : i;
    oy += h;
  }
  return -1;
}
