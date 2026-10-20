// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/x/views.tsx — the pages of X, all on the touch screen: the home
// timeline under a Following/For You control, and a post's thread (the posts
// it answers, the post in full, its replies). Rows have measured heights and
// are placed by offset; a fixed pool of slots draws the ones near the visible
// band (ui/slots.ts), as in Hacker News.

import { batch, createEffect, createMemo, createSignal, For, onMount, Show, type Accessor } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { Image, Text, View } from "@pocketjs/framework/components";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import { BTN } from "@pocketjs/framework/input";
import type { LayerContext, NavStack, PageContent, PageSpec } from "../ui/nav.tsx";
import { ellipsize, FONT, measure, toAscii, wrap } from "../ui/text.ts";
import { createSlotPool, paintText, type SlotPool } from "../ui/slots.ts";
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
const FOOT_H = 16;
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

function counts(post: Post, full: boolean): string {
  const parts = [`${shortCount(post.replies)} ${post.replies === 1 ? "reply" : "replies"}`, `${shortCount(post.reposts)} ${post.reposts === 1 ? "repost" : "reposts"}`, `${shortCount(post.likes)} ${post.likes === 1 ? "like" : "likes"}`];
  if (full && post.views) parts.push(`${shortCount(post.views)} views`);
  if (post.media) parts.push(post.media.kind === "video" ? "[Video]" : post.media.kind === "gif" ? "[GIF]" : post.media.count > 1 ? `[${post.media.count} photos]` : "[Photo]");
  return parts.join("   ");
}

function initials(post: Post): string {
  const source = toAscii(post.name || post.handle).replace(/[^A-Za-z0-9 ]/g, "").trim();
  const words = source.split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase() || "?";
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
  meta: string;
  body: string;
  bodyLines: number;
  quote: string;
  quoteLines: number;
  foot: string;
  initials: string;
  color: string;
}

const textCache = new Map<string, { post: Post; focal: boolean; lines: string[]; quote: string[] }>();

function postLines(post: Post, focal: boolean): { lines: string[]; quote: string[] } {
  const cached = textCache.get(post.id);
  if (cached && cached.post === post && cached.focal === focal) return cached;
  const reply = post.replyTo ? `Replying to @${toAscii(post.replyTo)}\n` : "";
  const lines = wrap(reply + toAscii(post.text || " "), FONT.sm, TEXT_W, focal ? Infinity : ROW_LINES);
  const quote = post.quote ? wrap(`${toAscii(post.quote.name)} @${toAscii(post.quote.handle)}: ${toAscii(post.quote.text)}`, FONT.xs, TEXT_W - 14, focal ? 6 : 2) : [];
  const entry = { post, focal, lines, quote };
  if (textCache.size > 600) textCache.clear();
  textCache.set(post.id, entry);
  return entry;
}

const previousRows = new Map<string, PostRow>();

function sameRow(a: PostRow, b: PostRow): boolean {
  return a.post === b.post && a.focal === b.focal && a.y === b.y && a.h === b.h && a.meta === b.meta;
}

/** Lay out `posts` from `top`: every row measured once per post and minute. */
export function layoutPosts(posts: readonly { post: Post; focal: boolean }[], now: number, top = 0, scope = ""): { rows: PostRow[]; height: number } {
  let y = top;
  const seen = new Map<string, number>();
  const rows = posts.map(({ post, focal }) => {
    const n = seen.get(post.id) ?? 0;
    seen.set(post.id, n + 1);
    const key = `${scope}${post.id}${n ? `.${n}` : ""}`;
    const { lines, quote } = postLines(post, focal);
    const repost = post.repostedBy ? `${toAscii(post.repostedBy)} reposted` : "";
    const quoteH = quote.length ? 4 + 12 + quote.length * QUOTE_LINE : 0;
    const h = PAD + (repost ? REPOST_H : 0) + HEAD_H + lines.length * BODY_LINE + quoteH + 4 + FOOT_H + PAD;
    const name = ellipsize(toAscii(post.name || post.handle), FONT.smBold, 150);
    const meta = ellipsize(`@${toAscii(post.handle)}  ${post.time ? ageText(post.time, now) : ""}`, FONT.xs, TEXT_W - measure(name, FONT.smBold) - 6);
    const next: PostRow = {
      key,
      post,
      focal,
      y,
      h,
      repost,
      head: name,
      meta,
      body: lines.join("\n"),
      bodyLines: lines.length,
      quote: quote.join("\n"),
      quoteLines: quote.length,
      foot: counts(post, focal),
      initials: initials(post),
      color: faceColor(post.handle),
    };
    const before = previousRows.get(key);
    const row = before && sameRow(before, next) ? before : next;
    previousRows.set(key, row);
    y += h;
    return row;
  });
  if (previousRows.size > 800) previousRows.clear();
  return { rows, height: y };
}

/** One slot of a post list's pool (ui/slots.ts): its nodes mount once, and
 *  the painter moves them and rewrites their texts for each new row. */
