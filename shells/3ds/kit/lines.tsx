// SPDX-License-Identifier: GPL-3.0-or-later
// applets/kit/lines.tsx — thousands of lines of code or diff in monospace, a
// fixed pool of three-node slots. A long line wraps to a following row.
import { createEffect, createMemo, createSignal, For, onMount, Show, untrack, type Accessor } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { Text, View } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import type { LayerContext, PageContent } from "../ui/nav.tsx";
import { createSlotPool, paintText, type SlotPool } from "../ui/slots.ts";
import { toAscii } from "../ui/text.ts";
import { isPlain, type Faces } from "./text.ts";
import { F, T } from "./theme.ts";

export type LineTone = "plain" | "add" | "del" | "hunk" | "file";
export interface SourceLine {
  /** The number in the gutter; "" for none. */
  gutter: string;
  text: string;
  tone: LineTone;
}
interface LineRow {
  y: number;
  h: number;
  gutter: string;
  text: string;
  tone: LineTone;
}

const LINE_H = 17;
const CHAR_W = 7.2;
const GUTTER_W = 38;
const OVERSCAN = 170;
const BG: Record<LineTone, string> = { plain: T.bg, add: T.addBg, del: T.delBg, hunk: T.hunkBg, file: T.surface };
const INK: Record<LineTone, string> = { plain: T.text, add: "#aff5b4", del: "#ffc0ba", hunk: T.accent, file: T.text };
const PROP_FONT_SLOT = 97;

function LineSlot(props: { pool: SlotPool<LineRow>; slot: number; width: number; faces: Faces }) {
  let box!: NodeMirror;
  let gutter!: NodeMirror;
  let text!: NodeMirror;
  const [row, setRow] = createSignal<LineRow | null>(null);
  let y = -1;
  onMount(() => {
    props.pool.attach(props.slot, (next) => {
      if (!next) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        setRow(null);
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (next.y !== y) jump(box, "translateY", (y = next.y));
      jump(box, "bgColor", BG[next.tone]);
      paintText(gutter, next.gutter);
      jump(text, "textColor", INK[next.tone]);
      setRow(next);
    });
    // A line outside ASCII draws from the glyph atlas once it has its characters.
    createEffect(() => {
      const shown = row();
      if (!shown) return;
      props.faces.revision();
      const plain = isPlain(shown.text);
      if (!plain) props.faces.text.want([shown.text]);
      const rich = !plain && props.faces.text.covers(shown.text);
      getOps().setProp(text.id, PROP_FONT_SLOT, rich ? F.richBody : F.mono);
      paintText(text, rich || plain ? shown.text : toAscii(shown.text));
    });
  });
  return (
    <View ref={box} class="absolute left-0 top-0 opacity-0" style={{ width: props.width, height: LINE_H, bgColor: T.bg }}>
      <Text ref={gutter} class="absolute top-[1] text-xs font-mono text-right" style={{ insetL: 0, width: GUTTER_W - 8, textColor: T.faint }}>{" "}</Text>
      <Text ref={text} class="absolute top-[1] text-xs font-mono" style={{ insetL: GUTTER_W, textColor: T.text }}>{" "}</Text>
    </View>
  );
}

export interface LinesOptions {
  lines: Accessor<SourceLine[]>;
  layer: LayerContext;
  faces: Faces;
  width: number;
  view: number;
}

export function linesContent(options: LinesOptions): PageContent {
  const perRow = Math.max(20, Math.floor((options.width - GUTTER_W - 6) / CHAR_W));
  const rows = createMemo(() => {
    const out: LineRow[] = [];
    let y = 0;
    for (const line of options.lines()) {
      const text = line.text.replace(/\t/g, "  ").replace(/\r/g, "");
      let at = 0;
      do {
        out.push({ y, h: LINE_H, gutter: at === 0 ? line.gutter : "", text: text.slice(at, at + perRow), tone: line.tone });
        y += LINE_H;
        at += perRow;
      } while (at < text.length);
    }
    return out;
  });
  const slots = () => {
    const pool = createSlotPool<LineRow>(rows, options.layer.offset, { view: options.view, overscan: OVERSCAN, minRowH: LINE_H });
    return <For each={pool.slots}>{(slot) => <LineSlot pool={pool} slot={slot} width={options.width} faces={options.faces} />}</For>;
  };
  return {
    view: () => <Show when={options.layer.near()}>{untrack(slots)}</Show>,
    height: () => rows().length * LINE_H + 16,
    focusOrder: () => [],
    targets: () => [],
    span: () => null,
    activate: () => undefined,
  };
}
