// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/programs.tsx — the window contents: Notepad (with selection),
// Minesweeper, the Explorer-style folder view, About and Shut Down dialogs.
// SolidJS JSX, presentational like chrome.tsx; each program also exports
// the content-local hit helpers app.tsx routes clicks through, so render
// geometry and hit geometry sit in one file. Content coordinates are
// (cx, cy) from wm.ts hitRegion — origin at the frame's inner top-left,
// below caption (and menu bar if present).

import { createMemo } from "solid-js";
import {
  CompositorSurface,
  Image,
  View,
} from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import { UiText } from "./chrome.tsx";
import { FONT, type DesktopTheme, type FolderTool } from "./theme.ts";
import {
  caretXY,
  segSelSpan,
  type VSeg,
} from "./notepad.ts";
import { MINES_W, type Cell } from "./mines.ts";
import {
  type AboutData,
  type FolderData,
  type MinesData,
  type PadData,
  type PocketData,
  type ShutdownData,
  type WinCtl,
} from "./state.ts";

export function measure(s: string, slot: number): number {
  const ops = getOps();
  return ops.measureText ? ops.measureText(s, slot) : s.length * 7;
}

// ---------------------------------------------------------------------------
// Notepad
// ---------------------------------------------------------------------------

export const PAD_LINE_H = 16;
export const PAD_PAD = 3; // inset of the text from the white well

// Baked glyph advances serve caret and pointer geometry within accepted rows.
// Whole-document wrapping is owned by the asynchronous Rust text service.
// Slots identify immutable atlases, including across theme changes.
const widthCache = new Map<string, number>();

/** Cached width in one baked slot for caret and selection helpers. The key carries the slot: a theme switch changes the face under
 *  the same strings. */
export function padWidth(s: string, slot: number): number {
  if (s === "") return 0;
  const key = `${slot}\u0000${s}`;
  let w = widthCache.get(key);
  if (w === undefined) {
    if (widthCache.size > 4096) widthCache.clear();
    w = measure(s, slot);
    widthCache.set(key, w);
  }
  return w;
}

/** `padWidth` bound to a slot, for the pure helpers that take a measurer. */
export function padWidthFor(slot: number): (s: string) => number {
  return (s) => padWidth(s, slot);
}

/** Wrap width for a notepad window: the content well minus the 3px text
 *  insets (mirrors NotepadView's left-[3] + right margin). Infinity when
 *  Word Wrap is off — every line becomes one visual segment. */
export function padWrapW(w: WinCtl, frame: number): number {
  const d = w.data as PadData;
  return d.wrap()
    ? Math.max(40, w.geo().w - frame * 2 - PAD_PAD * 2)
    : Infinity;
}

/** Geometry is accepted only with its source, width and font revision. */
export function padSegs(w: WinCtl, frame: number, slot: number): VSeg[] {
  const d = w.data as PadData, layout = d.layout();
  return layout.status === "ready" && layout.lines === d.doc().lines &&
    layout.width === padWrapW(w, frame) && layout.slot === slot ? layout.rows : [];
}

