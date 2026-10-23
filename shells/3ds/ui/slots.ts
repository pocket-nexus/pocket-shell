// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/slots.ts — the applets' long lists. The pool, the measured
// list and the per-frame budget are PocketJS's (@pocketjs/framework/slot-list):
// a slot paints its row in full when the frame's list budget allows and its
// skeleton otherwise, and rows are measured on demand, the ones in view first.
//
// Each slot's painter takes (row, skeleton). Skeleton means: move the slot to
// the row and show the placeholder (ui/skeleton.tsx); the full paint comes in
// a later frame.

import { getFirstChild, replaceText, type NodeMirror } from "@pocketjs/framework/renderer";

export { createMeasuredList, createSlotPool, type MeasuredRow, type PlacedRow, type SlotPainter, type SlotPool } from "@pocketjs/framework/slot-list";

/** Set a <Text>'s content in place. The element must have been mounted with
 *  a non-empty static child, which this replaces. */
export function paintText(element: NodeMirror, value: string): void {
  const node = getFirstChild(element);
  const text = value || " ";
  if (node && node.text !== text) replaceText(node, text);
}
