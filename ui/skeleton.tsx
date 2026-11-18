// SPDX-License-Identifier: GPL-3.0-or-later
// ui/skeleton.tsx — bars in place of text whose glyphs are on their way.
//
// A text the baked faces cannot draw (CJK, emoji) waits for a glyph atlas
// (ui/glyphs.ts). Until the atlas holds it, each of its lines shows as a
// low-contrast bar as wide as the line will be: ASCII measured in the baked
// face, every other character one em of the glyph face. A layout counts the
// bars as lines, so a row keeps its height, or close to it, when the text
// arrives. When the glyphs service fails, the text folds to ASCII instead
// (ui/text.ts toAscii).
//
// A slot of a list mounts its bars the first time it shows any and keeps
// them (kit/list.tsx, x/views.tsx, discord/views.tsx); the painter moves and
// sizes them like the slot's other nodes.

import { onMount } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { View } from "@pocketjs/framework/components";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import { measure } from "./text.ts";

export interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bars one slot holds: a cell's eyebrow, two title lines, two detail lines
 *  and a name, or a block of text. Lines past it show no bar. */
export const MAX_BARS = 8;

const isWide = (cp: number) => cp >= 0x2e80;

/** The widths of the lines `text` will take in a `width`-px column, at most
 *  `maxLines`: runs of ASCII measured in the baked `slot`, every other
 *  character `em` px wide (a CJK glyph is one em, the face's px). A
 *  paragraph takes as many lines as its width needs; an empty one takes a
 *  line with no bar. */
export function skeletonLines(text: string, slot: number, em: number, width: number, maxLines = Infinity): number[] {
  const out: number[] = [];
  const column = Math.max(1, width);
  for (const paragraph of text.split("\n")) {
    if (out.length >= maxLines) break;
    let total = 0;
    let run = "";
    for (const ch of paragraph) {
      const cp = ch.codePointAt(0)!;
      if (cp >= 0x20 && cp < 0x7f) {
        run += ch;
        continue;
      }
      if (run) total += measure(run, slot);
      run = "";
      total += isWide(cp) ? em : Math.round(em * 0.6);
    }
    if (run) total += measure(run, slot);
    if (total === 0) {
      out.push(0);
      continue;
    }
    for (let left = total; left > 0 && out.length < maxLines; left -= column) {
      // a last line shorter than two ems still reads as a word
      out.push(left > column ? column : Math.max(Math.min(column, em * 2), Math.round(left)));
    }
  }
  return out.length ? out : [0];
}

/** Bars for lines of `leading` px from (x, y): each a little over half an
 *  em tall, centred in its line. Lines of width 0 get none. */
export function barsFor(widths: readonly number[], x: number, y: number, leading: number, em: number): Bar[] {
  const h = Math.max(4, Math.round(em * 0.62));
  const inset = Math.round((leading - h) / 2);
  const bars: Bar[] = [];
  widths.forEach((w, line) => {
    if (w > 0) bars.push({ x, y: y + line * leading + inset, w: Math.round(w), h });
  });
  return bars;
}

export interface BarPainter {
  /** Show these bars, at most MAX_BARS, and hide the rest. */
  paint(bars: readonly Bar[]): void;
}

/** MAX_BARS bar nodes in a slot. `ready` receives the painter once they are
 *  mounted; the slot paints them with each row. */
export function SkeletonBars(props: { color: string; ready: (painter: BarPainter) => void }) {
  const nodes: NodeMirror[] = [];
  let shown = 0;
  onMount(() =>
    props.ready({
      paint(bars) {
        const count = Math.min(bars.length, MAX_BARS);
        for (let i = 0; i < Math.max(count, shown); i++) {
          const bar = bars[i];
          const node = nodes[i]!;
          if (i >= count || !bar) {
            jump(node, "opacity", 0);
            continue;
          }
          jump(node, "insetL", bar.x);
          jump(node, "insetT", bar.y);
          jump(node, "width", bar.w);
          jump(node, "height", bar.h);
          jump(node, "radius", Math.floor(bar.h / 2));
          jump(node, "opacity", 1);
        }
        shown = count;
      },
    }),
  );
  return (
    <>
      {Array.from({ length: MAX_BARS }, (_, i) => (
        <View ref={(node: NodeMirror) => (nodes[i] = node)} class="absolute opacity-0" style={{ insetL: 0, insetT: 0, width: 1, height: 1, radius: 3, bgColor: props.color }} />
      ))}
    </>
  );
}

/** A slot's bars, mounted the first time a row needs them: `paint` with no
 *  bars before then costs nothing. `mount` flips the slot's Show. */
export function lazyBars(mount: () => void): { paint(bars: readonly Bar[]): void; ready(painter: BarPainter): void } {
  let painter: BarPainter | null = null;
  let waiting: readonly Bar[] = [];
  return {
    paint(bars) {
      if (painter) return painter.paint(bars);
      waiting = bars;
      if (bars.length) mount();
    },
    ready(next) {
      painter = next;
      painter.paint(waiting);
      waiting = [];
    },
  };
}
