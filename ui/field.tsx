// SPDX-License-Identifier: GPL-3.0-or-later
// ui/field.tsx — a search field drawn by arithmetic, as the pages
// draw their rows: a rounded pill with the text being typed, the committed
// words, or a placeholder.
//
// The field shows the keyboard session's text while one is open: the
// controller's `display("|")` is the value with the caret, and on a host
// whose keyboard is the deck (Omarchy Pocket) it is the only echo the
// typist gets, since the framework draws no panel there (osk.tsx
// keyboardElsewhere). An applet passes `draft`, null while no session is
// open, and `value`, the words last committed.

import { type Accessor } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import type { OskController } from "@pocketjs/framework/osk";
import { ellipsize, FONT, toAscii } from "./text.ts";
import type { Press, Target } from "./touch.ts";

export interface FieldProps {
  id: string;
  x: number;
  y: number;
  w: number;
  /** Default 28. */
  h?: number;
  press: Press;
  /** The keyboard's text with its caret while it is open, else null. */
  draft: Accessor<string | null>;
  value: Accessor<string>;
  placeholder: string;
}

/** What the field shows: the draft while typing, else the value, else the placeholder. */
export function fieldText(draft: string | null, value: string, placeholder: string, slot: number, width: number): string {
  const text = draft ?? value;
  if (text) return ellipsize(toAscii(text), slot, width);
  return draft !== null ? "|" : placeholder;
}

/** The session's text with its caret while it is open, for a `draft` accessor. */
export function draftOf(osk: OskController): Accessor<string | null> {
  return () => (osk.isOpen() ? osk.display("|") : null);
}

export function SearchField(props: FieldProps) {
  const h = () => props.h ?? 28;
  const textW = () => props.w - 28;
  const typed = () => props.draft() !== null || props.value() !== "";
  return (
    <>
      <View
        class={props.press.is(props.id) ? "absolute rounded-[14] border border-[#8a9099] bg-[#e4e7eb]" : "absolute rounded-[14] border border-[#b8bec6] bg-white"}
        style={{ insetL: props.x, insetT: props.y, width: props.w, height: h(), radius: Math.round(h() / 2) }}
      />
      <Text class={typed() ? "absolute text-sm text-[#111111]" : "absolute text-sm text-[#a0a6ae]"} style={{ insetL: props.x + 14, insetT: props.y + Math.round((h() - 17) / 2), width: textW() }}>
        {fieldText(props.draft(), props.value(), props.placeholder, FONT.sm, textW())}
      </Text>
    </>
  );
}

/** The field's hit target, 4 px taller than drawn each way. */
export function fieldTarget(props: Pick<FieldProps, "id" | "x" | "y" | "w" | "h">, run: () => void): Target {
  return { id: props.id, x: props.x, y: props.y - 4, w: props.w, h: (props.h ?? 28) + 8, run };
}