export function NotepadView(props: {
  data: PadData;
  wrapW: number;
  viewH: number;
  active: boolean;
  theme: DesktopTheme;
}) {
  const d = props.data;
  const slot = () => props.theme.fontSlot("ui");
  const segsAll = () => d.layout().rows;
  const firstRow = () => Math.max(0, Math.floor(d.scroll() / PAD_LINE_H) - 1);
  const visibleRows = () => segsAll().slice(firstRow(), firstRow() + Math.ceil(props.viewH / PAD_LINE_H) + 2);
  const current = () => d.layout().status === "ready" && d.layout().lines === d.doc().lines && d.layout().slot === slot() && d.layout().width === props.wrapW;
  const caretPos = () =>
    caretXY(segsAll(), d.doc().lines, d.doc().caret, padWidthFor(slot()));
  const caretX = () => {
    const pre = d.preedit();
    return caretPos().x + (pre ? padWidth(pre.s.slice(0, pre.c), slot()) : 0);
  };
  /** Visual-segment text split at the selection edges. */
  const parts = (seg: VSeg): { t: string; sel: boolean }[] => {
    const line = d.layout().lines[seg.row];
    const span = current() ? segSelSpan(d.doc(), seg) : null;
    if (!span) return [{ t: line.slice(seg.from, seg.to), sel: false }];
    return [
      { t: line.slice(seg.from, span.from), sel: false },
      { t: line.slice(span.from, span.to), sel: true },
      { t: line.slice(span.to, seg.to), sel: false },
    ];
  };
  return (
    <View class={props.theme.notepadWell}>
      {d.layout().status === "companion-required" ? <UiText theme={props.theme} t="Pair a companion to enable text layout." /> : null}
      {d.layout().status === "error" ? <UiText theme={props.theme} t={d.layout().error ?? "Text layout unavailable"} /> : null}
      <View class="flex-1 relative overflow-hidden">
        <View
          class="absolute left-[3] top-[3] right-0 flex-col"
          style={{ translateY: firstRow() * PAD_LINE_H - d.scroll() }}
        >
          {visibleRows().map((seg, vi) => (
            <View class="h-[16] flex-row items-center">
              {current() && vi + firstRow() === caretPos().vrow && d.preedit()
                ? [
                    <UiText
                      theme={props.theme}
                      t={d.doc().lines[seg.row].slice(
                        seg.from,
                        d.doc().caret.col,
                      )}
                    />,
                    <View class="flex-col">
                      <UiText theme={props.theme} t={d.preedit()!.s} />
                      <View class="h-[1] bg-[#000000]" />
                    </View>,
                    <UiText
                      theme={props.theme}
                      t={d.doc().lines[seg.row].slice(
                        d.doc().caret.col,
                        seg.to,
                      )}
                    />,
                  ]
                : parts(seg).map((p) =>
                    p.sel ? (
                      <View class={props.theme.selection}>
                        <UiText theme={props.theme} cls={props.theme.selectionText} t={p.t} />
                      </View>
                    ) : (
                      <UiText theme={props.theme} t={p.t} />
                    ),
                  )}
            </View>
          ))}
        </View>
        {props.active && current() ? (
          <View
            class="absolute w-[1] h-[14] bg-[#000000] animate-caret"
            style={{
              insetL: 0,
              insetT: 0,
              translateX: 3 + caretX(),
              translateY: 3 + caretPos().vrow * PAD_LINE_H - d.scroll() + 1,
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pocket app surface — an explicit native-compositor instruction at this exact
// point in shell paint order. The fallback remains visible without a runtime
// AppSupervisor or while the isolated package has no DrawList to paint.
// ---------------------------------------------------------------------------

export function PocketAppView(props: {
  data: PocketData;
  active: boolean;
  theme: DesktopTheme;
}) {
  return (
    <View class="flex-1 relative overflow-hidden bg-[#000000]">
      <View class={props.theme.pocketLoading}>
        <Image class="w-[32] h-[32] mb-[8]" src={props.theme.icon("pocket", 32)} />
        <UiText theme={props.theme} t={`Starting ${props.data.app.title}...`} />
        <UiText theme={props.theme} cls={props.theme.mutedText} t="Arrow keys + Z/X/A/S + Q/W" />
      </View>
      <CompositorSurface
        class="absolute inset-0"
        package={props.data.app.package}
        focused={props.active}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Minesweeper — fixed-size window; all metrics in content-local px.
// ---------------------------------------------------------------------------

export const MINES_GEO = { w: 166, h: 227 } as const;
const M_PAD = 5; // content padding
const M_HEADER_H = 36;
const M_FIELD_TOP = M_PAD + M_HEADER_H + 6; // header + gap
const M_CELL = 16;
const M_CELLS_X = M_PAD + 3; // field bevel-w-[3] ring
const M_CELLS_Y = M_FIELD_TOP + 3;

export type MinesHit = { type: "cell"; i: number } | { type: "smiley" } | null;

export function minesHit(cx: number, cy: number): MinesHit {
  const sx = 160 / 2 - 13;
  if (cx >= sx && cx < sx + 26 && cy >= M_PAD + 5 && cy < M_PAD + 5 + 26) {
    return { type: "smiley" };
  }
  const x = Math.floor((cx - M_CELLS_X) / M_CELL);
  const y = Math.floor((cy - M_CELLS_Y) / M_CELL);
  if (x >= 0 && x < 9 && y >= 0 && y < 9)
    return { type: "cell", i: y * MINES_W + x };
  return null;
}

const NUM_COLORS = [
  "", // 0 unused
  "text-[#0000ff]",
  "text-[#008000]",
  "text-[#ff0000]",
  "text-[#000080]",
  "text-[#800000]",
  "text-[#008080]",
  "text-[#000000]",
  "text-[#808080]",
];

const SEGS: Record<string, number> = {
  "0": 0b0111111,
  "1": 0b0000110,
  "2": 0b1011011,
  "3": 0b1001111,
  "4": 0b1100110,
  "5": 0b1101101,
  "6": 0b1111101,
  "7": 0b0000111,
  "8": 0b1111111,
  "9": 0b1101111,
  "-": 0b1000000,
  " ": 0,
};

/** One 7-seg digit, 13×23, red on black.
 *     a
 *   f   b        segments: bit 0..6 = a b c d e f g
 *     g
 *   e   c
 *     d
 */
function Digit(props: { ch: string }) {
  const on = (bit: number) => (((SEGS[props.ch] ?? 0) >> bit) & 1) === 1;
  return (
    <View class="w-[13] h-[23] bg-[#000000] relative">
      <View
        class={
          on(0)
            ? "absolute left-[2] top-[1] w-[9] h-[2] bg-[#ff0000]"
            : "absolute left-[2] top-[1] w-[9] h-[2] bg-[#3a0000]"
        }
      />
      <View
        class={
          on(1)
            ? "absolute left-[10] top-[2] w-[2] h-[9] bg-[#ff0000]"
            : "absolute left-[10] top-[2] w-[2] h-[9] bg-[#3a0000]"
        }
      />
      <View
        class={
          on(2)
            ? "absolute left-[10] top-[12] w-[2] h-[9] bg-[#ff0000]"
            : "absolute left-[10] top-[12] w-[2] h-[9] bg-[#3a0000]"
        }
      />
      <View
        class={
          on(3)
            ? "absolute left-[2] top-[20] w-[9] h-[2] bg-[#ff0000]"
            : "absolute left-[2] top-[20] w-[9] h-[2] bg-[#3a0000]"
        }
      />
      <View
        class={
          on(4)
            ? "absolute left-[1] top-[12] w-[2] h-[9] bg-[#ff0000]"
            : "absolute left-[1] top-[12] w-[2] h-[9] bg-[#3a0000]"
        }
      />
      <View
        class={
          on(5)
            ? "absolute left-[1] top-[2] w-[2] h-[9] bg-[#ff0000]"
            : "absolute left-[1] top-[2] w-[2] h-[9] bg-[#3a0000]"
        }
      />
      <View
        class={
          on(6)
            ? "absolute left-[2] top-[10] w-[9] h-[3] bg-[#ff0000]"
            : "absolute left-[2] top-[10] w-[9] h-[3] bg-[#3a0000]"
        }
      />
    </View>
  );
}

/** Three-digit 7-seg counter (mine count / timer), clamped to -99..999. */
function Counter(props: { value: number; theme: DesktopTheme }) {
  const text = createMemo(() => {
    const v = Math.max(-99, Math.min(999, Math.round(props.value)));
    return v < 0
      ? "-" + String(-v).padStart(2, "0")
      : String(v).padStart(3, "0");
  });
  return (
    <View class={props.theme.minesCounter}>
      <Digit ch={text()[0]} />
      <Digit ch={text()[1]} />
      <Digit ch={text()[2]} />
    </View>
  );
}

/** One field cell: raised while hidden, flat when revealed (the bust mine
 *  on red), flag/mine art, colored adjacency digit. The cell faces are the
 *  theme's; the flag and mine are the game's own art on every theme. */
function MinesCell(props: { data: MinesData; i: number; theme: DesktopTheme }) {
  const c = (): Cell => props.data.board().cells[props.i];
  const heldDown = () =>
    props.data.held() === props.i && c().state === "hidden";
  // The hidden/revealed swap must sit in a JSX child position — a bare
  // ternary returned from the component body evaluates once at setup.
  return (
    <View class="w-[16] h-[16] relative">
      {c().state !== "revealed" ? (
        <View class={props.theme.minesCell(heldDown() ? "held" : "hidden")}>
          {c().state === "flag" ? (
            <Image class="w-[8] h-[8]" src="icons/flag.svg" />
          ) : null}
        </View>
      ) : (
        <View
          class={props.theme.minesCell(
            props.data.board().bust === props.i ? "bust" : "revealed",
          )}
        >
          {c().mine ? (
            <Image class="w-[8] h-[8]" src="icons/mine.svg" />
          ) : c().adj > 0 ? (
            <UiText
              theme={props.theme}
              bold
              cls={NUM_COLORS[c().adj] || "text-[#000000]"}
              t={String(c().adj)}
            />
          ) : null}
        </View>
      )}
    </View>
  );
}

const ROWS9 = Array.from({ length: MINES_W }, (_, i) => i);

/** Minesweeper content: sunken header (mine counter, smiley, timer) over the
 *  9×9 field. The grid rides static index arrays — the board ref retriggers
 *  cell reads, rows never move. */
export function MinesView(props: {
  data: MinesData;
  theme: DesktopTheme;
}) {
  const d = props.data;
  const smiley = () => {
    if (d.smileyHeld()) return "icons/smile.svg";
    const m = d.board();
    if (m.phase === "lost") return "icons/smile-dead.svg";
    if (m.phase === "won") return "icons/smile-cool.svg";
    if (d.held() >= 0) return "icons/smile-ooh.svg";
    return "icons/smile.svg";
  };
  return (
    <View class={props.theme.minesRoot}>
      <View class={props.theme.minesPanel}>
        <Counter value={10 - d.board().flags} theme={props.theme} />
        <View class={props.theme.minesSmiley(d.smileyHeld())}>
          <Image class="w-[16] h-[16]" src={smiley()} />
        </View>
        <Counter value={d.elapsed()} theme={props.theme} />
      </View>
      <View class="h-[6]" />
      <View class={props.theme.minesField}>
        {ROWS9.map((ry) => (
          <View class="flex-row">
            {ROWS9.map((rx) => (
              <MinesCell data={d} i={ry * MINES_W + rx} theme={props.theme} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Folder: a places sidebar beside the details list. The sidebar's width,
// top inset and row height are theme metrics so
// the hit test below and the paint agree under every skin.
// ---------------------------------------------------------------------------

export const FOLDER_HEADER_H = 17;
export const FOLDER_ROW_H = 17;
export const FOLDER_STATUS_H = 20;

/** Row index for a click at list-local y, -1 none. */
export function folderRowAt(cy: number, rowCount: number): number {
  const i = Math.floor((cy - 1 - FOLDER_HEADER_H) / FOLDER_ROW_H);
  return i >= 0 && i < rowCount ? i : -1;
}

export type FolderHit =
  | { kind: "tool"; tool: FolderTool }
  | { kind: "place"; i: number }
  | { kind: "row"; i: number }
  | null;

/** Content-local hit: a toolbar button, a sidebar place, a list row, or
 *  nothing. The toolbar spans the top `folderToolH`; the panes sit below. */
export function folderHit(
  cx: number,
  cy: number,
  rowCount: number,
  placeCount: number,
  theme: DesktopTheme,
): FolderHit {
  const m = theme.metrics;
  if (cy < m.folderToolH) {
    const top = Math.floor((m.folderToolH - m.folderToolBtnH) / 2);
    if (cy < top || cy >= top + m.folderToolBtnH) return null;
    for (let i = 0; i < theme.folderTools.length; i++) {
      const x = m.folderToolPadX + i * (m.folderToolBtnW + m.folderToolGap);
      if (cx >= x && cx < x + m.folderToolBtnW)
        return { kind: "tool", tool: theme.folderTools[i] };
    }
    return null;
  }
  const py = cy - m.folderToolH;
  if (cx < m.folderSideW) {
    const i = Math.floor((py - m.folderSideTop) / m.folderSideRowH);
    return i >= 0 && i < placeCount ? { kind: "place", i } : null;
  }
  if (cx < m.folderSideW + m.folderSideGap) return null;
  const i = folderRowAt(py, rowCount);
  return i >= 0 ? { kind: "row", i } : null;
}

/** Whether a toolbar action applies to the window's current history. */
export function folderToolEnabled(d: FolderData, tool: FolderTool): boolean {
  const h = d.hist();
  if (tool === "back") return h.at > 0;
  if (tool === "forward") return h.at < h.items.length - 1;
  return d.place() !== "computer";
}

export function FolderView(props: {
  data: FolderData;
  resizable: boolean;
  active: boolean;
  theme: DesktopTheme;
}) {
  const d = props.data;
  const current = (i: number) => d.places[i].id === d.place();
  const place = () => d.places.find((p) => p.id === d.place()) ?? d.places[0];
  return (
    <View class="flex-1 flex-col">
      <View class={props.theme.folderToolbar}>
        {props.theme.folderToolLayers.map((cls) => (
          <View class={cls} />
        ))}
        {props.theme.folderTools.map((tool) => (
          <View
            class={props.theme.folderToolButton(
              folderToolEnabled(d, tool),
              d.toolHeld() === tool,
            )}
          >
            <Image class="w-[16] h-[16]" src={props.theme.icon(tool, 16)} />
          </View>
        ))}
        {props.theme.folderAddressLabel !== "" ? (
          <View class="ml-[6] mr-[2]">
            <UiText theme={props.theme} t={props.theme.folderAddressLabel} />
          </View>
        ) : null}
        <View class={props.theme.folderAddress}>
          <Image class="w-[16] h-[16]" src={props.theme.icon(place().icon, 16)} />
          <UiText
            theme={props.theme}
            cls={props.theme.folderAddressText}
            t={place().label}
          />
        </View>
        {props.theme.folderSearch !== "" ? (
          <View class={props.theme.folderSearch}>
            <Image class="w-[16] h-[16]" src={props.theme.icon("find", 16)} />
            <UiText theme={props.theme} cls={props.theme.folderSearchText} t="Search" />
          </View>
        ) : null}
      </View>
      <View class="flex-1 flex-row">
      <View class={props.theme.folderSidebar}>
        {props.theme.folderSideLayers.map((cls) => (
          <View class={cls} />
        ))}
        {props.theme.folderSideHeadingLabel !== "" ? (
          <View class={props.theme.folderSideHeading}>
            <UiText
              theme={props.theme}
              bold
              cls={props.theme.folderSideHeadingText}
              t={props.theme.folderSideHeadingLabel}
            />
          </View>
        ) : null}
        <View class={props.theme.folderSidePanel}>
          {d.places.map((place, i) => (
            <View class={props.theme.folderSideItem(current(i), props.active)}>
              <Image class="w-[16] h-[16]" src={props.theme.icon(place.icon, 16)} />
              <View class="flex-1 flex-row overflow-hidden">
                <UiText
                  theme={props.theme}
                  cls={props.theme.folderSideText(current(i), props.active)}
                  t={place.label}
                />
              </View>
            </View>
          ))}
        </View>
      </View>
      <View class={props.theme.folderWell}>
        <View class="h-[17] flex-row shrink-0">
          <View class={props.theme.folderHeader("name")}>
            <UiText theme={props.theme} t="Name" />
          </View>
          <View class={props.theme.folderHeader("size")}>
            <UiText theme={props.theme} t="Size" />
          </View>
          <View class={props.theme.folderHeader("type")}>
            <UiText theme={props.theme} t="Type" />
          </View>
        </View>
        {d.rows().map((row, i) => (
          <View
            class={props.theme.folderRow(d.selected() === i, i % 2 === 1)}
          >
            <Image class="w-[16] h-[16] mr-[4]" src={props.theme.icon(row.icon, 16)} />
            <View class="flex-1 flex-row overflow-hidden">
              <UiText
                theme={props.theme}
                cls={
                  d.selected() === i
                    ? props.theme.selectionText
                    : "text-[#000000]"
                }
                t={row.name}
              />
            </View>
            <View class="w-[64] flex-row justify-end pr-[6]">
              <UiText
                theme={props.theme}
                cls={
                  d.selected() === i
                    ? props.theme.selectionText
                    : "text-[#000000]"
                }
                t={row.size}
              />
            </View>
            <View class="w-[104] flex-row pl-[6]">
              <UiText
                theme={props.theme}
                cls={
                  d.selected() === i
                    ? props.theme.selectionText
                    : "text-[#000000]"
                }
                t={row.type}
              />
            </View>
          </View>
        ))}
        {d.rows().length === 0 ? (
          <View class="flex-1 flex-col justify-center items-center">
            <UiText theme={props.theme} cls={props.theme.mutedText} t="(empty)" />
          </View>
        ) : null}
      </View>
      </View>
      <View class="h-[20] flex-row items-end gap-[2] pt-[2]">
        <View class={props.theme.statusWell}>
          <UiText theme={props.theme} t={`${d.rows().length} object(s)`} />
        </View>
        {props.resizable ? (
          <Image class="w-[16] h-[16]" src={props.theme.icon("grip", 16)} />
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// About + Shut Down dialogs
// ---------------------------------------------------------------------------

// Classic outer sizes; other themes reframe them around the same client
// rectangle. About leaves room for the taller antialiased faces' line boxes.
export const ABOUT_GEO = { w: 340, h: 260 } as const;
export const SHUTDOWN_GEO = { w: 300, h: 176 } as const;

/** Dialog push button; armed = pressed face + 1px content nudge. `primary`
 *  marks the default button (Enter) — Aqua paints it as the blue gel. */
function DialogButton(props: {
  label: string;
  armed: boolean;
  primary?: boolean;
  theme: DesktopTheme;
}) {
  return (
    <View class={props.theme.dialogButton(props.armed, props.primary ?? false)}>
      <View class={props.armed ? "ml-[1] mt-[1]" : ""}>
        <UiText
          theme={props.theme}
          cls={props.theme.dialogButtonText(props.primary ?? false)}
          t={props.label}
        />
      </View>
    </View>
  );
}

/** Content-local button hits for the About dialog. */
export function aboutHit(
  contentW: number,
  contentH: number,
  cx: number,
  cy: number,
): "ok" | null {
  const x = contentW - 10 - 75;
  const y = contentH - 10 - 23;
  return cx >= x && cx < x + 75 && cy >= y && cy < y + 23 ? "ok" : null;
}

export function AboutView(props: {
  data: AboutData;
  theme: DesktopTheme;
}) {
  return (
    <View class="flex-1 flex-col p-[10] gap-[8]">
      <View class="flex-row items-center gap-[10]">
        <Image class="w-[32] h-[32]" src={props.theme.icon("computer", 32)} />
        <UiText theme={props.theme} xl t="Pocket Shell" />
      </View>
      <View class="h-[2] flex-col">
        <View class={props.theme.popupSeparatorDark} />
        <View class={props.theme.popupSeparatorLight} />
      </View>
      <UiText theme={props.theme} t="A desktop compositor demo on the portable Rust backend." />
      <UiText theme={props.theme} t="SolidJS JSX over the same DrawList the" />
      <UiText theme={props.theme} t="consoles boot; windows, menus and shortcuts" />
      <UiText theme={props.theme} t="live in the guest." />
      <UiText
        theme={props.theme}
        cls={props.theme.mutedText}
        t="github.com/pocket-stack/pocket-shell"
      />
      <View class="flex-1" />
      <View class="flex-row justify-end">
        <DialogButton
          label="OK"
          armed={props.data.armed() === "ok"}
          primary
          theme={props.theme}
        />
      </View>
    </View>
  );
}

export type ShutdownHit = "ok" | "cancel" | "radio0" | "radio1" | null;

export function shutdownHit(
  contentW: number,
  contentH: number,
  cx: number,
  cy: number,
): ShutdownHit {
  const by = contentH - 10 - 23;
  const cancelX = contentW - 10 - 75;
  const okX = cancelX - 6 - 75;
  if (cy >= by && cy < by + 23) {
    if (cx >= okX && cx < okX + 75) return "ok";
    if (cx >= cancelX && cx < cancelX + 75) return "cancel";
  }
  for (const i of [0, 1]) {
    const ry = 46 + i * 20;
    if (cx >= 56 && cx < 220 && cy >= ry && cy < ry + 18)
      return i === 0 ? "radio0" : "radio1";
  }
  return null;
}

export function ShutdownView(props: {
  data: ShutdownData;
  theme: DesktopTheme;
}) {
  const radio = (i: number, label: string) => (
    <View class="h-[20] flex-row items-center gap-[6]">
      <View class="w-[12] h-[12] rounded-full bg-[#808080] flex-col justify-center items-center">
        <View class="w-[10] h-[10] rounded-full bg-[#ffffff] flex-col justify-center items-center">
          {props.data.choice() === i ? (
            <View class="w-[4] h-[4] rounded-full bg-[#000000]" />
          ) : null}
        </View>
      </View>
      <UiText theme={props.theme} t={label} />
    </View>
  );
  return (
    <View class="flex-1 flex-col p-[10]">
      <View class="flex-row items-start gap-[10]">
        <Image class="w-[32] h-[32]" src={props.theme.icon("shutdown", 32)} />
        <View class="flex-col gap-[2]">
          <UiText theme={props.theme} t="What do you want the computer to do?" />
        </View>
      </View>
      <View class="h-[10]" />
      <View class="flex-col pl-[46]">
        {radio(0, "Shut down")}
        {radio(1, "Restart")}
      </View>
      <View class="flex-1" />
      <View class="flex-row justify-end gap-[6]">
        <DialogButton
          label="OK"
          armed={props.data.armed() === "ok"}
          primary
          theme={props.theme}
        />
        <DialogButton
          label="Cancel"
          armed={props.data.armed() === "cancel"}
          theme={props.theme}
        />
      </View>
    </View>
  );
}
