// SPDX-License-Identifier: GPL-3.0-or-later
// src/stage.tsx — the top screen: wallpaper, tiled windows,
// the bar, and the key sheet. A window is laid out at its placement and the
// store animates its transform between placements, so text never reflows
// during a transition.

import { createMemo, For, Index, onCleanup, Show } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";
import { HELD_LAYERS, keySheet, LAYER_TITLE } from "./chords.ts";
import { formatBarClock } from "./shell.ts";
import { Applet } from "./applets.tsx";
import { COUNTDOWN_ORIGIN, WINDOW_ORIGIN, type ShellStore } from "./store.ts";
import { BAR_H, BORDER, sameRect, type LayoutKind, type Rect } from "./wm.ts";

const HEADER_H = 14;
const NO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** The three cooked wallpapers. Only the current one is mounted. */
function Wallpaper(props: { store: ShellStore }) {
  return (
    <>
      <Show when={props.store.wallpaper() === "road"}>
        <Image debugName="WallRoad" class="absolute left-0 top-0 w-[512] h-[256]" src="wall/road.png" />
      </Show>
      <Show when={props.store.wallpaper() === "lake"}>
        <Image debugName="WallLake" class="absolute left-0 top-0 w-[512] h-[256]" src="wall/lake.png" />
      </Show>
      <Show when={props.store.wallpaper() === "swirl"}>
        <Image debugName="WallSwirl" class="absolute left-0 top-0 w-[512] h-[256]" src="wall/swirl.png" />
      </Show>
    </>
  );
}

function Win(props: { id: number; store: ShellStore }) {
  const store = props.store;
  const win = () => store.windowOf(props.id);
  // Each of these compares by value, so a focus change re-runs two windows'
  // borders and nothing else.
  const focused = createMemo(() => store.focusedId() === props.id);
  const rect = createMemo(() => store.placementOf(props.id)?.rect ?? NO_RECT, undefined, { equals: sameRect });
  // A window's title is fixed when it opens.
  const title = win()?.title ?? "";
  const geometry = () => ({ insetL: rect().x, insetT: rect().y, width: rect().w, height: rect().h, ...WINDOW_ORIGIN });
  const contentW = createMemo(() => Math.max(0, rect().w - 2 * BORDER));
  const contentH = createMemo(() => Math.max(0, rect().h - 2 * BORDER - HEADER_H));
  return (
    <View
      debugName="Win"
      class="absolute overflow-hidden"
      style={geometry()}
      ref={(el) => onCleanup(store.bindWindow(props.id, el))}
    >
      {/* Omarchy's tokyo-night borders: the accent when focused, grey otherwise. */}
      <View class={focused() ? "absolute inset-0 bg-[#7aa2f7]" : "absolute inset-0 bg-[#595959aa]"} />
      <View class="absolute inset-[2] bg-[#1a1b26] overflow-hidden">
        <View class={focused() ? "absolute left-0 right-0 top-0 h-[14] bg-[#24283b]" : "absolute left-0 right-0 top-0 h-[14] bg-[#16161e]"}>
          <Text class={focused() ? "absolute left-[6] top-0 text-xs text-[#c0caf5]" : "absolute left-[6] top-0 text-xs text-[#565f89]"}>
            {title}
          </Text>
        </View>
        <View class="absolute left-0 right-0 top-[14] bottom-0 overflow-hidden">
          <Show when={win()}>
            {(w) => <Applet id={props.id} app={w().app} store={store} w={contentW} h={contentH} />}
          </Show>
        </View>
      </View>
    </View>
  );
}

/** Omarchy 4's bar: workspaces on the left, the active one drawn as a
 *  rounded square and empty ones at half strength; the clock in the middle;
 *  status on the right. No separators, no module backgrounds. */
function Bar(props: { store: ShellStore }) {
  const store = props.store;
  return (
    <View debugName="Bar" class="absolute left-0 right-0 top-0 h-[14] bg-[#1a1b26]">
      <Index each={store.counts()}>
        {(count, i) => (
          <Show
            when={store.active() === i + 1}
            fallback={
              <Text class={count() > 0 ? "absolute top-0 text-xs text-[#a9b1d6]" : "absolute top-0 text-xs text-[#61667e]"} style={{ insetL: 8 + i * 13 }}>
                {String(i + 1)}
              </Text>
            }
          >
            <View class="absolute top-[3] w-[8] h-[8] rounded-[2] bg-[#c0caf5]" style={{ insetL: 7 + i * 13 }} />
          </Show>
        )}
      </Index>
      <Text class="absolute left-0 right-0 top-0 text-center text-xs text-[#c0caf5]">{formatBarClock(store.now())}</Text>
      {/* A held layer's title takes the layout's place at the right edge,
          clear of the clock. One title per layer, faded by opacity: changing
          a Text's content would relayout the stage on every shoulder press. */}
      <Text class="absolute right-[8] top-0 text-xs text-[#565f89]" style={{ opacity: store.layer() === "plain" ? 1 : 0 }}>
        {store.layoutKind()}
      </Text>
      <For each={HELD_LAYERS}>
        {(layer) => (
          <Text class="absolute right-[8] top-0 text-xs text-[#7aa2f7] font-bold" style={{ opacity: store.layer() === layer ? 1 : 0 }}>
            {LAYER_TITLE[layer]}
          </Text>
        )}
      </For>
    </View>
  );
}

