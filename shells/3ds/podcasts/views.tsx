// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/podcasts/views.tsx — the pages of Podcasts: the library and the
// search under a Library/Search segmented control, a show's page (artwork,
// title, author, Subscribe, its episodes) and the player.
//
// The lists are fixed pools of slots (ui/slots.ts): a show row is its
// artwork, a two-line title and the author; an episode row a two-line
// title and a line of date and length, with a Now Playing mark on the
// episode the player has. The host plays the companion's audio stream and
// draws no picture for it (its plane stays black), so the player draws the
// show's artwork and a track of its own over the stream's position.

import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { createGesture } from "@pocketjs/framework/gesture";
import { Image, Text, View } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import { BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { createMediaScrubber } from "@pocketjs/framework/media";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import { companionNow } from "@pocketjs/framework/link";
import { barButtonWidth, NAV_H, type NavButton } from "../ui/bar.tsx";
import { viewHeight, type LayerContext, type NavStack, type PageContent, type PageSpec } from "../ui/nav.tsx";
import { COMPACT, SCREEN_H, SCREEN_W, appletSurfaceId, appletTouch } from "../ui/screen.ts";
import { createSlotPool, paintText, type SlotPool } from "../ui/slots.ts";
import { ellipsize, FONT, toAscii, wrap } from "../ui/text.ts";
import type { Press, Target } from "../ui/touch.ts";
import { SegmentFill } from "../ui/segments.tsx";
import { SearchField } from "../ui/field.tsx";
import { ART_LARGE, ART_ROW, clockText, dateText, lengthText, type Episode, type PodcastClient, type Show as PodcastShow } from "./api.ts";
import type { PodcastModel, Tab } from "./model.ts";
import type { Playback } from "./playback.ts";
import { yourComputer } from "../ui/companion.ts";

/** The player's prompt to act: the confirm button on a 3DS's small layout
 *  and on a screen with no touch, a tap on a touch surface. */
const retry = (action: string) => (COMPACT || !appletTouch() ? `A to ${action}` : `Tap to ${action}`);

const OVERSCAN = 128;
/** A show row: its artwork at ART_ROW, drawn at half size. */
const SHOW_ROW_H = 72;
const SHOW_ART = 64;
const SHOW_TEXT_X = 84;
/** An episode row: a two-line title and a line of date and length. */
const EPISODE_ROW_H = 58;
const TITLE_LINE = 16;
/** The Now Playing mark at the right of an episode's meta line. */
const MARK_W = 74;
const MARK_H = 15;

/** On a surface larger than the 3DS's, the bar keeps room for a Reload
 *  button right of the segmented control. */
const RELOAD: NavButton = { id: "list.reload", label: "Reload", kind: "plain", run: () => {} };

export interface PodcastEnv {
  model: PodcastModel;
  client: PodcastClient;
  playback: Playback;
  press: Press;
  keys: Accessor<boolean>;
  /** The keyboard's text with its caret while it is open, else null. */
  draft: Accessor<string | null>;
}

// ---- the segmented control -------------------------------------------------------

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "library", label: "Library" },
  { id: "search", label: "Search" },
];
const SEG_X = 8;

// Sized to the surface by fitSurface(), which each page calls first.
let W = 320;
let VIEW_H = 204;
let SEG_W = 0;

function fitSurface(): void {
  W = SCREEN_W;
  VIEW_H = viewHeight();
  SEG_W = Math.min(120, (W - SEG_X * 2 - (COMPACT ? 0 : barButtonWidth(RELOAD) + 10)) / TABS.length);
}

export function segmentTargets(env: PodcastEnv): Target[] {
  return TABS.map((tab, index) => ({
    id: `tab.${tab.id}`,
    x: SEG_X + index * SEG_W,
    y: 0,
    w: SEG_W,
    h: 36,
    run: () => env.model.setTab(tab.id),
  }));
}

function Segments(props: { env: PodcastEnv }) {
  const { model, press } = props.env;
  return (
    <>
      <View class="absolute left-[8] top-[5] h-[26] rounded-[5] border border-[#000000] bg-gradient-to-b from-[#5a5a5a] via-[#2e2e2e] to-[#1c1c1c]" style={{ width: SEG_W * TABS.length }} />
      <For each={TABS}>
        {(tab, index) => (
          <>
            <Show when={model.tab() === tab.id || press.is(`tab.${tab.id}`)}>
              <SegmentFill x={SEG_X + 1 + index() * SEG_W} y={6} w={SEG_W - 1} h={24} first={index() === 0} last={index() === TABS.length - 1} class="absolute bg-gradient-to-b from-[#7a35a6] via-[#9449c4] to-[#a95bdc]" />
            </Show>
            <Show when={index() > 0}>
              <View class="absolute top-[6] w-[1] h-[24] bg-[#000000]" style={{ insetL: SEG_X + index() * SEG_W }} />
            </Show>
            <Text class="absolute top-[12] text-xs text-white font-bold text-center" style={{ insetL: SEG_X + index() * SEG_W, width: SEG_W }}>{tab.label}</Text>
          </>
        )}
      </For>
    </>
  );
}

