// SPDX-License-Identifier: GPL-3.0-or-later
// ui/segments.tsx — the selected fill of a segmented control. The
// control's border is a rounded rect; a fill drawn as a plain rect at
// either end covered the border's corner arcs. The fill at an end is a
// rounded piece the whole segment wide with a square piece over its inner
// side, so the outer corners follow the border and the divider edge stays
// square; a middle segment is one square piece.

import { Show } from "solid-js";
import { View } from "@pocketjs/framework/components";

export interface SegmentFillProps {
  x: number;
  y: number;
  w: number;
  h: number;
  first: boolean;
  last: boolean;
  /** The fill's classes (a gradient), whole literals; position comes from the props. */
  class: string;
  /** The outer corners' radius: the border's less its width (default 4). */
  radius?: number;
}

export function SegmentFill(props: SegmentFillProps) {
  const r = () => props.radius ?? 4;
  const ends = () => props.first || props.last;
  const squareX = () => (props.first ? props.x + r() : props.x);
  const squareW = () => props.w - (props.first ? r() : 0) - (props.last ? r() : 0);
  return (
    <>
      <Show when={ends()}>
        <View class={props.class} style={{ insetL: props.x, insetT: props.y, width: props.w, height: props.h, radius: r() }} />
      </Show>
      <Show when={squareW() > 0}>
        <View class={props.class} style={{ insetL: squareX(), insetT: props.y, width: squareW(), height: props.h }} />
      </Show>
    </>
  );
}
