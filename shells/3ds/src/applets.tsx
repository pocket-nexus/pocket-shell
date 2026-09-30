// SPDX-License-Identifier: GPL-3.0-or-later
// src/applets.tsx — what the windows hold. Every applet is
// self-contained on the console: pocketsh drives the window manager itself,
// notes is a scratch pad, and top reads the frame loop the way Omarchy's
// btop reads the machine. The time lives in the bar and the chord table in
// the key sheet, so neither needs a window.
//
// An applet is given its content size and reads its own state object from
// the store (one per window, mutated in place, revalidated through `rev`).
// Text rows are absolutely positioned: on this host a Text that is a direct
// flex child of a short bar can paint nothing, so rows are offsets.

import { Index, Show } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework";
import { keySheet } from "./chords.ts";
import { formatClock, formatDate, formatUptime } from "./shell.ts";
import { FPS_SLOTS, type AppId, type ShellStore } from "./store.ts";

const SLOT_INDEX = Array.from({ length: FPS_SLOTS }, (_, i) => i);

export interface AppletProps {
  id: number;
  app: AppId;
  store: ShellStore;
  /** Content size: the window minus border and header. */
  w: () => number;
  h: () => number;
}

/** 12 px JetBrains Mono is spec slot 16; its ~7.2 px advance snaps to a 7 px
 *  cell the way Pocket Term does it, so columns land on pixels. */
const MONO_SLOT = 16;
const LINE_H = 13;
const ROW_H = 13;
const PAD = 4;

let cellW = 7;
let measured = false;
function monoCell(): number {
  if (!measured) {
    measured = true;
    const advance = getOps().measureText("M", MONO_SLOT);
    if (advance > 0) cellW = Math.max(6, Math.round(advance));
  }
  return cellW;
}

/** Hard-wrap one logical line to `cols` cells. */
function wrap(line: string, cols: number, out: string[]): void {
  if (cols < 1) return;
  if (line.length === 0) {
    out.push("");
    return;
  }
  for (let i = 0; i < line.length; i += cols) out.push(line.slice(i, i + cols));
}

export function Applet(props: AppletProps) {
  switch (props.app) {
    case "term":
      return <Term {...props} />;
    case "notes":
      return <Notes {...props} />;
    case "top":
      return <Top {...props} />;
  }
}

// ---- term ---------------------------------------------------------------------

function Term(props: AppletProps) {
  const cell = monoCell();
  const cols = () => Math.max(4, Math.floor((props.w() - PAD * 2) / cell));
  const rows = () => Math.max(1, Math.floor((props.h() - PAD) / LINE_H));
  const state = () => {
    props.store.appletRev(props.id);
    const s = props.store.stateOf(props.id);
    return s && s.kind === "term" ? s : null;
  };
  /** Wrapped scrollback, then the visible window of it above the prompt. */
  const view = () => {
    const s = state();
    if (!s) return { lines: [] as string[], input: "", promptRow: 0 };
    const wrapped: string[] = [];
    for (const line of s.lines) wrap(line, cols(), wrapped);
    const visible = rows() - 1; // the prompt keeps the last row
    const maxScroll = Math.max(0, wrapped.length - visible);
    const scroll = Math.min(s.scroll, maxScroll);
    const end = wrapped.length - scroll;
    const start = Math.max(0, end - visible);
    const lines = wrapped.slice(start, end);
    return { lines, input: s.input, promptRow: lines.length };
  };
  const inputShown = () => {
    const text = view().input;
    const room = cols() - 3;
    return text.length > room ? text.slice(text.length - room) : text;
  };
  return (
    <View debugName="Term" class="absolute inset-0 bg-[#1a1b26]">
      <Index each={view().lines}>
        {(line, i) => (
          <Text
            class="absolute left-[4] font-mono text-xs text-[#a9b1d6]"
            style={{ insetT: PAD + i * LINE_H }}
          >
            {line()}
          </Text>
        )}
      </Index>
      <Text
        class="absolute left-[4] font-mono text-xs text-[#9ece6a] font-bold"
        style={{ insetT: PAD + view().promptRow * LINE_H }}
      >
        {"❯"}
      </Text>
      <Text
        class="absolute font-mono text-xs text-[#c0caf5]"
        style={{ insetL: PAD + cell * 2, insetT: PAD + view().promptRow * LINE_H }}
      >
        {inputShown()}
      </Text>
      <View
        class="absolute w-[7] h-[13] bg-[#7aa2f7]"
        style={{
          insetL: PAD + cell * (2 + inputShown().length),
          insetT: PAD + view().promptRow * LINE_H,
        }}
      />
    </View>
  );
}

// ---- notes --------------------------------------------------------------------

