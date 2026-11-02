// SPDX-License-Identifier: GPL-3.0-or-later
// applets/kit/list.tsx — a list of rows (rows.ts) drawn by a fixed pool of slots:
// any length scrolls at the same cost. A slot holds what any row can show and
// the painter sets what this one does.
import { batch, createEffect, createMemo, createSignal, For, Index, onMount, Show, untrack, type Accessor } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { Image, Text, View } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import { onFrame } from "@pocketjs/framework/lifecycle";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import type { LayerContext, PageContent } from "../ui/nav.tsx";
import { createSlotPool, paintText, type SlotPool } from "../ui/slots.ts";
import { FONT, measure } from "../ui/text.ts";
import type { Press, Target } from "../ui/touch.ts";
import type { Images } from "./images.ts";
import { ICONS } from "./icons.ts";
import type { CellRow, Pill, Row, StripItem, StripRow, TextRow } from "./rows.ts";
import { F, S, T } from "./theme.ts";

/** Font slot and line height (contracts/spec/spec.ts PROP). */
const PROP_FONT_SLOT = 97;
const PROP_LINE_HEIGHT = 99;
const OVERSCAN = 60;
const MIN_ROW = 28;
/** The classes that make the compiler bake every face a slot switches to. */
const FACES = ["text-xl font-bold", "text-lg font-bold", "text-base font-bold", "text-sm font-bold", "text-sm", "text-xs", "text-xs font-bold", "text-xs font-mono"];
void FACES;
const NONE = ICONS.chevron.faint;

const fill = (tone: StripItem["tone"], pressed: boolean): string => {
  switch (tone) {
    case "primary":
      return pressed ? "#2ea043" : T.greenFill;
    case "danger":
      return pressed ? "#b62324" : T.redFill;
    case "chipOn":
      return T.accentFill;
    case "stat":
      return "#00000000";
    default:
      return pressed ? T.line : T.raised;
  }
};
const ink = (tone: StripItem["tone"]): string => (tone === "stat" ? T.muted : tone === "chip" ? T.muted : tone === "button" ? T.text : "#ffffff");

function ItemSlot(props: { item: Accessor<StripItem | null>; press: Press; focused: (id: string) => boolean }) {
  let box!: NodeMirror;
  let label!: NodeMirror;
  let glyph!: NodeMirror;
  const [src, setSrc] = createSignal<string>(NONE);
  onMount(() => {
    createEffect(() => {
      const item = props.item();
      jump(box, "opacity", item ? 1 : 0);
      if (!item) return paintText(label, "");
      jump(box, "insetL", item.x);
      jump(box, "insetT", item.y);
      jump(box, "width", item.w);
      jump(box, "height", item.h);
      jump(box, "radius", item.tone === "stat" ? 0 : 6);
      const iconW = item.icon ? 20 : 0;
      const stat = item.tone === "stat";
      getOps().setProp(label.id, PROP_FONT_SLOT, stat ? F.small : F.smallBold);
      jump(label, "insetL", stat ? iconW : iconW + (item.w - iconW - measureLabel(item)) / 2);
      jump(label, "insetT", (item.h - 15) / 2);
      jump(label, "textColor", ink(item.tone));
      paintText(label, item.label);
      if (item.icon) setSrc(item.icon);
      jump(glyph, "opacity", item.icon ? 1 : 0);
      jump(glyph, "insetL", stat ? 0 : Math.max(6, (item.w - iconW - measureLabel(item)) / 2 - 0));
      jump(glyph, "insetT", (item.h - 16) / 2);
    });
    createEffect(() => {
      const item = props.item();
      if (item) jump(box, "bgColor", fill(item.tone, props.press.is(item.id) || props.focused(item.id)));
    });
  });
  return (
    <View ref={box} class="absolute left-0 top-0 w-[1] h-[1] opacity-0">
      <Image ref={glyph} class="absolute w-[16] h-[16] opacity-0" src={src()} />
      <Text ref={label} class="absolute left-0 top-0 text-xs font-bold">{" "}</Text>
    </View>
  );
}
function PillSlot(props: { pill: Accessor<Pill | null>; y: Accessor<number> }) {
  let box!: NodeMirror;
  let text!: NodeMirror;
  onMount(() => {
    createEffect(() => {
      const pill = props.pill();
      jump(box, "opacity", pill ? 1 : 0);
      if (!pill) return paintText(text, "");
      jump(box, "insetL", pill.x);
      jump(box, "insetT", props.y());
      jump(box, "width", pill.w);
      jump(box, "bgColor", pill.bg);
      jump(text, "textColor", pill.fg);
      paintText(text, pill.text);
    });
  });
  return (
    <View ref={box} class="absolute h-[20] rounded-[10] opacity-0" style={{ width: 40 }}>
      <Text ref={text} class="absolute left-[7] top-[2] text-xs">{" "}</Text>
    </View>
  );
}

