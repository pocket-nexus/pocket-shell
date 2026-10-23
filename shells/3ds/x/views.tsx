// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/x/views.tsx — the pages of X, all on the touch screen: the home
// timeline under a Following/For You control, and a post's thread (the posts
// it answers, the post in full, its replies). Rows have measured heights and
// are placed by offset; a fixed pool of slots draws the ones near the visible
// band (ui/slots.ts), as in Hacker News.
//
// Names and text in any script draw from font atlases the Mac renders
// (ui/glyphs.ts): a row whose text the loaded atlases cover draws from them,
// one that is not covered yet draws folded to ASCII in the baked face and
// is laid out again when its glyphs arrive. Each row ends in reply, repost
// and like buttons with their counts.

import { batch, createEffect, createMemo, createSignal, For, onMount, Show, type Accessor } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { getOps } from "@pocketjs/framework/host";
import { Image, Text, View } from "@pocketjs/framework/components";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import { BTN } from "@pocketjs/framework/input";
import type { LayerContext, NavStack, PageContent, PageSpec } from "../ui/nav.tsx";
import { ellipsize, FONT, measure, toAscii, wrap } from "../ui/text.ts";
import { richText, type Glyphs } from "../ui/glyphs.ts";
import { createMeasuredList, createSlotPool, paintText, type MeasuredRow, type SlotPool } from "../ui/slots.ts";
import { showSkeleton, Skeleton } from "../ui/skeleton.tsx";
import type { Press, Target } from "../ui/touch.ts";
import { KINDS, type Post } from "./api.ts";
import type { XModel } from "./model.ts";

const W = 320;
const VIEW_H = 204;
const OVERSCAN = 80;
const TEXT_X = 50;
const TEXT_W = W - TEXT_X - 10;
const PAD = 7;
const REPOST_H = 14;
const HEAD_H = 16;
const BODY_LINE = 17;
const QUOTE_LINE = 15;
const FOOT_H = 18;
/** The action bar: reply, repost and like, each an icon and its count. */
const ACT_X = TEXT_X - 6;
const ACT_W = 64;
const ACTS = ["reply", "repost", "like"] as const;
type Act = (typeof ACTS)[number];
/** fontSlot (contracts/spec/spec.ts PROP.fontSlot). */
const PROP_FONT_SLOT = 97;
const MORE_H = 44;
/** Body lines a timeline row shows; the post's page shows them all. */
const ROW_LINES = 7;
/** The shortest row: a head, one body line and the counts. */
const ROW_MIN_H = PAD + HEAD_H + BODY_LINE + 4 + FOOT_H + PAD;

export interface XEnv {
  model: XModel;
  press: Press;
  keys: Accessor<boolean>;
  now: Accessor<number>;
  /** The post the next pushed page shows. */
  opening: { id: string };
  /** Runtime text in any script: regular and bold atlases from the Mac. */
  text: Glyphs;
  bold: Glyphs;
  /** Open the reply composer for a post. */
  reply(post: Post): void;
  /** A list scrolled this frame. */
  moved(): void;
  /** No list has scrolled for a few frames. */
  resting(): boolean;
}