// ---- rows ---------------------------------------------------------------------------

export interface ShowRow {
  show: PodcastShow;
  key: string;
  title: string;
  meta: string;
  y: number;
  h: number;
}

const showRowCache = new Map<string, ShowRow>();

function showRows(shows: readonly PodcastShow[], top: number): ShowRow[] {
  const textW = W - SHOW_TEXT_X - 10;
  return shows.map((show, index) => {
    const y = top + index * SHOW_ROW_H;
    const cached = showRowCache.get(show.feedUrl);
    if (cached && cached.y === y && cached.show === show) return cached;
    const row: ShowRow = {
      show,
      key: `show.${show.feedUrl}`,
      title: wrap(toAscii(show.title), FONT.smBold, textW, 2).join("\n"),
      meta: ellipsize(toAscii(show.author), FONT.xs, textW),
      y,
      h: SHOW_ROW_H,
    };
    if (showRowCache.size > 400) showRowCache.clear();
    showRowCache.set(show.feedUrl, row);
    return row;
  });
}

export interface EpisodeRow {
  episode: Episode;
  key: string;
  title: string;
  meta: string;
  y: number;
  h: number;
}

const episodeRowCache = new Map<string, EpisodeRow>();

function episodeRows(episodes: readonly Episode[], top: number, now: number): EpisodeRow[] {
  const textW = W - 20;
  return episodes.map((episode, index) => {
    const y = top + index * EPISODE_ROW_H;
    const cached = episodeRowCache.get(episode.audioUrl);
    if (cached && cached.y === y && cached.episode === episode) return cached;
    const row: EpisodeRow = {
      episode,
      key: `episode.${episode.audioUrl}`,
      title: wrap(toAscii(episode.title), FONT.smBold, textW, 2).join("\n"),
      meta: ellipsize([dateText(episode.published, now), lengthText(episode.durationS)].filter(Boolean).join("  "), FONT.xs, textW - MARK_W - 8),
      y,
      h: EPISODE_ROW_H,
    };
    if (episodeRowCache.size > 400) episodeRowCache.clear();
    episodeRowCache.set(episode.audioUrl, row);
    return row;
  });
}

/** One slot of a show list's pool: its nodes mount once and the painter
 *  moves it, rewrites its texts and binds its artwork for each new row. */
