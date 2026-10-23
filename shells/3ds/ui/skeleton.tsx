// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/skeleton.tsx — what a list slot shows while its row is not
// painted yet (ui/slots.ts): a face and a few bars that pulse. The pulse is
// a baked native animation, so a screen of skeletons costs the frame
// nothing. A slot mounts its skeleton once and switches between it and its
// content by opacity (showSkeleton).

import { For } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { View } from "@pocketjs/framework/components";
import type { NodeMirror } from "@pocketjs/framework/renderer";

export interface SkeletonProps {
  ref: (node: NodeMirror) => void;
  /** Left edge of the bars. */
  x: number;
  /** Width of the longest bar. */
  width: number;
  /** A round 32 px face at the left edge. */
  face?: boolean;
  /** Bars below the first. */
  lines?: number;
  /** On a dark background. */
  dark?: boolean;
}

const LIGHT = {
  face: "absolute left-[10] top-[7] w-[32] h-[32] rounded-[16] bg-[#e1e6ea]",
  head: "absolute top-[10] h-[7] rounded-[3] bg-[#e1e6ea]",
  line: "absolute h-[7] rounded-[3] bg-[#e1e6ea]",
};
const DARK = {
  face: "absolute left-[10] top-[7] w-[32] h-[32] rounded-[16] bg-[#3b3e45]",
  head: "absolute top-[10] h-[7] rounded-[3] bg-[#3b3e45]",
  line: "absolute h-[7] rounded-[3] bg-[#3b3e45]",
};

export function Skeleton(props: SkeletonProps) {
  const tone = props.dark ? DARK : LIGHT;
  const lines = Array.from({ length: props.lines ?? 2 }, (_, index) => index);
  return (
    <View ref={props.ref} class="absolute inset-0 opacity-0">
      {/* The pulse animates opacity, so it lives inside the node whose
          opacity shows and hides the skeleton. */}
      <View class="absolute inset-0 animate-pulse">
        {props.face ? <View class={tone.face} /> : null}
        <View class={tone.head} style={{ insetL: props.x, width: Math.round(props.width * 0.45) }} />
        <For each={lines}>
          {(index) => <View class={tone.line} style={{ insetL: props.x, insetT: 26 + index * 14, width: index === lines.length - 1 ? Math.round(props.width * 0.6) : props.width }} />}
        </For>
      </View>
    </View>
  );
}

/** Show a slot's skeleton (`on`) or its content. */
export function showSkeleton(skeleton: NodeMirror, content: NodeMirror, on: boolean): void {
  jump(skeleton, "opacity", on ? 1 : 0);
  jump(content, "opacity", on ? 0 : 1);
}