function AvatarSlot(props: { shown: Accessor<{ url: string; size: number } | null>; images: Images }) {
  let disc!: NodeMirror;
  let face!: NodeMirror;
  onMount(() => {
    createEffect(() => {
      const shown = props.shown();
      props.images.revision();
      jump(disc, "opacity", shown ? 1 : 0);
      if (shown) {
        jump(disc, "width", shown.size);
        jump(disc, "height", shown.size);
        jump(disc, "radius", shown.size / 2);
        jump(face, "width", shown.size);
        jump(face, "height", shown.size);
      }
      getOps().setImage(face.id, shown ? props.images.texture(shown.url, shown.size > 32 ? 128 : 64, true) : -1);
    });
  });
  return (
    <View ref={disc} class="absolute opacity-0" style={{ insetL: S.pad, insetT: S.rowPad, width: S.avatar, height: S.avatar, radius: S.avatar / 2, bgColor: T.raised }}>
      <Image ref={face} class="absolute left-0 top-0" style={{ width: S.avatar, height: S.avatar }} />
    </View>
  );
}

/** The label's width, kept from when the strip was measured: all but the padding. */
const measureLabel = (item: StripItem) => item.w - (item.icon ? 20 : 0) - (item.tone === "stat" ? 2 : 22);

function Slot(props: { pool: SlotPool<Row>; slot: number; images: Images; press: Press; focused: (id: string) => boolean; width: number }) {
  let box!: NodeMirror;
  let wash!: NodeMirror;
  let sep!: NodeMirror;
  /** A section's band or a code block's background. */
  let back!: NodeMirror;
  /** A quote's bar or a heading's rule. */
  let line!: NodeMirror;
  let unread!: NodeMirror;
  let glyph!: NodeMirror;
  let chevron!: NodeMirror;
  let eyebrow!: NodeMirror;
  let title!: NodeMirror;
  let detail!: NodeMirror;
  let trailing!: NodeMirror;
  const [src, setSrc] = createSignal<string>(NONE);
  const [id, setId] = createSignal("");
  const [avatar, setAvatar] = createSignal<{ url: string; size: number } | null>(null);
  const [strip, setStrip] = createSignal<StripRow | null>(null);
  const [pills, setPills] = createSignal<CellRow | null>(null);
  // Most slots never show a pill, an avatar or a strip: each is made the first
  // time its slot needs it, and stays. A node costs about 9 KB of heap.
  const [hasPills, setHasPills] = createSignal(false);
  const [hasAvatar, setHasAvatar] = createSignal(false);
  const [hasStrip, setHasStrip] = createSignal(false);
  let y = -1;
  let h = -1;
  const show = (node: NodeMirror, on: boolean) => jump(node, "opacity", on ? 1 : 0);
  const setFont = (node: NodeMirror, slot: number, leading: number) => {
    const ops = getOps();
    ops.setProp(node.id, PROP_FONT_SLOT, slot);
    ops.setProp(node.id, PROP_LINE_HEIGHT, leading);
  };
  const paintCell = (row: CellRow) => {
    jump(eyebrow, "insetL", row.textX);
    jump(eyebrow, "insetT", S.rowPad);
    setFont(eyebrow, row.eyebrowSlot, 16);
    paintText(eyebrow, row.eyebrow);
    jump(title, "insetL", row.textX);
    jump(title, "insetT", row.titleY);
    setFont(title, row.titleSlot, row.titleLeading);
    jump(title, "textColor", row.titleColor);
    paintText(title, row.title);
    jump(detail, "insetL", row.textX);
    jump(detail, "insetT", row.detailY);
    setFont(detail, row.detailSlot, 16);
    jump(detail, "textColor", row.detailColor);
    paintText(detail, row.detail);
    paintText(trailing, row.trailing);
    jump(trailing, "insetL", props.width - S.pad - (row.chevron ? 16 : 0) - trailingW(row));
    jump(trailing, "insetT", S.rowPad + 1);
    show(chevron, row.chevron);
    if (row.chevron) jump(chevron, "insetT", (row.h - 16) / 2);
    show(sep, true);
    jump(sep, "insetL", row.textX);
    jump(sep, "insetT", row.h - 1);
    show(unread, row.unread);
    if (row.unread) jump(unread, "insetT", (row.h - 8) / 2);
    show(glyph, row.icon !== "");
    if (row.icon) setSrc(row.icon);
    jump(glyph, "insetT", S.rowPad + 1 + (row.eyebrow ? 16 : 0));
    const shown = row.avatar && row.avatarSize ? { url: row.avatar, size: row.avatarSize } : null;
    if (shown) setHasAvatar(true);
    setAvatar(shown);
    if (row.pills.length) setHasPills(true);
    setPills(row.pills.length ? row : null);
  };
  const clearCell = () => {
    paintText(eyebrow, "");
    paintText(trailing, "");
    paintText(detail, "");
    show(chevron, false);
    show(sep, false);
    show(unread, false);
    show(glyph, false);
    setAvatar(null);
    setPills(null);
  };
  const paintBlock = (row: TextRow) => {
    clearCell();
    jump(title, "insetL", row.x);
    jump(title, "insetT", row.top + (row.block ? 0 : 0));
    setFont(title, row.slot, row.leading);
    jump(title, "textColor", row.color);
    paintText(title, row.text);
    show(back, row.block || row.band);
    if (row.block || row.band) {
      jump(back, "insetL", row.band ? 0 : S.pad);
      jump(back, "width", row.band ? props.width : props.width - S.pad * 2);
      jump(back, "height", row.h);
    }
    show(line, row.bar || row.rule);
    if (row.bar || row.rule) {
      jump(line, "insetT", row.bar ? 0 : row.h - 3);
      jump(line, "width", row.bar ? 3 : props.width - S.pad * 2);
      jump(line, "height", row.bar ? row.h : 1);
    }
    if (row.bullet) {
      jump(eyebrow, "insetL", row.bulletX);
      jump(eyebrow, "insetT", row.top + 2);
      setFont(eyebrow, F.body, 20);
      paintText(eyebrow, row.bullet);
    }
  };
  onMount(() => {
    createEffect(() => {
      const on = id() !== "" && (props.press.is(id()) || props.focused(id()));
      jump(wash, "opacity", on ? 1 : 0);
    });
    props.pool.attach(props.slot, (row, moved) => batch(() => {
      if (!row) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        setId("");
        setStrip(null);
        setAvatar(null);
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (row.y !== y) jump(box, "translateY", (y = row.y));
      if (row.h !== h) {
        jump(box, "height", (h = row.h));
        jump(wash, "height", h);
      }
      if (moved) return;
      setId(row.kind === "strip" ? "" : row.id ?? "");
      if (row.kind === "cell") {
        show(back, false);
        show(line, false);
        setStrip(null);
        paintCell(row);
      } else if (row.kind === "text") {
        setStrip(null);
        paintBlock(row);
      } else {
        clearCell();
        paintText(title, "");
        show(back, false);
        show(line, false);
        setHasStrip(true);
        setStrip(row);
      }
    }));
  });
  const trailingW = (row: CellRow) => Math.ceil(measure(row.trailing, FONT.xs));
  return (
    <View ref={box} class="absolute left-0 top-0 opacity-0" style={{ width: props.width, height: MIN_ROW }}>
      <View ref={back} class="absolute top-0 opacity-0" style={{ insetL: 0, width: props.width, height: 20, bgColor: T.surface }} />
      <View ref={line} class="absolute opacity-0" style={{ insetL: S.pad, insetT: 0, width: 3, height: 20, bgColor: T.line }} />
      <View ref={wash} class="absolute left-0 top-0 opacity-0" style={{ width: props.width, height: MIN_ROW, bgColor: T.wash }} />
      <View ref={sep} class="absolute opacity-0" style={{ insetL: S.pad, insetT: 0, width: props.width, height: 1, bgColor: T.line }} />
      <View ref={unread} class="absolute opacity-0" style={{ insetL: 3, insetT: 0, width: 6, height: 6, radius: 3, bgColor: T.accent }} />
      <Show when={hasAvatar()}>
        <AvatarSlot shown={avatar} images={props.images} />
      </Show>
      <Image ref={glyph} class="absolute w-[16] h-[16] opacity-0" src={src()} style={{ insetL: S.pad, insetT: S.rowPad }} />
      <Text ref={eyebrow} class="absolute text-xs" style={{ textColor: T.muted }}>{" "}</Text>
      <Text ref={title} class="absolute text-sm font-bold" style={{ textColor: T.text }}>{" "}</Text>
      <Text ref={detail} class="absolute text-xs" style={{ textColor: T.muted }}>{" "}</Text>
      <Text ref={trailing} class="absolute text-xs" style={{ textColor: T.muted }}>{" "}</Text>
      <Image ref={chevron} class="absolute w-[16] h-[16] opacity-0" src={ICONS.chevron.faint} style={{ insetL: props.width - S.pad - 12 }} />
      <Show when={hasPills()}>
        <Index each={[0, 1, 2, 3]}>
          {(_, index) => <PillSlot pill={() => pills()?.pills[index] ?? null} y={() => pills()?.pillsY ?? 0} />}
        </Index>
      </Show>
      <Show when={hasStrip()}>
        <Index each={[0, 1, 2, 3]}>
          {(_, index) => <ItemSlot item={() => strip()?.items[index] ?? null} press={props.press} focused={props.focused} />}
        </Index>
      </Show>
    </View>
  );
}

