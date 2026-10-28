// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/legend.tsx — the button legend along the bottom of a surface
// without touch (the PSP): each control the page answers, as the button's
// mark and what it does. A touch surface draws none and keeps its height.
//
// The top page of the navigation stack (ui/nav.tsx) publishes its entries:
// ○ for the focused row, × for back, then the page's own buttons (shoulders
// for feeds and paging, △ for reload). Home publishes its own. Whatever holds
// the buttons for a while (an alert, the system keyboard) overrides the page's
// entries until it lets go. The marks are drawn, not typed: the baked faces
// need not carry ○ △ □.

import { createEffect, For, Match, Switch, createSignal, type Accessor } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { appletTouch, LEGEND_H, SCREEN_H, SCREEN_W } from "./screen.ts";

export type LegendButton =
  | "circle"
  | "cross"
  | "triangle"
  | "square"
  | "l"
  | "r"
  | "lr"
  | "start"
  | "select"
  /** The d-pad's left and right arms. */
  | "dpad-h"
  /** The d-pad's up and down arms. */
  | "dpad-v";

export interface LegendEntry {
  button: LegendButton;
  label: string;
}

const [base, setBase] = createSignal<readonly LegendEntry[]>([]);
const [override, setOverride] = createSignal<readonly LegendEntry[] | null>(null);
const entries = () => override() ?? base();

const same = (a: readonly LegendEntry[] | null, b: readonly LegendEntry[] | null) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((entry, i) => entry.button === b[i]!.button && entry.label === b[i]!.label));

/** The page's entries; an equal list changes nothing. */
export function setLegend(next: readonly LegendEntry[]): void {
  if (!same(base(), next)) setBase(next);
}

/** Entries that stand in for the page's while something else holds the
 *  buttons (an alert, the keyboard); null gives the legend back. */
export function overrideLegend(next: readonly LegendEntry[] | null): void {
  if (!same(override(), next)) setOverride(next);
}

/** While the system keyboard is open on a surface without touch, the legend
 *  names the grid keyboard's chords (framework/src/osk.tsx): □ deletes, △
 *  types a space, R shifts, START commits as `commit`, × closes. */
export function legendWhileTyping(isOpen: Accessor<boolean>, commit: string): void {
  if (appletTouch()) return;
  createEffect(() =>
    overrideLegend(isOpen()
      ? [
          { button: "square", label: "Delete" },
          { button: "triangle", label: "Space" },
          { button: "r", label: "Shift" },
          { button: "start", label: commit },
          { button: "cross", label: "Close" },
        ]
      : null),
  );
}

// PlayStation's colours for the face buttons, darkened for a light bar.
const MARK = { circle: "#d23a42", cross: "#3b78cf", triangle: "#1f9a78", square: "#bf4fb8" } as const;
const KEY_TEXT = "#ffffff";
const KEY_FILL = "#5c6778";
const DPAD_IDLE = "#a9b2bf";

function Bar(props: { x: number; y: number; w: number; angle: number; color: string }) {
  return <View style={{ posType: 1, insetL: props.x - props.w / 2, insetT: props.y - 1, width: props.w, height: 2, radius: 1, bgColor: props.color, rotate: props.angle }} />;
}

/** One button's mark, 13 px tall. */
function Mark(props: { button: LegendButton }) {
  const key = (label: string, width: number) => (
    <View class="items-center justify-center" style={{ width, height: 13, radius: 3, bgColor: KEY_FILL }}>
      <Text class="text-2xs font-bold" style={{ textColor: KEY_TEXT }}>{label}</Text>
    </View>
  );
  // A word (START, SELECT) is as wide as its label plus 4 px on each side.
  const wordKey = (label: string) => (
    <View class="items-center justify-center" style={{ height: 13, paddingL: 4, paddingR: 4, radius: 3, bgColor: KEY_FILL }}>
      <Text class="text-2xs font-bold" style={{ textColor: KEY_TEXT }}>{label}</Text>
    </View>
  );
  return (
    <Switch>
      <Match when={props.button === "circle"}>
        <View style={{ width: 12, height: 12, radius: 6, borderWidth: 2, borderColor: MARK.circle }} />
      </Match>
      <Match when={props.button === "cross"}>
        <View class="relative" style={{ width: 12, height: 12 }}>
          <Bar x={6} y={6} w={13} angle={45} color={MARK.cross} />
          <Bar x={6} y={6} w={13} angle={315} color={MARK.cross} />
        </View>
      </Match>
      <Match when={props.button === "triangle"}>
        <View class="relative" style={{ width: 13, height: 12 }}>
          <Bar x={6.5} y={11} w={12} angle={0} color={MARK.triangle} />
          <Bar x={3.5} y={6} w={12} angle={300} color={MARK.triangle} />
          <Bar x={9.5} y={6} w={12} angle={60} color={MARK.triangle} />
        </View>
      </Match>
      <Match when={props.button === "square"}>
        <View style={{ width: 11, height: 11, borderWidth: 2, borderColor: MARK.square }} />
      </Match>
      <Match when={props.button === "l"}>{key("L", 14)}</Match>
      <Match when={props.button === "r"}>{key("R", 14)}</Match>
      <Match when={props.button === "lr"}>
        <View class="flex-row" style={{ gap: 2 }}>
          {key("L", 14)}
          {key("R", 14)}
        </View>
      </Match>
      <Match when={props.button === "dpad-h" || props.button === "dpad-v"}>
        <View class="relative" style={{ width: 13, height: 13 }}>
          <View style={{ posType: 1, insetL: 0, insetT: 4.5, width: 13, height: 4, radius: 1, bgColor: props.button === "dpad-h" ? KEY_FILL : DPAD_IDLE }} />
          <View style={{ posType: 1, insetL: 4.5, insetT: 0, width: 4, height: 13, radius: 1, bgColor: props.button === "dpad-v" ? KEY_FILL : DPAD_IDLE }} />
        </View>
      </Match>
      <Match when={props.button === "start"}>{wordKey("START")}</Match>
      <Match when={props.button === "select"}>{wordKey("SELECT")}</Match>
    </Switch>
  );
}

function Entry(props: { entry: LegendEntry }) {
  return (
    <View class="flex-row items-center" style={{ gap: 5 }}>
      <Mark button={props.entry.button} />
      <Text class="text-xs font-bold" style={{ textColor: "#3b4658" }}>{props.entry.label}</Text>
    </View>
  );
}

/** The legend bar under the surface's content; nothing on a touch surface.
 *  `home` adds SELECT Home at the end: the host's chord that summons Home
 *  from an applet. */
export function Legend(props: { home?: boolean }) {
  if (appletTouch()) return null;
  return (
    <View
      class="absolute left-0 flex-row items-center bg-gradient-to-b from-[#eef0f4] via-[#c9d0d9] to-[#b8c0cc]"
      style={{ insetT: SCREEN_H, width: SCREEN_W, height: LEGEND_H, paddingL: 10, paddingR: 10, gap: 14 }}
    >
      <View class="absolute left-0 top-0 h-[1] bg-[#7f8998]" style={{ width: SCREEN_W }} />
      <For each={entries()}>{(entry) => <Entry entry={entry} />}</For>
      {props.home && !override() ? (
        <View class="absolute flex-row items-center" style={{ insetR: 10, insetT: 4, gap: 5 }}>
          <Entry entry={{ button: "select", label: "Home" }} />
        </View>
      ) : null}
    </View>
  );
}