function PostSlot(props: { pool: SlotPool<PostRow>; slot: number; lit: (key: string) => boolean; model: XModel }) {
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
  let foot!: NodeMirror;
  const [key, setKey] = createSignal("");
  const [avatarUrl, setAvatarUrl] = createSignal<string | undefined>(undefined);
  const lit = createMemo(() => key() !== "" && props.lit(key()));
  const faceKey = createMemo(() => {
    props.model.avatars();
    return props.model.avatar(avatarUrl());
  });
  let y = -1;
  let h = -1;
  let focal = false;
  onMount(() => {
    createEffect(() => jump(wash, "opacity", lit() ? 1 : focal ? 0.5 : 0));
    props.pool.attach(props.slot, (row) => batch(() => {
      if (!row) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        for (const text of [letters, repost, head, meta, body, quote, foot]) paintText(text, "");
        setKey("");
        setAvatarUrl(undefined);
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (row.y !== y) jump(box, "translateY", (y = row.y));
      if (row.h !== h) jump(box, "height", (h = row.h));
      focal = row.focal;
      const top = PAD + (row.repost ? REPOST_H : 0);
      jump(face, "insetT", top);
      jump(headRow, "insetT", top);
      jump(body, "insetT", top + HEAD_H);
      const quoteTop = top + HEAD_H + row.bodyLines * BODY_LINE + 4;
      jump(quoteBox, "insetT", quoteTop);
      jump(quoteBox, "height", row.quoteLines ? 12 + row.quoteLines * QUOTE_LINE : 0);
      jump(quoteBox, "opacity", row.quoteLines ? 1 : 0);
      jump(foot, "insetT", quoteTop + (row.quoteLines ? 12 + row.quoteLines * QUOTE_LINE + 4 : 0));
      jump(disc, "bgColor", row.color);
      paintText(letters, row.initials);
      paintText(repost, row.repost);
      paintText(head, row.head);
      paintText(meta, row.meta);
      paintText(body, row.body);
      paintText(quote, row.quote);
      paintText(foot, row.foot);
      setAvatarUrl(row.post.avatar);
      setKey(row.key);
      jump(wash, "opacity", lit() ? 1 : focal ? 0.5 : 0);
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 w-[320] h-[60] opacity-0 contain-strict">
      <View ref={wash} class="absolute inset-0 opacity-0 bg-[#e8f3fd]" />
      <View class="absolute left-0 right-0 bottom-0 h-[1] bg-[#e6ecf0]" />
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
      <Text ref={foot} class="absolute left-[50] text-xs text-[#536471]">{" "}</Text>
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

// ---- the timeline ------------------------------------------------------------------

const SEG_X = 60;
const SEG_W = (W - SEG_X * 2) / KINDS.length;

function segmentTargets(env: XEnv): Target[] {
  return KINDS.map((kind, index) => ({ id: `kind.${kind.id}`, x: SEG_X + index * SEG_W, y: 0, w: SEG_W, h: 36, run: () => env.model.setKind(kind.id) }));
}

function Segments(props: { env: XEnv }) {
  const { model, press } = props.env;
  return (
    <>
      <View class="absolute left-[60] top-[6] w-[200] h-[24] rounded-[5] border border-[#000000] bg-gradient-to-b from-[#5c6166] to-[#2a2e33]" />
      <For each={KINDS}>
        {(kind, index) => (
          <>
            <View
              class={model.kind() === kind.id || press.is(`kind.${kind.id}`)
                ? "absolute top-[7] h-[22] bg-gradient-to-b from-[#3aa7f5] to-[#1580d0]"
                : "hidden"}
              style={{ insetL: SEG_X + 1 + index() * SEG_W, width: SEG_W - 1 }}
            />
            <Show when={index() > 0}>
              <View class="absolute top-[7] w-[1] h-[22] bg-[#000000]" style={{ insetL: SEG_X + index() * SEG_W }} />
            </Show>
            <Text class="absolute top-[11] text-xs text-white font-bold text-center" style={{ insetL: SEG_X + index() * SEG_W, width: SEG_W }}>{kind.label}</Text>
          </>
        )}
      </For>
    </>
  );
}

const NO_ROWS: never[] = [];

export function timelinePage(env: XEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { model, press } = env;
  const layout = createMemo(() => {
    const state = model.state();
    const { rows, height } = layoutPosts(state.posts.map((post) => ({ post, focal: false })), env.now(), 0, `${model.kind()}:`);
    return { rows, height: height + (state.cursor ? MORE_H : 8) };
  });
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
        <For each={pool.slots}>{(slot) => <PostSlot pool={pool} slot={slot} lit={lit} model={model} />}</For>
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
  const layout = createMemo(() => {
    const thread = state();
    if (!thread || thread.status !== "ready" || !thread.post) return { rows: [] as PostRow[], height: VIEW_H, footer: "" };
    const posts = [
      ...thread.before.map((post) => ({ post, focal: false })),
      { post: thread.post, focal: true },
      ...thread.replies.map((post) => ({ post, focal: false })),
    ];
    const { rows, height } = layoutPosts(posts, env.now(), 0, `${id}:`);
    const footer = thread.cursor ? "Loading more replies..." : thread.replies.length === 0 ? "No replies yet." : "";
    return { rows, height: height + (footer ? MORE_H : 8), footer };
  });
  const ready = () => state()?.status === "ready" && !!state()?.post;
  const pool = createSlotPool(() => (ready() ? layout().rows : NO_ROWS), layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: ROW_MIN_H });
  const lit = highlight(env, layer, "reply.");
  const keys = keyIndex(() => layout().rows, "reply.");
  // The page opens on the post itself, below the posts it answers.
  let placed = false;
  createEffect(() => {
    if (placed || !ready()) return;
    placed = true;
    const focal = layout().rows.find((row) => row.focal);
    if (focal && focal.y > 0) layer.reveal(focal.y, focal.y + Math.min(focal.h, VIEW_H));
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
        <For each={pool.slots}>{(slot) => <PostSlot pool={pool} slot={slot} lit={lit} model={model} />}</For>
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