export interface ListOptions {
  rows: Accessor<Row[]>;
  layer: LayerContext;
  press: Press;
  images: Images;
  keys: Accessor<boolean>;
  width: number;
  /** The list's visible height. */
  view: number;
  /** A page with no rows shows a spinner in the middle while this holds (always, without it). */
  loading?: Accessor<boolean>;
  /** The reader is near the end: ask for more. */
  onEnd?: () => void;
}

/** The nav stack's PageContent for a list of rows. */
export function listContent(options: ListOptions): PageContent {
  const { layer, press } = options;
  const placed = createMemo(() => {
    let y = 0;
    const out = options.rows();
    for (const row of out) {
      row.y = y;
      y += row.h;
    }
    return out;
  });
  const height = () => {
    const list = placed();
    const last = list[list.length - 1];
    return last ? last.y + last.h + 12 : 0;
  };
  const slots = () => {
    const pool = createSlotPool<Row>(placed, layer.offset, { view: options.view, overscan: OVERSCAN, minRowH: MIN_ROW });
    return <For each={pool.slots}>{(slot) => <Slot pool={pool} slot={slot} images={options.images} press={press} focused={focused} width={options.width} />}</For>;
  };
  const focused = (id: string) => options.keys() && layer.focus() === id;
  if (options.onEnd) onFrame(() => {
    if (layer.offset() + options.view * 2 > height()) options.onEnd!();
  });
  const stripItems = (row: Row): StripItem[] => (row.kind === "strip" ? row.items.filter((item) => item.run) : []);
  const runs = createMemo(() => {
    const map = new Map<string, { run: () => void; top: number; bottom: number }>();
    for (const row of placed()) {
      if (row.kind === "strip") for (const item of stripItems(row)) map.set(item.id, { run: item.run!, top: row.y, bottom: row.y + row.h });
      else if (row.id && row.run) map.set(row.id, { run: row.run, top: row.y, bottom: row.y + row.h });
    }
    return map;
  });
  return {
    view: () => (
      <>
        <Show when={layer.near()}>{untrack(slots)}</Show>
        <Show when={placed().length === 0 && (options.loading?.() ?? true)}>
          <View class="absolute" style={{ insetL: options.width / 2 - 11, insetT: Math.max(40, options.view / 2 - 30) }}>
            <ClassicSpinner size={22} color={T.muted} />
          </View>
        </Show>
      </>
    ),
    height,
    focusOrder: () => [...runs().keys()],
    targets(top, offset, bottom) {
      const out: Target[] = [];
      for (const row of placed()) {
        const y = top + row.y - offset;
        if (y + row.h <= top || y >= bottom) continue;
        if (row.kind === "strip") {
          for (const item of stripItems(row)) out.push({ id: item.id, x: item.x - 2, y: y + item.y - 4, w: item.w + 4, h: item.h + 8, run: item.run });
        } else if (row.id && row.run) out.push({ id: row.id, x: 0, y, w: options.width, h: row.h, run: row.run });
      }
      return out;
    },
    span(id) {
      const found = runs().get(id);
      return found ? [found.top, found.bottom] : null;
    },
    activate: (id) => runs().get(id)?.run(),
  };
}