function ShowSlot(props: { env: PodcastEnv; pool: SlotPool<ShowRow>; slot: number; lit: (key: string) => boolean }) {
  let box!: NodeMirror;
  let wash!: NodeMirror;
  let image!: NodeMirror;
  let title!: NodeMirror;
  let meta!: NodeMirror;
  const [key, setKey] = createSignal("");
  const [artUrl, setArtUrl] = createSignal("");
  const lit = createMemo(() => key() !== "" && props.lit(key()));
  let y = -1;
  createEffect(() => {
    const on = lit();
    jump(wash, "opacity", on ? 1 : 0);
    jump(title, "textColor", on ? "#ffffff" : "#111111");
    jump(meta, "textColor", on ? "#ecdcff" : "#8a9099");
  });
  // Artwork that arrives after its row was painted binds then.
  createEffect(() => {
    props.env.client.arts();
    const url = artUrl();
    getOps().setImage(image.id, url ? props.env.client.art(url, ART_ROW) : -1);
  });
  onMount(() => {
    props.pool.attach(props.slot, (row) => batch(() => {
      if (!row) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        for (const text of [title, meta]) paintText(text, "");
        setKey("");
        setArtUrl("");
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (row.y !== y) jump(box, "translateY", (y = row.y));
      paintText(title, row.title);
      paintText(meta, row.meta);
      props.env.client.want(row.show.artwork, ART_ROW);
      setKey(row.key);
      setArtUrl(row.show.artwork);
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 opacity-0 contain-strict" style={{ width: W, height: SHOW_ROW_H }}>
      <View ref={wash} class="absolute inset-0 opacity-0 bg-gradient-to-b from-[#a95bdc] to-[#7a35a6]" />
      <View class="absolute right-0 bottom-0 h-[1] bg-[#e0e0e0]" style={{ insetL: SHOW_TEXT_X }} />
      <View class="absolute left-[10] top-[4] rounded-[6] bg-[#e6e6ea]" style={{ width: SHOW_ART, height: SHOW_ART }} />
      <Image ref={image} class="absolute left-[10] top-[4] rounded-[6]" style={{ width: SHOW_ART, height: SHOW_ART }} />
      <View class="absolute top-[14] flex-col" style={{ insetL: SHOW_TEXT_X }}>
        <Text ref={title} class="text-sm text-[#111111] font-bold leading-[16]">{" "}</Text>
        <Text ref={meta} class="mt-[3] text-xs text-[#8a9099]">{" "}</Text>
      </View>
    </View>
  );
}

/** One slot of an episode list's pool; the Now Playing mark follows the
 *  player's episode. */
function EpisodeSlot(props: { env: PodcastEnv; pool: SlotPool<EpisodeRow>; slot: number; lit: (key: string) => boolean }) {
  let box!: NodeMirror;
  let wash!: NodeMirror;
  let title!: NodeMirror;
  let meta!: NodeMirror;
  const [key, setKey] = createSignal("");
  const [audioUrl, setAudioUrl] = createSignal("");
  const lit = createMemo(() => key() !== "" && props.lit(key()));
  const playing = createMemo(() => key() !== "" && props.env.playback.now()?.episode.audioUrl === audioUrl());
  const mark = () => (props.env.playback.phase() === "paused" ? "Paused" : "Now Playing");
  let y = -1;
  createEffect(() => {
    const on = lit();
    jump(wash, "opacity", on ? 1 : 0);
    jump(title, "textColor", on ? "#ffffff" : "#111111");
    jump(meta, "textColor", on ? "#ecdcff" : "#8a9099");
  });
  onMount(() => {
    props.pool.attach(props.slot, (row) => batch(() => {
      if (!row) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        for (const text of [title, meta]) paintText(text, "");
        setKey("");
        setAudioUrl("");
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (row.y !== y) jump(box, "translateY", (y = row.y));
      paintText(title, row.title);
      paintText(meta, row.meta);
      setKey(row.key);
      setAudioUrl(row.episode.audioUrl);
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 opacity-0 contain-strict" style={{ width: W, height: EPISODE_ROW_H }}>
      <View ref={wash} class="absolute inset-0 opacity-0 bg-gradient-to-b from-[#a95bdc] to-[#7a35a6]" />
      <View class="absolute left-[10] right-0 bottom-0 h-[1] bg-[#e0e0e0]" />
      <View class="absolute left-[10] top-[6] flex-col">
        <Text ref={title} class="text-sm text-[#111111] font-bold leading-[16]">{" "}</Text>
        <Text ref={meta} class="mt-[3] text-xs text-[#8a9099]">{" "}</Text>
      </View>
      <Show when={playing()}>
        <View class={lit() ? "absolute rounded-[7] bg-[#ffffff]" : "absolute rounded-[7] bg-[#9449c4]"} style={{ insetL: W - 10 - MARK_W, insetT: 40, width: MARK_W, height: MARK_H }} />
        <Text class={lit() ? "absolute text-2xs text-[#7a35a6] font-bold text-center" : "absolute text-2xs text-white font-bold text-center"} style={{ insetL: W - 10 - MARK_W, insetT: 42, width: MARK_W }}>{mark()}</Text>
      </Show>
    </View>
  );
}

function Centered(props: { title: string; detail: string; spinner?: boolean; button?: { id: string; label: string }; press: Press; top?: number }) {
  const lines = () => wrap(props.detail, FONT.xs, 260, 4);
  const top = () => props.top ?? 0;
  return (
    <>
      <Show when={props.spinner}>
        <View class="absolute" style={{ insetL: W / 2 - 11, insetT: top() + 40 }}>
          <ClassicSpinner size={22} color={"#8a9099"} />
        </View>
      </Show>
      <Text class="absolute left-0 text-base text-[#4c566c] font-bold text-center" style={{ insetT: top() + 74, width: W }}>{props.title}</Text>
      <For each={lines()}>
        {(line, index) => <Text class="absolute w-[260] text-xs text-[#6d7584] text-center" style={{ insetL: (W - 260) / 2, insetT: top() + 98 + index() * 15 }}>{line}</Text>}
      </For>
      <Show when={props.button}>
        {(button) => (
          <>
            <View
              class={props.press.is(button().id)
                ? "absolute w-[120] h-[30] rounded-[6] border border-[#6f7680] bg-gradient-to-b from-[#9aa1ab] to-[#bfc5cc]"
                : "absolute w-[120] h-[30] rounded-[6] border border-[#9aa1aa] bg-gradient-to-b from-[#ffffff] to-[#dde1e6]"}
              style={{ insetL: (W - 120) / 2, insetT: top() + 160 }}
            />
            <Text class="absolute w-[120] text-sm text-[#7a35a6] font-bold text-center" style={{ insetL: (W - 120) / 2, insetT: top() + 167 }}>{button().label}</Text>
          </>
        )}
      </Show>
    </>
  );
}

/** The bar's button to the player while an episode plays. */
function playingButton(env: PodcastEnv, stack: NavStack): NavButton | null {
  return env.playback.now() ? { id: "nav.playing", label: "Playing", kind: "done", run: () => stack.push("player") } : null;
}

/** The search field drawn at the top of the Search tab's content. */
const SEARCH_H = 40;

// ---- the library and the search ----------------------------------------------------

export function listPage(env: PodcastEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press } = env;
  const searching = () => model.tab() === "search";
  const top = () => (searching() ? SEARCH_H : 0);
  const shows = () => (searching() ? model.search().items : model.library().subscriptions);
  const rows = createMemo(() => showRows(shows(), top()));
  const listed = () => (searching() ? model.search().status === "ready" : model.libraryStatus() === "ready") && shows().length > 0;
  const pool = createSlotPool(() => (listed() ? rows() : []), layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: SHOW_ROW_H });
  const pressedKey = createMemo(() => press.id());
  const focusedKey = createMemo(() => (env.keys() ? layer.focus() : ""));
  const lit = (key: string) => key === pressedKey() || key === focusedKey();
  const byKey = createMemo(() => new Map(rows().map((row) => [row.key, row])));
  const open = (row: ShowRow) => {
    model.openShow(row.show);
    stack.push("show");
  };
  const reload = () => (searching() ? model.reloadSearch() : model.loadLibrary());
  const step = (by: number) => {
    const at = TABS.findIndex((tab) => tab.id === model.tab());
    model.setTab(TABS[(at + by + TABS.length) % TABS.length]!.id);
  };
  const height = () => top() + (listed() ? rows().length * SHOW_ROW_H : VIEW_H);
  const error = () => (searching() ? model.search().error : model.libraryError());

  const content: PageContent = {
    view: () => (
      <>
        <Show when={searching()}>
          <SearchField id="search.field" x={8} y={8} w={W - 16} h={26} press={press} draft={env.draft} value={model.query} placeholder="Search Podcasts" />
        </Show>
        <For each={pool.slots}>{(slot) => <ShowSlot env={env} pool={pool} slot={slot} lit={lit} />}</For>
        <Show when={!listed()}>
          {error()
            ? <Centered title={error()!.title} detail={error()!.detail} button={{ id: "list.retry", label: "Try Again" }} press={press} top={top()} />
            : searching()
              ? model.search().status === "idle"
                ? <Centered title="Search Podcasts" detail={appletTouch() ? "Tap the field above and type a show's name." : "Press A on the field above and type a show's name."} press={press} top={top()} />
                : model.search().status === "ready"
                  ? <Centered title="No Shows" detail="Nothing came back for these words." press={press} top={top()} />
                  : <Centered title="Searching" detail={`Asking the iTunes directory through ${yourComputer()}.`} spinner press={press} top={top()} />
              : model.libraryStatus() === "ready"
                ? <Centered title="No Subscriptions" detail="Search for a show and subscribe to it; it is listed here." press={press} top={top()} />
                : <Centered title="Loading" detail={`Reading the library kept on ${yourComputer()}.`} spinner press={press} top={top()} />}
        </Show>
      </>
    ),
    height,
    focusOrder: () => rows().map((row) => row.key),
    targets(contentTop, offset, bottom) {
      const out: Target[] = [];
      if (searching()) out.push({ id: "search.field", x: 8, y: contentTop + 4 - offset, w: W - 16, h: 34, run: () => model.editQuery() });
      if (error()) out.push({ id: "list.retry", x: (W - 120) / 2, y: contentTop + top() + 160 - offset, w: 120, h: 30, run: reload });
      if (!listed()) return out;
      for (const row of rows()) {
        const y = contentTop + row.y - offset;
        if (y + row.h <= contentTop || y >= bottom) continue;
        out.push({ id: row.key, x: 0, y, w: W, h: row.h, run: () => open(row) });
      }
      return out;
    },
    span(id) {
      const row = byKey().get(id);
      return row ? [row.y, row.y + row.h] : null;
    },
    activate(id) {
      const row = byKey().get(id);
      if (row) open(row);
      else if (id === "list.retry") reload();
      else if (id === "search.field") model.editQuery();
    },
  };

  return {
    title: () => "Podcasts",
    backLabel: "Podcasts",
    tint: "black",
    bare: "white",
    titleView: () => <Segments env={env} />,
    right: COMPACT ? undefined : () => playingButton(env, stack) ?? { ...RELOAD, run: reload },
    fixedTargets: () => segmentTargets(env),
    content,
    legend: () => [
      { button: "lr", label: "Tab" },
      { button: "triangle", label: "Reload" },
      ...(searching() ? [{ button: "square" as const, label: "Search" }] : []),
      ...(env.playback.now() ? [{ button: "start" as const, label: "Playing" }] : []),
    ],
    key(pressed) {
      if (pressed & BTN.LTRIGGER) step(-1);
      else if (pressed & BTN.RTRIGGER) step(1);
      else if (pressed & BTN.TRIANGLE) reload();
      else if (pressed & BTN.SQUARE && searching()) model.editQuery();
      else if (pressed & BTN.START && env.playback.now()) stack.push("player");
      else if (pressed & BTN.CIRCLE && error()) reload();
      else return false;
      return true;
    },
  };
}

// ---- a show ---------------------------------------------------------------------------

/** The show's header over its episodes: artwork at the left, the title,
 *  the author and the Subscribe button beside it. */
const SUBSCRIBE_W = 104;
const SUBSCRIBE_H = 24;
/** The show's head: the artwork, two title lines, the author, the count and
 *  the Subscribe button under them; sized to the surface by fitSurface(). */
let HEAD_ART = 112;
let HEAD_TEXT_X = 134;
let SUBSCRIBE_Y = 94;
let HEAD_H = 132;

function fitHead(): void {
  HEAD_ART = COMPACT ? 80 : 112;
  HEAD_TEXT_X = 10 + HEAD_ART + 12;
  // under the count line (at 70, 12 px type), and never above the artwork's foot
  SUBSCRIBE_Y = Math.max(70 + 14 + 8, 10 + HEAD_ART - SUBSCRIBE_H);
  HEAD_H = Math.max(10 + HEAD_ART, SUBSCRIBE_Y + SUBSCRIBE_H) + 10;
}

export function showPage(env: PodcastEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  fitHead();
  const { model, client, playback, press } = env;
  const show = model.show();
  const feed = () => model.showState().feed;
  const now = companionNow();
  const rows = createMemo(() => episodeRows(feed()?.episodes ?? [], HEAD_H, now));
  const listed = () => model.showState().status === "ready" && rows().length > 0;
  const pool = createSlotPool(() => (listed() ? rows() : []), layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: EPISODE_ROW_H });
  const pressedKey = createMemo(() => press.id());
  const focusedKey = createMemo(() => (env.keys() ? layer.focus() : ""));
  const lit = (key: string) => key === pressedKey() || key === focusedKey();
  const byKey = createMemo(() => new Map(rows().map((row) => [row.key, row])));
  const textW = W - HEAD_TEXT_X - 10;
  const title = () => wrap(toAscii(feed()?.title || show?.title || "Podcast"), FONT.baseBold, textW, 2);
  const author = () => ellipsize(toAscii(feed()?.author || show?.author || ""), FONT.xs, textW);
  const count = () => {
    const n = feed()?.episodes.length ?? 0;
    return model.showState().status === "ready" ? `${n} ${n === 1 ? "episode" : "episodes"}` : "";
  };
  const subscribed = () => (show ? model.subscribed(show.feedUrl) : false);
  const artUrl = () => feed()?.artwork || show?.artwork || "";
  let art!: NodeMirror;
  createEffect(() => {
    client.arts();
    const url = artUrl();
    if (url) client.want(url, ART_LARGE);
    getOps().setImage(art.id, url ? client.art(url, ART_LARGE) : -1);
  });
  const open = (row: EpisodeRow) => {
    if (!show) return;
    if (playback.now()?.episode.audioUrl !== row.episode.audioUrl) playback.start({ show: { ...show, title: feed()?.title || show.title, artwork: artUrl() }, episode: row.episode });
    stack.push("player");
  };
  const toggleSubscription = () => {
    if (show) model.toggleSubscription(show);
  };
  const height = () => HEAD_H + (listed() ? rows().length * EPISODE_ROW_H : VIEW_H - HEAD_H);
  const subscribeY = SUBSCRIBE_Y;

  const content: PageContent = {
    view: () => (
      <>
        <View class="absolute left-[10] top-[10] rounded-[8] bg-[#e6e6ea]" style={{ width: HEAD_ART, height: HEAD_ART }} />
        <Image ref={art} class="absolute left-[10] top-[10] rounded-[8]" style={{ width: HEAD_ART, height: HEAD_ART }} />
        <For each={title()}>
          {(line, index) => <Text class="absolute text-base text-[#111111] font-bold" style={{ insetL: HEAD_TEXT_X, insetT: 10 + index() * 20, width: textW }}>{line}</Text>}
        </For>
        <Text class="absolute text-xs text-[#8a9099]" style={{ insetL: HEAD_TEXT_X, insetT: 54, width: textW }}>{author()}</Text>
        <Text class="absolute text-xs text-[#8a9099]" style={{ insetL: HEAD_TEXT_X, insetT: 70, width: textW }}>{count()}</Text>
        <View
          class={subscribed()
            ? press.is("show.subscribe")
              ? "absolute rounded-[6] border border-[#6f7680] bg-gradient-to-b from-[#9aa1ab] to-[#bfc5cc]"
              : "absolute rounded-[6] border border-[#a2a8b0] bg-gradient-to-b from-[#fdfdfd] to-[#dfe2e6]"
            : press.is("show.subscribe")
              ? "absolute rounded-[6] border border-[#4e1f6e] bg-gradient-to-b from-[#6b2d94] to-[#52207a]"
              : "absolute rounded-[6] border border-[#5e2a85] bg-gradient-to-b from-[#b56ae6] via-[#9449c4] to-[#7a35a6]"}
          style={{ insetL: HEAD_TEXT_X, insetT: subscribeY, width: SUBSCRIBE_W, height: SUBSCRIBE_H }}
        />
        <Text
          class={subscribed() ? "absolute text-xs text-[#4a5262] font-bold text-center" : "absolute text-xs text-white font-bold text-center"}
          style={{ insetL: HEAD_TEXT_X, insetT: subscribeY + 5, width: SUBSCRIBE_W }}
        >
          {subscribed() ? "Unsubscribe" : "Subscribe"}
        </Text>
        <View class="absolute left-0 h-[1] bg-[#e0e0e0]" style={{ insetT: HEAD_H - 1, width: W }} />
        <For each={pool.slots}>{(slot) => <EpisodeSlot env={env} pool={pool} slot={slot} lit={lit} />}</For>
        <Show when={!listed()}>
          {model.showState().status === "error"
            ? <Centered title={model.showState().error!.title} detail={model.showState().error!.detail} button={{ id: "show.retry", label: "Try Again" }} press={press} top={HEAD_H} />
            : model.showState().status === "ready"
              ? <Centered title="No Episodes" detail="The feed lists no episodes with audio." press={press} top={HEAD_H} />
              : <Centered title="Loading" detail={`Reading the feed through ${yourComputer()}.`} spinner press={press} top={HEAD_H} />}
        </Show>
      </>
    ),
    height,
    focusOrder: () => ["show.subscribe", ...rows().map((row) => row.key)],
    targets(contentTop, offset, bottom) {
      const out: Target[] = [{ id: "show.subscribe", x: HEAD_TEXT_X, y: contentTop + subscribeY - offset, w: SUBSCRIBE_W, h: SUBSCRIBE_H, run: toggleSubscription }];
      if (model.showState().status === "error") out.push({ id: "show.retry", x: (W - 120) / 2, y: contentTop + HEAD_H + 160 - offset, w: 120, h: 30, run: () => model.reloadShow() });
      if (!listed()) return out;
      for (const row of rows()) {
        const y = contentTop + row.y - offset;
        if (y + row.h <= contentTop || y >= bottom) continue;
        out.push({ id: row.key, x: 0, y, w: W, h: row.h, run: () => open(row) });
      }
      return out;
    },
    span(id) {
      if (id === "show.subscribe") return [subscribeY, subscribeY + SUBSCRIBE_H];
      const row = byKey().get(id);
      return row ? [row.y, row.y + row.h] : null;
    },
    activate(id) {
      const row = byKey().get(id);
      if (row) open(row);
      else if (id === "show.subscribe") toggleSubscription();
      else if (id === "show.retry") model.reloadShow();
    },
  };

  return {
    title: () => ellipsize(toAscii(feed()?.title || show?.title || "Podcast"), FONT.baseBold, W - 150),
    backLabel: "Show",
    tint: "black",
    bare: "white",
    right: () => playingButton(env, stack),
    content,
    legend: () => [
      { button: "triangle", label: "Reload" },
      { button: "square", label: subscribed() ? "Unsubscribe" : "Subscribe" },
      ...(env.playback.now() ? [{ button: "start" as const, label: "Playing" }] : []),
    ],
    key(pressed) {
      if (pressed & BTN.TRIANGLE) model.reloadShow();
      else if (pressed & BTN.SQUARE) toggleSubscription();
      else if (pressed & BTN.START && playback.now()) stack.push("player");
      else if (pressed & BTN.CIRCLE && model.showState().status === "error") model.reloadShow();
      else return false;
      return true;
    },
  };
}

// ---- the player ------------------------------------------------------------------------

const SKIP_S = 30;
const TRACK_H = 4;
/** The control row: skip back, play, skip forward in the middle; the
 *  volume at the right end. */
const BUTTON_W = 68;
const BUTTON_H = 34;
const BUTTON_GAP = 14;
const VOLUME_W = 34;

/** The artwork, the texts, the track and the controls by size class:
 *  side by side on the 3DS's 320x240, stacked and centred elsewhere, the
 *  artwork up to its 256 px texture. */
function playerGeometry() {
  if (COMPACT) {
    return { artSize: 96, artX: 12, artY: NAV_H + 12, titleX: 120, titleW: SCREEN_W - 132, titleY: NAV_H + 14, showY: NAV_H + 56, trackX: 16, trackW: SCREEN_W - 32, trackY: NAV_H + 122, controlsY: NAV_H + 154, centered: false };
  }
  const artSize = Math.max(96, Math.min(ART_LARGE, SCREEN_W - 48, SCREEN_H - NAV_H - 196));
  const artY = NAV_H + 14;
  const titleY = artY + artSize + 12;
  const showY = titleY + 42;
  const trackY = showY + 30;
  return { artSize, artX: Math.round((SCREEN_W - artSize) / 2), artY, titleX: 20, titleW: SCREEN_W - 40, titleY, showY, trackX: 24, trackW: SCREEN_W - 48, trackY, controlsY: trackY + 34, centered: true };
}

/** What a test or the agent reads about playback. */
export interface PlayerProbe {
  phase: string;
  positionS: number;
  durationS: number;
  episode: string;
}

export function playerPage(env: PodcastEnv, stack: NavStack): PageSpec {
  fitSurface();
  const g = playerGeometry();
  const { playback, client, press } = env;
  const playing = playback.now();
  const [volumeShown, setVolumeShown] = createSignal(0);
  const [preview, setPreview] = createSignal(-1);
  let art!: NodeMirror;
  const artUrl = () => playing?.show.artwork || "";
  createEffect(() => {
    client.arts();
    const url = artUrl();
    if (url) client.want(url, ART_LARGE);
    getOps().setImage(art.id, url ? client.art(url, ART_LARGE) : -1);
  });

  const duration = () => playback.duration() || playing?.episode.durationS || 0;
  const shown = () => (preview() >= 0 ? preview() : playback.position());
  const fraction = () => (duration() > 0 ? Math.max(0, Math.min(1, shown() / duration())) : 0);
  const elapsed = () => clockText(shown());
  const remaining = () => (duration() > 0 ? `-${clockText(Math.max(0, duration() - shown()))}` : "--:--");
  const titleLines = () => wrap(toAscii(playing?.episode.title ?? "Nothing Playing"), g.centered ? FONT.baseBold : FONT.smBold, g.titleW, 2);
  const showLine = () => ellipsize(toAscii(playing?.show.title ?? ""), FONT.xs, g.titleW);
  const busy = () => playback.phase() === "starting" || playback.phase() === "buffering";
  const errorLines = () => wrap(toAscii(playback.error()), FONT.xs, Math.min(280, W - 40), 3);
  const scrubber = createMediaScrubber((seconds) => playback.seek(seconds));
  const nudgeVolume = (by: number) => {
    playback.nudgeVolume(by);
    setVolumeShown(90);
  };
  const toggle = () => playback.toggle();

  onFrame(() => {
    if (volumeShown() > 0) setVolumeShown(volumeShown() - 1);
    (globalThis as { __pocketPodcasts?: PlayerProbe }).__pocketPodcasts = { phase: playback.phase(), positionS: playback.position(), durationS: duration(), episode: playing?.episode.audioUrl ?? "" };
  });
  onCleanup(() => scrubber.cancel());

  const trackFraction = (x: number) => (x - g.trackX) / g.trackW;
  // The track scrubs: down previews, a slide moves the preview, the release
  // seeks once (createMediaScrubber). The router gets the same contact and
  // finds no target there.
  let scrubbing = false;
  createGesture({
    surface: appletSurfaceId(),
    onDown(contact) {
      scrubbing = stack.top()?.page === "player" && !stack.busy() && duration() > 0 && playback.phase() !== "error" && playback.phase() !== "idle"
        && contact.x >= g.trackX - 8 && contact.x < g.trackX + g.trackW + 8 && contact.y >= g.trackY - 12 && contact.y < g.trackY + 16;
      if (!scrubbing) return;
      scrubber.begin(trackFraction(contact.x), duration());
      setPreview(scrubber.preview());
    },
    onMove(contact) {
      if (!scrubbing) return;
      scrubber.move(trackFraction(contact.x), duration());
      setPreview(scrubber.preview());
    },
    onUp() {
      if (!scrubbing) return;
      scrubbing = false;
      setPreview(-1);
      scrubber.commit();
    },
    onCancel() {
      scrubbing = false;
      setPreview(-1);
      scrubber.cancel();
    },
  });

  const controlsX = Math.round((W - (3 * BUTTON_W + 2 * BUTTON_GAP)) / 2);
  const controls = [
    { id: "player.back", label: `-${SKIP_S}`, x: controlsX, run: () => playback.skip(-SKIP_S) },
    { id: "player.toggle", label: "", x: controlsX + BUTTON_W + BUTTON_GAP, run: toggle },
    { id: "player.forward", label: `+${SKIP_S}`, x: controlsX + 2 * (BUTTON_W + BUTTON_GAP), run: () => playback.skip(SKIP_S) },
  ];
  const volumeButtons = [
    { id: "player.quieter", label: "-", x: W - 8 - 2 * VOLUME_W, run: () => nudgeVolume(-0.1) },
    { id: "player.louder", label: "+", x: W - 8 - VOLUME_W, run: () => nudgeVolume(0.1) },
  ];
  const toggleLabel = () => {
    const p = playback.phase();
    return p === "playing" || p === "buffering" || p === "starting" ? "Pause" : p === "ended" ? "Again" : "Play";
  };
  const label = (button: { id: string; label: string }) => (button.id === "player.toggle" ? toggleLabel() : button.label);

  return {
    title: () => ellipsize(toAscii(playing?.show.title ?? "Podcasts"), FONT.baseBold, W - 120),
    tint: "black",
    bare: true,
    fixed: () => (
      <>
        <View class="absolute left-0 top-0 bg-gradient-to-b from-[#241b33] to-[#140f1c]" style={{ width: W, height: SCREEN_H }} />
        <View class="absolute rounded-[10] bg-[#3a2d4d]" style={{ insetL: g.artX, insetT: g.artY, width: g.artSize, height: g.artSize }} />
        <Image ref={art} class="absolute rounded-[10]" style={{ insetL: g.artX, insetT: g.artY, width: g.artSize, height: g.artSize }} />
        <Show when={busy()}>
          <View class="absolute rounded-[10] bg-[#00000080]" style={{ insetL: g.artX, insetT: g.artY, width: g.artSize, height: g.artSize }} />
          <View class="absolute" style={{ insetL: g.artX + g.artSize / 2 - 11, insetT: g.artY + g.artSize / 2 - 11 }}>
            <ClassicSpinner size={22} color={"#ffffff"} />
          </View>
        </Show>
        <Show when={playback.phase() === "ended" || playback.phase() === "error"}>
          <View class="absolute rounded-[10] bg-[#00000080]" style={{ insetL: g.artX, insetT: g.artY, width: g.artSize, height: g.artSize }} />
          <Text class="absolute text-xs text-white font-bold text-center" style={{ insetL: g.artX, insetT: g.artY + g.artSize / 2 - 7, width: g.artSize }}>
            {playback.phase() === "ended" ? retry("play again") : retry("try again")}
          </Text>
        </Show>
        <Show when={volumeShown() > 0}>
          <View class="absolute w-[100] h-[24] rounded-[12] bg-[#000000b0]" style={{ insetL: g.artX + g.artSize / 2 - 50, insetT: g.artY + 8 }} />
          <View class="absolute h-[6] rounded-[3] bg-[#ffffff]" style={{ insetL: g.artX + g.artSize / 2 - 40, insetT: g.artY + 17, width: Math.max(2, playback.volume() * 80) }} />
        </Show>
        <For each={titleLines()}>
          {(line, index) => (
            <Text
              class={g.centered ? "absolute text-base text-white font-bold text-center" : "absolute text-sm text-white font-bold"}
              style={{ insetL: g.titleX, insetT: g.titleY + index() * (g.centered ? 20 : 17), width: g.titleW }}
            >
              {line}
            </Text>
          )}
        </For>
        <Text class={g.centered ? "absolute text-xs text-[#b9a9d1] text-center" : "absolute text-xs text-[#b9a9d1]"} style={{ insetL: g.titleX, insetT: g.showY, width: g.titleW }}>{showLine()}</Text>
        <Show when={playback.phase() === "error"}>
          <For each={errorLines()}>
            {(line, index) => (
              <Text class={g.centered ? "absolute text-xs text-[#ff9b9b] text-center" : "absolute text-xs text-[#ff9b9b]"} style={{ insetL: g.titleX, insetT: g.showY + 16 + index() * 14, width: g.titleW }}>{line}</Text>
            )}
          </For>
        </Show>
        <View class="absolute rounded-[2] bg-[#4a3d60]" style={{ insetL: g.trackX, insetT: g.trackY, width: g.trackW, height: TRACK_H }} />
        <View class="absolute rounded-[2] bg-[#b56ae6]" style={{ insetL: g.trackX, insetT: g.trackY, width: Math.round(g.trackW * fraction()), height: TRACK_H }} />
        <View class="absolute w-[12] h-[12] rounded-[6] bg-[#ffffff]" style={{ insetL: g.trackX + Math.round(g.trackW * fraction()) - 6, insetT: g.trackY - 4 }} />
        <Text class="absolute text-xs text-[#d8cbe8]" style={{ insetL: g.trackX, insetT: g.trackY + 9, width: 80 }}>{elapsed()}</Text>
        <Text class="absolute text-xs text-[#d8cbe8] text-right" style={{ insetL: g.trackX + g.trackW - 80, insetT: g.trackY + 9, width: 80 }}>{remaining()}</Text>
        <For each={controls}>
          {(button) => (
            <>
              <View
                class={press.is(button.id) ? "absolute rounded-[17] bg-[#ffffff40]" : "absolute rounded-[17] bg-[#ffffff1a]"}
                style={{ insetL: button.x, insetT: g.controlsY, width: BUTTON_W, height: BUTTON_H }}
              />
              <Text class="absolute text-sm text-white font-bold text-center" style={{ insetL: button.x, insetT: g.controlsY + 9, width: BUTTON_W }}>{label(button)}</Text>
            </>
          )}
        </For>
        <For each={volumeButtons}>
          {(button) => (
            <>
              <View
                class={press.is(button.id) ? "absolute rounded-[8] bg-[#ffffff40]" : "absolute rounded-[8] bg-[#ffffff1a]"}
                style={{ insetL: button.x, insetT: g.controlsY + 2, width: VOLUME_W - 4, height: BUTTON_H - 4 }}
              />
              <Text class="absolute text-sm text-white font-bold text-center" style={{ insetL: button.x, insetT: g.controlsY + 9, width: VOLUME_W - 4 }}>{button.label}</Text>
            </>
          )}
        </For>
        <Show when={!playback.available}>
          <Text class="absolute text-xs text-[#ff9b9b] text-center" style={{ insetL: 20, insetT: g.showY + 16, width: W - 40 }}>This host has no media player.</Text>
        </Show>
      </>
    ),
    fixedTargets: () => [
      { id: "player.art", x: g.artX, y: g.artY, w: g.artSize, h: g.artSize, run: toggle },
      ...controls.map((button) => ({ id: button.id, x: button.x, y: g.controlsY, w: BUTTON_W, h: BUTTON_H, run: button.run })),
      ...volumeButtons.map((button) => ({ id: button.id, x: button.x, y: g.controlsY, w: VOLUME_W, h: BUTTON_H, run: button.run })),
    ],
    legend: () => [
      { button: "circle", label: toggleLabel() },
      { button: "dpad-h", label: "Skip" },
      { button: "dpad-v", label: "Volume" },
    ],
    key(pressed) {
      if (pressed & BTN.CIRCLE) toggle();
      else if (pressed & BTN.LEFT) playback.skip(-SKIP_S);
      else if (pressed & BTN.RIGHT) playback.skip(SKIP_S);
      else if (pressed & BTN.UP) nudgeVolume(0.1);
      else if (pressed & BTN.DOWN) nudgeVolume(-0.1);
      else return false;
      return true;
    },
  };
}