export function ageText(time: number, now: number): string {
  const s = Math.max(0, Math.floor((now - time) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 30))}mo`;
}

export function shortCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(n);
}

/** What follows the action bar: the views on a post's page, and its media. */
function extras(post: Post, full: boolean): string {
  const parts: string[] = [];
  if (full && post.views) parts.push(`${shortCount(post.views)} views`);
  if (post.media) parts.push(post.media.kind === "video" ? "[Video]" : post.media.kind === "gif" ? "[GIF]" : post.media.count > 1 ? `[${post.media.count} photos]` : "[Photo]");
  return parts.join(" ");
}

const countText = (n: number) => (n > 0 ? shortCount(n) : "");

function initials(post: Post, rich: boolean): string {
  const source = toAscii(post.name || post.handle).replace(/[^A-Za-z0-9 ]/g, "").trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    // A name with no Latin letters: its first character when the atlas
    // draws it, else the handle's first letter.
    const first = [...richText(post.name).trim()][0];
    return rich && first ? first : (post.handle[0] ?? "?").toUpperCase();
  }
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : words[0]!.slice(0, 2);
  return letters.toUpperCase();
}

const FACE_COLORS = ["#1d9bf0", "#7856ff", "#f91880", "#00ba7c", "#ff7a00", "#536471"];

function faceColor(handle: string): string {
  let h = 0;
  for (let i = 0; i < handle.length; i += 1) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return FACE_COLORS[h % FACE_COLORS.length]!;
}

// ---- rows -------------------------------------------------------------------------

export interface PostRow {
  /** Unique in its list: the post id, with the list's place for repeats. */
  key: string;
  post: Post;
  focal: boolean;
  y: number;
  h: number;
  repost: string;
  head: string;
  /** The shape the row was placed from (null while pending): its meta line
   *  follows the clock (metaLine), painted by the slot. */
  shape: RowShape | null;
  body: string;
  bodyLines: number;
  quote: string;
  quoteLines: number;
  /** The action bar's top, from the row's top. */
  footY: number;
  replies: string;
  reposts: string;
  likes: string;
  liked: boolean;
  reposted: boolean;
  extra: string;
  /** Names and text draw from the glyph atlases (else the baked face). */
  rich: boolean;
  initials: string;
  color: string;
  /** Not measured yet: the slot shows its skeleton at the estimated height. */
  pending: boolean;
  /** Kept while everything but the place stays (framework slot-list). */
  content: object | undefined;
}

/** The texts of a post that may hold any script. */
export function postTexts(post: Post): string[] {
  const out = [post.name, post.text];
  if (post.repostedBy) out.push(post.repostedBy);
  if (post.quote) out.push(post.quote.name, post.quote.text);
  return out;
}

interface GlyphPair {
  text: Glyphs;
  bold: Glyphs;
}

/** Posts whose texts went to the atlases (wantGlyphs), by id: the atlases
 *  follow the reader, so a post never asked for is not looked at. */
const wantedPosts = new Set<string>();

/** Whether a post draws rich, by post object. A covered post stays covered
 *  until an atlas starts over (epoch); an uncovered one stays uncovered
 *  while its atlas still lacks the codepoint that was missing. */
const coverage = new WeakMap<Post, { textEpoch: number; boldEpoch: number; face: Glyphs | null; cp: number }>();

/** A row draws rich when both atlases hold every glyph its texts use. */
function richRow(post: Post, glyphs: GlyphPair | null): boolean {
  if (!glyphs || !glyphs.text.ready() || !glyphs.bold.ready() || !wantedPosts.has(post.id)) return false;
  const known = coverage.get(post);
  if (known) {
    if (!known.face) {
      if (known.textEpoch === glyphs.text.epoch() && known.boldEpoch === glyphs.bold.epoch()) return true;
    } else if (!known.face.holds(known.cp)) {
      return false;
    }
  }
  let face: Glyphs | null = glyphs.text;
  let cp = -1;
  for (const text of postTexts(post)) if ((cp = glyphs.text.missing(text)) >= 0) break;
  if (cp < 0) {
    face = glyphs.bold;
    cp = glyphs.bold.missing(post.name);
    if (cp < 0 && post.repostedBy) cp = glyphs.bold.missing(post.repostedBy);
  }
  if (cp < 0) face = null;
  coverage.set(post, { textEpoch: glyphs.text.epoch(), boldEpoch: glyphs.bold.epoch(), face, cp });
  return face === null;
}

/** Tell the app when the list scrolls: glyph atlases wait for it to rest
 *  (ui/glyphs.ts when). A post that changes face changes height and
 *  moves every row below it, which under a moving list reads as a jump. */
function reportMotion(env: XEnv, offset: () => number) {
  let last = Number.NaN;
  onFrame(() => {
    const at = offset();
    if (at !== last) env.moved();
    last = at;
  });
}

/** A post's row apart from its place in the list: wrapped texts, heights,
 *  counts. It depends on the post object, focus and face alone: a glyph's
 *  advance is the same in every atlas, so an atlas that loads leaves a rich
 *  shape as it is. The meta line is kept for the clock it was made at, and
 *  the shape keeps the row it last made. */
interface RowShape {
  rich: boolean;
  h: number;
  footY: number;
  repost: string;
  head: string;
  nameW: number;
  body: string;
  bodyLines: number;
  quote: string;
  quoteLines: number;
  replies: string;
  reposts: string;
  likes: string;
  extra: string;
  initials: string;
  color: string;
  ageAt: number;
  age: string;
  meta: string;
  row: PostRow | null;
}

/** A post's shapes in each face, by post object: model.view keeps a post's
 *  object while its marks stay, so these lookups hash no strings. */
interface Faces {
  baked?: RowShape;
  rich?: RowShape;
}
const shapes = new WeakMap<Post, Faces>();
const focalShapes = new WeakMap<Post, Faces>();

function facesOf(post: Post, focal: boolean): Faces {
  const cache = focal ? focalShapes : shapes;
  let faces = cache.get(post);
  if (!faces) cache.set(post, (faces = {}));
  return faces;
}

function rowShape(post: Post, focal: boolean, glyphs: GlyphPair | null, rich: boolean): RowShape {
  const faces = facesOf(post, focal);
  const known = rich ? faces.rich : faces.baked;
  if (known) return known;
  let lines: string[];
  let quote: string[];
  if (rich && glyphs) {
    const reply = post.replyTo ? `Replying to @${post.replyTo}\n` : "";
    lines = glyphs.text.wrap(reply + richText(post.text || " "), TEXT_W, focal ? Infinity : ROW_LINES);
    quote = post.quote ? glyphs.text.wrap(richText(`${post.quote.name} @${post.quote.handle}: ${post.quote.text}`), TEXT_W - 14, focal ? 6 : 2) : [];
  } else {
    const reply = post.replyTo ? `Replying to @${toAscii(post.replyTo)}\n` : "";
    lines = wrap(reply + toAscii(post.text || " "), FONT.sm, TEXT_W, focal ? Infinity : ROW_LINES);
    quote = post.quote ? wrap(`${toAscii(post.quote.name)} @${toAscii(post.quote.handle)}: ${toAscii(post.quote.text)}`, FONT.xs, TEXT_W - 14, focal ? 6 : 2) : [];
  }
  const repost = post.repostedBy ? `${rich ? richText(post.repostedBy) : toAscii(post.repostedBy)} reposted` : "";
  const quoteH = quote.length ? 4 + 12 + quote.length * QUOTE_LINE : 0;
  const footY = PAD + (repost ? REPOST_H : 0) + HEAD_H + lines.length * BODY_LINE + quoteH + 4;
  const head = rich && glyphs ? glyphs.bold.ellipsize(richText(post.name || post.handle), 150) : ellipsize(toAscii(post.name || post.handle), FONT.smBold, 150);
  const shape: RowShape = {
    rich,
    h: footY + FOOT_H + PAD,
    footY,
    repost,
    head,
    nameW: rich && glyphs ? glyphs.bold.measure(head) : measure(head, FONT.smBold),
    body: lines.join("\n"),
    bodyLines: lines.length,
    quote: quote.join("\n"),
    quoteLines: quote.length,
    replies: countText(post.replies),
    reposts: countText(post.reposts),
    likes: countText(post.likes),
    extra: extras(post, focal),
    initials: initials(post, rich),
    color: faceColor(post.handle),
    ageAt: Number.NaN,
    age: "",
    meta: "",
    row: null,
  };
  if (rich) faces.rich = shape;
  else faces.baked = shape;
  return shape;
}

/** A post's height before it is shaped: its text's width at a glance (wide
 *  characters 13 px, the rest 6 px) over the line width. */
function estimateHeight(post: Post, focal: boolean): number {
  const text = post.text || " ";
  const width = text.length * (WIDE_TEXT.test(text) ? 13 : 6);
  const lines = Math.max(1, Math.min(focal ? 40 : ROW_LINES, Math.ceil(width / TEXT_W)));
  const quoteH = post.quote ? 4 + 12 + 2 * QUOTE_LINE : 0;
  return PAD + (post.repostedBy ? REPOST_H : 0) + HEAD_H + lines * BODY_LINE + quoteH + 4 + FOOT_H + PAD;
}
const WIDE_TEXT = /[\u2e80-\uffff]/;

/** The list's measured rows as PostRows: a shaped post takes its shape's
 *  texts, a pending one only its place. A row stays the same object while
 *  its shape, key and place do, so the slot pool repaints nothing for it. */
function placeRows(rows: readonly MeasuredRow<Post, RowShape>[], scope: string, focal: (post: Post) => boolean): PostRow[] {
  const seen = new Map<string, number>();
  return rows.map(({ item: post, y, h, value: shape }) => {
    const n = seen.get(post.id) ?? 0;
    seen.set(post.id, n + 1);
    const key = n ? `${scope}${post.id}.${n}` : scope + post.id;
    if (!shape) {
      const before = pendingRows.get(post);
      if (before && before.y === y && before.h === h && before.key === key) return before;
      const row: PostRow = { ...PENDING_ROW, key, post, focal: focal(post), y, h, liked: !!post.liked, reposted: !!post.reposted, content: undefined };
      pendingRows.set(post, row);
      return row;
    }
    const before = shape.row;
    if (before && before.y === y && before.key === key && before.post === post) return before;
    const isFocal = focal(post);
    const row: PostRow = {
      key,
      post,
      focal: isFocal,
      y,
      h: shape.h,
      repost: shape.repost,
      head: shape.head,
      shape,
      body: shape.body,
      bodyLines: shape.bodyLines,
      quote: shape.quote,
      quoteLines: shape.quoteLines,
      footY: shape.footY,
      replies: shape.replies,
      reposts: shape.reposts,
      likes: shape.likes,
      liked: !!post.liked,
      reposted: !!post.reposted,
      extra: shape.extra,
      rich: shape.rich,
      initials: shape.initials,
      color: shape.color,
      pending: false,
      content: before && before.key === key && before.post === post && before.focal === isFocal ? before.content : {},
    };
    shape.row = row;
    return row;
  });
}

/** "@handle  5m", fitted beside the name, for the clock at `now`: kept in
 *  the shape and made again only when the age reads differently. */
function metaLine(post: Post, shape: RowShape, now: number): string {
  if (shape.ageAt === now) return shape.meta;
  shape.ageAt = now;
  const age = post.time ? ageText(post.time, now) : "";
  if (shape.age !== age || shape.meta === "") {
    shape.age = age;
    shape.meta = ellipsize(`@${toAscii(post.handle)}  ${age}`, FONT.xs, TEXT_W - shape.nameW - 6);
  }
  return shape.meta;
}

const pendingRows = new WeakMap<Post, PostRow>();
const PENDING_ROW: Omit<PostRow, "key" | "post" | "focal" | "y" | "h" | "liked" | "reposted" | "content"> = {
  repost: "",
  head: "",
  shape: null,
  body: "",
  bodyLines: 0,
  quote: "",
  quoteLines: 0,
  footY: 0,
  replies: "",
  reposts: "",
  likes: "",
  extra: "",
  rich: false,
  initials: "",
  color: "#e1e6ea",
  pending: true,
};

/** A list of posts measured on demand (framework slot-list): a post is
 *  shaped when it comes near the view, or while the list stands still, and
 *  shaped again in its new face when the glyph atlases come to cover it. */
function postList(env: XEnv, layer: LayerContext, posts: () => readonly Post[], focal: (post: Post) => boolean) {
  const list = createMeasuredList<Post, RowShape>({
    items: posts,
    measure: (post) => rowShape(post, focal(post), env, richRow(post, env)),
    estimate: (post) => estimateHeight(post, focal(post)),
    version: (post) => richRow(post, env),
    offset: layer.offset,
    view: VIEW_H,
    overscan: OVERSCAN,
    rebase: layer.rebase,
  });
  // An atlas that loads can bring any post into the rich face.
  createEffect(() => {
    env.text.revision();
    env.bold.revision();
    list.recheck();
  });
  return list;
}

/** The font slots a row's texts draw from: the baked faces, or the glyph
 *  atlases (ui/glyphs.ts GLYPH_TEXT 21, GLYPH_BOLD 22). */
const BAKED_SLOTS = { head: FONT.smBold, body: FONT.sm, quote: FONT.xs, repost: FONT.xsBold, letters: FONT.xsBold };
const RICH_SLOTS = { head: 22, body: 21, quote: 21, repost: 22, letters: 22 };

/** One slot of a post list's pool (ui/slots.ts): its nodes mount once, and
 *  the painter moves them and rewrites their texts for each new row. */
function PostSlot(props: { pool: SlotPool<PostRow>; slot: number; lit: (key: string) => boolean; model: XModel; press: Press; now: Accessor<number> }) {
  let box!: NodeMirror;
  let wash!: NodeMirror;
  let face!: NodeMirror;
  let disc!: NodeMirror;
  let letters!: NodeMirror;
  let repost!: NodeMirror;
  let head!: NodeMirror;
  let meta!: NodeMirror;
  let headRow!: NodeMirror;
  let body!: NodeMirror;
  let quoteBox!: NodeMirror;
  let quote!: NodeMirror;
  let bar!: NodeMirror;
  const counts: Record<Act, NodeMirror | undefined> = { reply: undefined, repost: undefined, like: undefined };
  let extra!: NodeMirror;
  let content!: NodeMirror;
  let skeletonNode!: NodeMirror;
  let skeletonShown = false;
  /** The row painted in full, whose meta line follows the clock. */
  let shown: PostRow | null = null;
  const [key, setKey] = createSignal("");
  const [avatarUrl, setAvatarUrl] = createSignal<string | undefined>(undefined);
  const [liked, setLiked] = createSignal(false);
  const [reposted, setReposted] = createSignal(false);
  const lit = createMemo(() => key() !== "" && props.lit(key()));
  const faceKey = createMemo(() => {
    props.model.avatars();
    return props.model.avatar(avatarUrl());
  });
  let y = -1;
  let h = -1;
  let focal = false;
  let rich: boolean | null = null;
  const setSlots = (slots: Record<keyof typeof BAKED_SLOTS, number>) => {
    const ops = getOps();
    ops.setProp(head.id, PROP_FONT_SLOT, slots.head);
    ops.setProp(body.id, PROP_FONT_SLOT, slots.body);
    ops.setProp(quote.id, PROP_FONT_SLOT, slots.quote);
    ops.setProp(repost.id, PROP_FONT_SLOT, slots.repost);
    ops.setProp(letters.id, PROP_FONT_SLOT, slots.letters);
  };
  onMount(() => {
    createEffect(() => jump(wash, "opacity", lit() ? 1 : focal ? 0.5 : 0));
    // A new minute rewrites the meta line of the row on show, not the list.
    createEffect(() => {
      const now = props.now();
      if (shown?.shape && !skeletonShown) paintText(meta, metaLine(shown.post, shown.shape, now));
    });
    props.pool.attach(props.slot, (row, skeleton, moved) => batch(() => {
      if (!row) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        for (const text of [letters, repost, head, meta, body, quote, extra, counts.reply!, counts.repost!, counts.like!]) paintText(text, "");
        setKey("");
        setAvatarUrl(undefined);
        shown = null;
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (row.y !== y) jump(box, "translateY", (y = row.y));
      if (row.h !== h) jump(box, "height", (h = row.h));
      if (moved) return;
      focal = row.focal;
      setKey(row.key);
      if (skeleton !== skeletonShown) showSkeleton(skeletonNode, content, (skeletonShown = skeleton));
      if (skeleton) return;
      if (row.rich !== rich) setSlots((rich = row.rich) ? RICH_SLOTS : BAKED_SLOTS);
      const top = PAD + (row.repost ? REPOST_H : 0);
      jump(face, "insetT", top);
      jump(headRow, "insetT", top);
      jump(body, "insetT", top + HEAD_H);
      const quoteTop = top + HEAD_H + row.bodyLines * BODY_LINE + 4;
      jump(quoteBox, "insetT", quoteTop);
      jump(quoteBox, "height", row.quoteLines ? 12 + row.quoteLines * QUOTE_LINE : 0);
      jump(quoteBox, "opacity", row.quoteLines ? 1 : 0);
      jump(bar, "insetT", row.footY);
      jump(disc, "bgColor", row.color);
      paintText(letters, row.initials);
      paintText(repost, row.repost);
      paintText(head, row.head);
      shown = row;
      paintText(meta, row.shape ? metaLine(row.post, row.shape, props.now()) : "");
      paintText(body, row.body);
      paintText(quote, row.quote);
      paintText(counts.reply!, row.replies);
      paintText(counts.repost!, row.reposts);
      paintText(counts.like!, row.likes);
      paintText(extra, row.extra);
      setLiked(row.liked);
      setReposted(row.reposted);
      setAvatarUrl(row.post.avatar);
      jump(wash, "opacity", lit() ? 1 : focal ? 0.5 : 0);
    }));
  });
  const ICONS: Record<Act, () => string> = {
    reply: () => "art/reply.svg",
    repost: () => (reposted() ? "art/repost-on.svg" : "art/repost.svg"),
    like: () => (liked() ? "art/like-on.svg" : "art/like.svg"),
  };
  const TINTS: Record<Act, string> = { reply: "#1d9bf024", repost: "#00ba7c24", like: "#f9188024" };
  const COUNT_CLASS: Record<Act, () => string> = {
    reply: () => "absolute left-[24] top-[2] text-xs text-[#536471]",
    repost: () => (reposted() ? "absolute left-[24] top-[2] text-xs text-[#00ba7c]" : "absolute left-[24] top-[2] text-xs text-[#536471]"),
    like: () => (liked() ? "absolute left-[24] top-[2] text-xs text-[#f91880]" : "absolute left-[24] top-[2] text-xs text-[#536471]"),
  };
  return (
    <View ref={box} class="absolute left-0 top-0 w-[320] h-[60] opacity-0 contain-strict">
      <View ref={wash} class="absolute inset-0 opacity-0 bg-[#e8f3fd]" />
      <View class="absolute left-0 right-0 bottom-0 h-[1] bg-[#e6ecf0]" />
      <Skeleton ref={(node) => (skeletonNode = node)} x={TEXT_X} width={TEXT_W - 20} face lines={2} />
      <View ref={content} class="absolute inset-0">
        <Text ref={repost} class="absolute left-[50] top-[6] text-xs text-[#536471] font-bold">{" "}</Text>
        <View ref={face} class="absolute left-[10] top-[7] w-[32] h-[32]">
          <View ref={disc} class="absolute left-0 top-0 w-[32] h-[32] rounded-[16] bg-[#1d9bf0] flex-col justify-center items-center">
            <Text ref={letters} class="text-xs text-white font-bold">{" "}</Text>
          </View>
          <Show when={faceKey()}>{(src) => <Image class="absolute left-0 top-0 w-[32] h-[32]" src={src()} />}</Show>
        </View>
        <View ref={headRow} class="absolute left-[50] top-[7] flex-row items-center">
          <Text ref={head} class="text-sm text-[#0f1419] font-bold">{" "}</Text>
          <Text ref={meta} class="ml-[6] text-xs text-[#536471]">{" "}</Text>
        </View>
        <Text ref={body} class="absolute left-[50] top-[23] text-sm text-[#0f1419] leading-[17]">{" "}</Text>
        <View ref={quoteBox} class="absolute left-[50] w-[260] h-0 opacity-0 rounded-[8] border border-[#cfd9de] bg-white">
          <Text ref={quote} class="absolute left-[7] top-[5] text-xs text-[#0f1419] leading-[15]">{" "}</Text>
        </View>
        <View ref={bar} class="absolute left-0 top-0 w-[320] h-[18]">
          <For each={ACTS}>
            {(act, index) => (
              <View class="absolute top-0 w-[64] h-[18]" style={{ insetL: ACT_X + index() * ACT_W }}>
                <View
                  class={props.press.is(`act.${act}.${key()}`) ? "absolute left-[-1] top-[-4] w-[26] h-[26] rounded-[13]" : "hidden"}
                  style={{ bgColor: TINTS[act] }}
                />
                <Image class="absolute left-[4] top-[1] w-[16] h-[16]" src={ICONS[act]()} />
                <Text ref={(node: NodeMirror) => (counts[act] = node)} class={COUNT_CLASS[act]()}>{" "}</Text>
              </View>
            )}
          </For>
          <Text ref={extra} class="absolute left-[238] top-[2] text-xs text-[#536471]">{" "}</Text>
        </View>
      </View>
    </View>
  );
}

/** Focus keys and rows by key for a layout, built when the d-pad first asks. */
function keyIndex(rows: () => readonly PostRow[], prefix: string) {
  let built: readonly PostRow[] | null = null;
  let order: string[] = [];
  let byKey = new Map<string, PostRow>();
  return () => {
    const list = rows();
    if (list !== built) {
      built = list;
      order = list.map((row) => prefix + row.key);
      byKey = new Map(list.map((row, index) => [order[index]!, row]));
    }
    return { order, byKey };
  };
}

function highlight(env: XEnv, layer: LayerContext, prefix: string): (key: string) => boolean {
  const keyOf = (id: string) => (id.startsWith(prefix) ? id.slice(prefix.length) : "");
  const pressed = createMemo(() => keyOf(env.press.id()));
  const focused = createMemo(() => (env.keys() ? keyOf(layer.focus()) : ""));
  return (key) => key === pressed() || key === focused();
}

function Centered(props: { title: string; detail: string; spinner?: boolean; button?: { id: string; label: string }; press: Press; top?: number }) {
  const top = () => props.top ?? 0;
  const lines = () => wrap(props.detail, FONT.xs, 270, 5);
  return (
    <>
      <Show when={props.spinner}>
        <View class="absolute left-[149]" style={{ insetT: top() + 40 }}>
          <ClassicSpinner size={22} color={"#536471"} />
        </View>
      </Show>
      <Text class="absolute left-0 w-[320] text-base text-[#0f1419] font-bold text-center" style={{ insetT: top() + 74 }}>{props.title}</Text>
      <For each={lines()}>
        {(line, index) => <Text class="absolute left-[25] w-[270] text-xs text-[#536471] text-center" style={{ insetT: top() + 98 + index() * 15 }}>{line}</Text>}
      </For>
      <Show when={props.button}>
        {(button) => (
          <>
            <View
              class={props.press.is(button().id)
                ? "absolute left-[100] w-[120] h-[30] rounded-[15] bg-[#1a8cd8]"
                : "absolute left-[100] w-[120] h-[30] rounded-[15] bg-[#0f1419]"}
              style={{ insetT: top() + 164 }}
            />
            <Text class="absolute left-[100] w-[120] text-sm text-white font-bold text-center" style={{ insetT: top() + 171 }}>{button().label}</Text>
          </>
        )}
      </Show>
    </>
  );
}

// ---- actions and glyphs -----------------------------------------------------------

/** Each row's reply, repost and like buttons: 64 px wide, from 6 px above
 *  the bar to 6 px below it, over the row's own target. */
function actionTargets(env: XEnv, row: PostRow, rowY: number, out: Target[]) {
  ACTS.forEach((act, index) => {
    out.push({
      id: `act.${act}.${row.key}`,
      x: ACT_X + index * ACT_W - 4,
      y: rowY + row.footY - 6,
      w: ACT_W,
      h: FOOT_H + 12,
      run: () => (act === "reply" ? env.reply(row.post) : env.model.toggle(row.post, act)),
    });
  });
}

/** Ask the glyph atlases for the texts of the rows around the visible band
 *  (two screens above and below), again whenever the list changes or the
 *  band moves by GLYPH_STEP: an atlas holds what one response carries, so
 *  it follows the reader rather than the whole list. */
const GLYPH_STEP = 120;

function wantGlyphs(env: XEnv, rows: () => readonly PostRow[], offset: () => number) {
  // Posts already asked for, by both faces' wants() at the time: a band
  // move asks only for the posts that came near.
  const asked = new WeakMap<Post, number>();
  const wants = () => env.text.wants() * 65536 + env.bold.wants();
  let doneRows: readonly PostRow[] | null = null;
  let doneBand = Number.NaN;
  let doneWants = -1;
  // Asked for while the lists rest, when the requests go out too (ui/glyphs.ts
  // when): in motion the band moves every few frames, and the scan and the
  // codepoints of new posts cost a frame.
  onFrame(() => {
    if (!env.resting()) return;
    const band = Math.floor(offset() / GLYPH_STEP);
    const list = rows();
    const now = wants();
    if (list === doneRows && band === doneBand && now === doneWants) return;
    doneRows = list;
    doneBand = band;
    const top = band * GLYPH_STEP - 2 * VIEW_H;
    const bottom = band * GLYPH_STEP + 3 * VIEW_H;
    const fresh: Post[] = [];
    for (const row of list) if (row.y + row.h > top && row.y < bottom && asked.get(row.post) !== now) fresh.push(row.post);
    if (fresh.length > 0) {
      env.text.want(fresh.flatMap(postTexts));
      env.bold.want(fresh.flatMap((post) => (post.repostedBy ? [post.name, post.repostedBy] : [post.name])));
    }
    doneWants = wants();
    for (const post of fresh) {
      asked.set(post, doneWants);
      wantedPosts.add(post.id);
    }
  });
}

// ---- the timeline ------------------------------------------------------------------

const SEG_X = 60;
const SEG_W = (W - SEG_X * 2) / KINDS.length;

function segmentTargets(env: XEnv): Target[] {
  return KINDS.map((kind, index) => ({ id: `kind.${kind.id}`, x: SEG_X + index * SEG_W, y: 0, w: SEG_W, h: 36, run: () => env.model.setKind(kind.id) }));
}

/** A segment's fill inside the frame's 1 px border: x and width. The frame
 *  spans SEG_X .. SEG_X + 200 with its border inside that, and a 1 px
 *  divider sits at each segment's left edge but the first. */
function segmentFill(index: number): { x: number; w: number } {
  const left = SEG_X + index * SEG_W + 1;
  const right = index === KINDS.length - 1 ? SEG_X + KINDS.length * SEG_W - 1 : SEG_X + (index + 1) * SEG_W;
  return { x: left, w: right - left };
}

function Segments(props: { env: XEnv }) {
  const { model, press } = props.env;
  const on = (kind: (typeof KINDS)[number]) => model.kind() === kind.id || press.is(`kind.${kind.id}`);
  return (
    <>
      <View class="absolute left-[60] top-[6] w-[200] h-[24] rounded-[5] border border-[#000000] bg-gradient-to-b from-[#5c6166] to-[#2a2e33]" />
      <For each={KINDS}>
        {(kind, index) => {
          const fill = segmentFill(index());
          const first = index() === 0;
          const last = index() === KINDS.length - 1;
          // Rounded where the segment meets the frame's corners, square where
          // it meets a divider: a rounded fill with a square one over its
          // inner side.
          const square = { x: fill.x + (first ? 5 : 0), w: fill.w - (first ? 5 : 0) - (last ? 5 : 0) };
          return (
            <>
              <View
                class={on(kind) && (first || last) ? "absolute top-[7] h-[22] rounded-[4] bg-gradient-to-b from-[#3aa7f5] to-[#1580d0]" : "hidden"}
                style={{ insetL: fill.x, width: fill.w }}
              />
              <View
                class={on(kind) ? "absolute top-[7] h-[22] bg-gradient-to-b from-[#3aa7f5] to-[#1580d0]" : "hidden"}
                style={{ insetL: square.x, width: square.w }}
              />
              <Show when={index() > 0}>
                <View class="absolute top-[7] w-[1] h-[22] bg-[#000000]" style={{ insetL: SEG_X + index() * SEG_W }} />
              </Show>
              <Text class="absolute top-[11] text-xs text-white font-bold text-center" style={{ insetL: SEG_X + index() * SEG_W, width: SEG_W }}>{kind.label}</Text>
            </>
          );
        }}
      </For>
    </>
  );
}

const NO_ROWS: never[] = [];

export function timelinePage(env: XEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { model, press } = env;
  reportMotion(env, layer.offset);
  const posts = createMemo(() => {
    model.marks();
    return model.state().posts.map((post) => model.view(post));
  });
  const list = postList(env, layer, posts, () => false);
  const layout = createMemo(() => {
    const rows = placeRows(list.rows(), `${model.kind()}:`, () => false);
    return { rows, height: list.height() + (model.state().cursor ? MORE_H : 8) };
  });
  wantGlyphs(env, () => layout().rows, layer.offset);
  const listed = () => model.state().status === "ready" && model.state().posts.length > 0;
  const pool = createSlotPool(() => (listed() ? layout().rows : NO_ROWS), layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: ROW_MIN_H });
  const lit = highlight(env, layer, "post.");
  const keys = keyIndex(() => layout().rows, "post.");
  const open = (row: PostRow) => {
    env.opening.id = row.post.id;
    model.openThread(row.post.id);
    stack.push("post");
  };
  createEffect(() => {
    const focused = layer.focus();
    const rows = layout().rows;
    const row = keys().byKey.get(focused);
    if (row && rows.indexOf(row) >= rows.length - 3) model.more();
  });
  onFrame(() => {
    if (listed() && layer.offset() + VIEW_H > layout().height - MORE_H - 60) model.more();
  });
  const content: PageContent = {
    view: () => (
      <>
        <For each={pool.slots}>{(slot) => <PostSlot pool={pool} slot={slot} lit={lit} model={model} press={press} now={env.now} />}</For>
        <Show when={!listed()}>
          {model.state().status === "error"
            ? <Centered title={model.state().error!.title} detail={model.state().error!.detail} button={{ id: "x.retry", label: "Try Again" }} press={press} />
            : model.state().status === "ready"
              ? <Centered title="Nothing here yet" detail="Posts from the accounts you follow show up here." press={press} />
              : <Centered title="Loading" detail="Reading your timeline through your Mac." spinner press={press} />}
        </Show>
        <Show when={listed() && model.state().cursor}>
          <View class="absolute left-[118]" style={{ insetT: layout().height - MORE_H + 13 }}>
            <ClassicSpinner size={18} color={"#536471"} />
          </View>
          <Text class="absolute left-[144] text-sm text-[#536471] font-bold" style={{ insetT: layout().height - MORE_H + 13 }}>Loading...</Text>
        </Show>
      </>
    ),
    height: () => (listed() ? layout().height : VIEW_H),
    focusOrder: () => keys().order,
    targets(top, offset, bottom) {
      if (model.state().status === "error") return [{ id: "x.retry", x: 100, y: top + 164 - offset, w: 120, h: 30, run: () => model.reload() }];
      const out: Target[] = [];
      if (!listed()) return out;
      for (const row of layout().rows) {
        const y = top + row.y - offset;
        if (y + row.h <= top || y >= bottom) continue;
        out.push({ id: `post.${row.key}`, x: 0, y, w: W, h: row.h, run: () => open(row) });
        actionTargets(env, row, y, out);
      }
      return out;
    },
    span(id) {
      const row = keys().byKey.get(id);
      return row ? [row.y, row.y + row.h] : null;
    },
    activate(id) {
      const row = keys().byKey.get(id);
      if (row) open(row);
      else if (id === "x.retry") model.reload();
    },
  };
  return {
    title: () => "Home",
    backLabel: "Home",
    tint: "black",
    bare: "white",
    titleView: () => <Segments env={env} />,
    fixedTargets: () => segmentTargets(env),
    content,
    key(pressed) {
      if (pressed & (BTN.LTRIGGER | BTN.RTRIGGER)) {
        const at = KINDS.findIndex((kind) => kind.id === model.kind());
        model.setKind(KINDS[(at + (pressed & BTN.LTRIGGER ? -1 : 1) + KINDS.length) % KINDS.length]!.id);
      } else if (pressed & BTN.TRIANGLE) model.reload();
      else if (pressed & BTN.CIRCLE && model.state().status === "error") model.reload();
      else return false;
      return true;
    },
  };
}

// ---- a post's thread ------------------------------------------------------------------

export function postPage(env: XEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { model, press } = env;
  const id = env.opening.id;
  const state = () => model.thread(id);
  reportMotion(env, layer.offset);
  const focalPost = createMemo(() => {
    model.marks();
    const thread = state();
    return thread?.post ? model.view(thread.post) : null;
  });
  const posts = createMemo((): readonly Post[] => {
    model.marks();
    const thread = state();
    if (!thread || thread.status !== "ready" || !thread.post) return [];
    return [...thread.before.map((post) => model.view(post)), focalPost()!, ...thread.replies.map((post) => model.view(post))];
  });
  const isFocal = (post: Post) => post === focalPost();
  const list = postList(env, layer, posts, isFocal);
  const layout = createMemo(() => {
    const thread = state();
    if (!thread || thread.status !== "ready" || !thread.post) return { rows: [] as PostRow[], height: VIEW_H, footer: "" };
    const rows = placeRows(list.rows(), `${id}:`, isFocal);
    const footer = thread.cursor ? "Loading more replies..." : thread.replies.length === 0 ? "No replies yet." : "";
    return { rows, height: list.height() + (footer ? MORE_H : 8), footer };
  });
  const ready = () => state()?.status === "ready" && !!state()?.post;
  wantGlyphs(env, () => layout().rows, layer.offset);
  const pool = createSlotPool(() => (ready() ? layout().rows : NO_ROWS), layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: ROW_MIN_H });
  const lit = highlight(env, layer, "reply.");
  const keys = keyIndex(() => layout().rows, "reply.");
  // The page opens on the post itself, below the posts it answers.
  let placed = false;
  createEffect(() => {
    if (placed || !ready()) return;
    // The list lays its rows out on the frame after the thread arrives.
    const focal = layout().rows.find((row) => row.focal);
    if (!focal) return;
    placed = true;
    if (focal.y > 0) layer.reveal(focal.y, focal.y + Math.min(focal.h, VIEW_H));
  });
  onFrame(() => {
    if (ready() && state()?.cursor && layer.offset() + VIEW_H > layout().height - MORE_H - 60) model.moreReplies(id);
  });
  const open = (row: PostRow) => {
    if (row.focal) return;
    env.opening.id = row.post.id;
    model.openThread(row.post.id);
    stack.push("post");
  };
  const content: PageContent = {
    view: () => (
      <>
        <For each={pool.slots}>{(slot) => <PostSlot pool={pool} slot={slot} lit={lit} model={model} press={press} now={env.now} />}</For>
        <Show when={!ready()}>
          {state()?.status === "error"
            ? <Centered title={state()!.error!.title} detail={state()!.error!.detail} button={{ id: "post.retry", label: "Try Again" }} press={press} />
            : state()?.status === "ready"
              ? <Centered title="Post unavailable" detail="X did not return this post. It may be deleted or protected." press={press} />
              : <Centered title="Loading" detail="Reading the conversation through your Mac." spinner press={press} />}
        </Show>
        <Show when={ready() && layout().footer}>
          <Text class="absolute left-0 w-[320] text-xs text-[#536471] font-bold text-center" style={{ insetT: layout().height - 31 }}>{layout().footer}</Text>
        </Show>
      </>
    ),
    height: () => layout().height,
    focusOrder: () => keys().order,
    targets(top, offset, bottom) {
      if (state()?.status === "error") return [{ id: "post.retry", x: 100, y: top + 164 - offset, w: 120, h: 30, run: () => model.openThread(id) }];
      const out: Target[] = [];
      if (!ready()) return out;
      for (const row of layout().rows) {
        const y = top + row.y - offset;
        if (y + row.h <= top || y >= bottom) continue;
        out.push({ id: `reply.${row.key}`, x: 0, y, w: W, h: row.h, run: () => open(row) });
        actionTargets(env, row, y, out);
      }
      return out;
    },
    span(key) {
      const row = keys().byKey.get(key);
      return row ? [row.y, row.y + row.h] : null;
    },
    activate(key) {
      const row = keys().byKey.get(key);
      if (row) open(row);
      else if (key === "post.retry") model.openThread(id);
    },
  };
  return {
    title: () => "Post",
    backLabel: "Post",
    tint: "black",
    bare: "white",
    content,
    key(pressed) {
      if (pressed & (BTN.LTRIGGER | BTN.RTRIGGER)) {
        layer.scrollBy(pressed & BTN.LTRIGGER ? -(VIEW_H - 34) : VIEW_H - 34);
        return true;
      }
      if (pressed & BTN.TRIANGLE) {
        placed = false;
        model.openThread(id);
        return true;
      }
      return false;
    },
  };
}