function Notes(props: AppletProps) {
  const cell = monoCell();
  const cols = () => Math.max(4, Math.floor((props.w() - PAD * 2) / cell));
  const rows = () => Math.max(1, Math.floor((props.h() - PAD) / LINE_H));
  const state = () => {
    props.store.appletRev(props.id);
    const s = props.store.stateOf(props.id);
    return s && s.kind === "notes" ? s : null;
  };
  const view = () => {
    const s = state();
    const wrapped: string[] = [];
    for (const line of (s?.text ?? "").split("\n")) wrap(line, cols(), wrapped);
    if (wrapped.length === 0) wrapped.push("");
    // The cursor sits after the last line; a full last line starts a new one.
    if (wrapped[wrapped.length - 1].length >= cols()) wrapped.push("");
    const maxScroll = Math.max(0, wrapped.length - rows());
    const scroll = Math.min(s?.scroll ?? 0, maxScroll);
    const end = wrapped.length - scroll;
    const start = Math.max(0, end - rows());
    const lines = wrapped.slice(start, end);
    return { lines, cursorRow: lines.length - 1, cursorCol: lines[lines.length - 1].length, empty: !s?.text };
  };
  return (
    <View debugName="Notes" class="absolute inset-0 bg-[#1a1b26]">
      <Index each={view().lines}>
        {(line, i) => (
          <Text
            class="absolute left-[4] font-mono text-xs text-[#c0caf5]"
            style={{ insetT: PAD + i * LINE_H }}
          >
            {line()}
          </Text>
        )}
      </Index>
      <Show when={view().empty && props.h() >= 40}>
        <Text class="absolute left-[16] top-[20] text-xs text-[#414868]">SELECT opens the keyboard</Text>
      </Show>
      <View
        class="absolute w-[7] h-[13] bg-[#e0af68]"
        style={{ insetL: PAD + cell * view().cursorCol, insetT: PAD + view().cursorRow * LINE_H }}
      />
    </View>
  );
}

// ---- keys ---------------------------------------------------------------------

export interface SheetLine {
  kind: "title" | "row" | "gap";
  keys: string;
  what: string;
}

export function sheetLines(layout: "dwindle" | "scrolling"): SheetLine[] {
  const out: SheetLine[] = [];
  for (const group of keySheet(layout)) {
    out.push({ kind: "title", keys: group.title, what: "" });
    for (const row of group.rows) out.push({ kind: "row", keys: row.keys, what: row.what });
    out.push({ kind: "gap", keys: "", what: "" });
  }
  return out;
}

// ---- top ----------------------------------------------------------------------

const GRAPH_H = 24;

function Top(props: AppletProps) {
  const store = props.store;
  // Uptime is the only row that moves every second; the rest follow `rev`.
  const rows = () => {
    store.rev();
    const ops = getOps();
    return [
      ["windows", String(store.wm.windows.size)],
      ["workspace", `${store.active()} of 5 · ${store.layoutKind()}`],
      ["host", `${ops.__host ?? "3ds"} · abi ${ops.__hostAbi ?? "?"}`],
    ];
  };
  const graphW = () => Math.max(0, Math.min(FPS_SLOTS * 3, props.w() - 60));
  // Flat like the term rows: labels and values are two passes of Text.
  return (
    <View debugName="Top" class="absolute inset-0 bg-[#1a1b26]">
      <Text class="absolute left-[6] top-[3] text-lg text-[#7aa2f7] font-bold">{String(store.fps())}</Text>
      <Text class="absolute left-[6] top-[25] text-xs text-[#565f89]">fps</Text>
      <View class="absolute top-[5] overflow-hidden" style={{ insetL: 52, width: graphW(), height: GRAPH_H }}>
        <View class="absolute left-0 right-0 bottom-0 h-[1] bg-[#292e42]" />
        {/* A sweep, not a scroll: a sample lands in its own slot, laid out
            once at full height and scaled to its value, with a paint-only
            color, so a second's update restyles and relayouts nothing. */}
        <Index each={SLOT_INDEX}>
          {(slot) => {
            const fps = () => Math.min(60, store.fpsSlot(slot()));
            return (
              <View
                class="absolute top-0 w-[2]"
                style={{
                  insetL: slot() * 3,
                  height: GRAPH_H,
                  originY: 0.5,
                  scaleY: fps() / 60,
                  bgColor: fps() >= 55 ? "#9ece6a" : fps() >= 30 ? "#e0af68" : "#f7768e",
                }}
              />
            );
          }}
        </Index>
        <View class="absolute top-0 w-[1] bg-[#c0caf5]" style={{ height: GRAPH_H, translateX: store.fpsHead() * 3 }} />
      </View>
      <Show when={props.h() >= 60}>
        <Text class="absolute left-[6] top-[40] text-xs text-[#565f89]">uptime</Text>
        <Text class="absolute left-[74] top-[40] text-xs text-[#c0caf5]">{formatUptime(store.uptimeSeconds())}</Text>
        <Index each={rows()}>
          {(row, i) => (
            <Text class="absolute left-[6] text-xs text-[#565f89]" style={{ insetT: 40 + (i + 1) * ROW_H }}>
              {row()[0]}
            </Text>
          )}
        </Index>
        <Index each={rows()}>
          {(row, i) => (
            <Text class="absolute left-[74] text-xs text-[#c0caf5]" style={{ insetT: 40 + (i + 1) * ROW_H }}>
              {row()[1]}
            </Text>
          )}
        </Index>
      </Show>
    </View>
  );
}