/** Omarchy's notification: a card at the top right with a countdown bar in
 *  the accent. The bar shrinks on the core's animation track. */
function Toast(props: { store: ShellStore }) {
  const store = props.store;
  return (
    <View
      debugName="Toast"
      class="absolute right-[8] px-[8] pt-[4] pb-[6] bg-[#1a1b26] border border-[#7aa2f7]"
      style={{ insetT: (store.barVisible() ? BAR_H : 0) + 6 }}
    >
      <Text class="text-xs text-[#c0caf5]">{store.toast()}</Text>
      <View
        class="absolute left-0 right-0 bottom-0 h-[2] bg-[#7aa2f7]"
        style={COUNTDOWN_ORIGIN}
        ref={(el) => onCleanup(store.bindToastBar(el))}
      />
    </View>
  );
}

/** SUPER+K: the whole chord table over the stage. Four groups in two
 *  columns — L and "always" on the left, R and L+R on the right — with every
 *  cell clipped to its column so a long label cannot run into its neighbour
 *  or off the panel. */
const SHEET_COL_W = 184;
const SHEET_KEYS_W = 80;
const SHEET_ROW_H = 12;

interface SheetLine {
  kind: "title" | "row" | "gap";
  keys: string;
  what: string;
}

/** The chosen groups of the chord table as one list of fixed-height lines. */
function sheetLines(layout: LayoutKind, groups: readonly number[]): SheetLine[] {
  const all = keySheet(layout);
  const out: SheetLine[] = [];
  for (const index of groups) {
    const group = all[index];
    out.push({ kind: "title", keys: group.title, what: "" });
    for (const row of group.rows) out.push({ kind: "row", keys: row.keys, what: row.what });
    out.push({ kind: "gap", keys: "", what: "" });
  }
  return out;
}

function SheetColumn(props: { x: number; groups: readonly number[]; layout: () => LayoutKind }) {
  return (
    <Index each={sheetLines(props.layout(), props.groups)}>
      {(line, i) => (
        <View
          class="absolute h-[12] overflow-hidden"
          style={{ insetL: props.x, insetT: 26 + i * SHEET_ROW_H, width: SHEET_COL_W }}
        >
          <Show when={line().kind === "title"}>
            <Text class="absolute left-0 top-0 text-xs text-[#7aa2f7] font-bold">{line().keys}</Text>
          </Show>
          <Show when={line().kind === "row"}>
            <View class="absolute left-0 top-0 h-[12] overflow-hidden" style={{ width: SHEET_KEYS_W }}>
              <Text class="absolute left-0 top-0 text-xs text-[#c0caf5] font-bold">{line().keys}</Text>
            </View>
            <View
              class="absolute top-0 h-[12] overflow-hidden"
              style={{ insetL: SHEET_KEYS_W, width: SHEET_COL_W - SHEET_KEYS_W }}
            >
              <Text class="absolute left-0 top-0 text-xs text-[#a9b1d6]">{line().what}</Text>
            </View>
          </Show>
        </View>
      )}
    </Index>
  );
}

/** Mounted on demand: it is opened rarely, and sixty hidden rows would add
 *  to every relayout of the stage while it is closed. */
function KeySheet(props: { store: ShellStore }) {
  const layout = () => props.store.layoutKind();
  return (
    <View debugName="KeySheet" class="absolute inset-[8] bg-[#1a1b26f2] border border-[#7aa2f7]">
      <Text class="absolute left-[10] top-[5] text-sm text-[#c0caf5] font-bold">Keys</Text>
      <Text class="absolute left-[44] top-[5] text-sm text-[#565f89]">…</Text>
      <Text class="absolute right-[10] top-[7] text-xs text-[#565f89]">B closes</Text>
      {/* keySheet() returns L, R, L+R, always — pair the long groups with the short. */}
      <SheetColumn x={10} groups={[0, 3]} layout={layout} />
      <SheetColumn x={196} groups={[1, 2]} layout={layout} />
    </View>
  );
}

export function Stage(props: { store: ShellStore }) {
  const store = props.store;
  return (
    <View debugName="Stage" class="relative w-full h-full bg-[#1a1b26] overflow-hidden">
      <Wallpaper store={store} />
      <View debugName="Windows" class="absolute inset-0">
        <For each={store.order()}>{(id) => <Win id={id} store={store} />}</For>
        <For each={store.ghosts()}>
          {(ghost) => (
            <View
              class="absolute border border-[#595959]"
              style={{ insetL: ghost.rect.x, insetT: ghost.rect.y, width: ghost.rect.w, height: ghost.rect.h }}
              ref={(el) => store.bindGhost(el)}
            />
          )}
        </For>
      </View>
      <Show when={store.order().length === 0}>
        <View debugName="EmptyHint" class="absolute left-0 right-0 top-[104] items-center">
          <View class="px-[10] py-[3] bg-[#1a1b26cc] border border-[#292e42]">
            <Text class="text-xs text-[#a9b1d6]">{`workspace ${store.active()} is empty · tap an app, or hold L and press A`}</Text>
          </View>
        </View>
      </Show>
      <Show when={store.barVisible()}>
        <Bar store={store} />
      </Show>
      <Show when={store.keysOpen()}>
        <KeySheet store={store} />
      </Show>
      <Show when={store.toast()}>
        <Toast store={store} />
      </Show>
    </View>
  );
}
