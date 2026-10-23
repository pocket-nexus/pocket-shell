// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/discord/views.tsx — the pages of Discord, all on the touch
// screen, in Discord's dark theme under a black bar: the bot's servers, a
// server's text channels under their categories, and a channel's messages
// with the newest at the bottom. Rows have measured heights and are placed
// by offset; a fixed pool of slots draws the ones near the visible band
// (ui/slots.ts), as in Hacker News.
//
// Server, channel and author names and message text in any script draw from
// font atlases the Mac renders (ui/glyphs.ts); a row whose glyphs are not in
// yet draws folded to ASCII and is laid out again when they arrive. Page
// titles stay in the bar's baked face.

import { batch, createEffect, createMemo, createSignal, For, onMount, Show, untrack, type Accessor } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { Image, Text, View } from "@pocketjs/framework/components";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { getOps } from "@pocketjs/framework/host";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import { BTN } from "@pocketjs/framework/input";
import type { LayerContext, NavStack, PageContent, PageSpec } from "../ui/nav.tsx";
import { ellipsize, FONT, measure, toAscii, wrap } from "../ui/text.ts";
import { richText, type Glyphs } from "../ui/glyphs.ts";
import { createMeasuredList, createSlotPool, paintText, type MeasuredRow, type SlotPool } from "../ui/slots.ts";
import { showSkeleton, Skeleton } from "../ui/skeleton.tsx";
import type { Press, Target } from "../ui/touch.ts";
import type { Channel, Guild, Message } from "./api.ts";
import type { ChatState, DiscordModel, ListState } from "./model.ts";

const W = 320;
const VIEW_H = 204;
const OVERSCAN = 80;
const NO_ROWS: never[] = [];

/** Discord's dark theme. */
export const THEME = {
  chat: "#36393f",
  list: "#2f3136",
  text: "#dcddde",
  muted: "#8e9297",
  name: "#ffffff",
  rule: "#3f4248",
  blurple: "#5865f2",
  lit: "#4f545c",
};

/** Avatar colours for users without a picture, by user id. */
const INITIAL_COLORS = ["#5865f2", "#3ba55c", "#faa61a", "#ed4245", "#eb459e", "#747f8d"];

export interface DiscordEnv {
  model: DiscordModel;
  press: Press;
  keys: Accessor<boolean>;
  /** Open the composer for the open channel. */
  compose(): void;
  /** Runtime text in any script: regular and bold atlases from the Mac. */
  text: Glyphs;
  bold: Glyphs;
}

/** fontSlot (contracts/spec/spec.ts PROP.fontSlot), and the glyph slots. */
const PROP_FONT_SLOT = 97;
const RICH = 21;
const RICH_BOLD = 22;

function setSlot(node: NodeMirror, slot: number) {
  getOps().setProp(node.id, PROP_FONT_SLOT, slot);
}

/** `text` fitted to maxW: from `glyphs` when it covers the text, else folded
 *  to ASCII in the baked slot. */
function fitName(text: string, glyphs: Glyphs, baked: number, maxW: number): { text: string; rich: boolean } {
  if (glyphs.covers(text)) return { text: glyphs.ellipsize(richText(text), maxW), rich: true };
  return { text: ellipsize(toAscii(text), baked, maxW), rich: false };
}

function initialColor(id: string): string {
  let sum = 0;
  for (let index = 0; index < id.length; index++) sum = (sum * 31 + id.charCodeAt(index)) >>> 0;
  return INITIAL_COLORS[sum % INITIAL_COLORS.length]!;
}

/** A name's first Latin letter or digit; else, when the bold atlas holds it,
 *  its first character. */
function initialOf(name: string, bold: Glyphs | null): { text: string; rich: boolean } {
  const latin = toAscii(name).replace(/[^A-Za-z0-9]/g, "")[0];
  if (latin) return { text: latin.toUpperCase(), rich: false };
  const first = [...richText(name).trim()][0];
  if (first && bold?.covers(first)) return { text: first, rich: true };
  return { text: "?", rich: false };
}

/** Whether row `id` is lit: pressed, or focused by the d-pad. */
function highlight(env: DiscordEnv, layer: LayerContext, prefix: string): (id: string) => boolean {
  const idOf = (key: string) => (key.startsWith(prefix) ? key.slice(prefix.length) : "");
  const pressed = createMemo(() => idOf(env.press.id()));
  const focused = createMemo(() => (env.keys() ? idOf(layer.focus()) : ""));
  return (id) => id !== "" && (id === pressed() || id === focused());
}

/** Focus keys and rows by key for a layout, rebuilt when the layout changes. */
function keyIndex<R extends { key: string }>(rows: () => readonly R[]) {
  let built: readonly R[] | null = null;
  let order: string[] = [];
  let byKey = new Map<string, R>();
  return () => {
    const list = rows();
    if (list !== built) {
      built = list;
      order = list.filter((row) => row.key !== "").map((row) => row.key);
      byKey = new Map(list.filter((row) => row.key !== "").map((row) => [row.key, row]));
    }
    return { order, byKey };
  };
}

/** A picture slot: a round texture when there is one, else a coloured disc
 *  with the name's first letter. Painted, not bound (ui/slots.ts). */
interface Avatar {
  owner: string;
  hash: string | null;
  name: string;
  kind: "avatar" | "icon";
}

function createPicturePainter(model: DiscordModel, image: () => NodeMirror, disc: () => NodeMirror, letter: () => NodeMirror, bold: Glyphs | null = null) {
  let current: Avatar | null = null;
  let shown = -2;
  let letterRich = false;
  const repaint = () => {
    const handle = current ? model.picture(current.kind, current.owner, current.hash) : -1;
    if (handle === shown) return;
    shown = handle;
    if (handle >= 0) {
      getOps().setImage(image().id, handle);
      jump(image(), "opacity", 1);
      jump(disc(), "opacity", 0);
    } else {
      jump(image(), "opacity", 0);
      jump(disc(), "opacity", current ? 1 : 0);
    }
  };
  // A picture that lands after the row was painted shows without a repaint.
  createEffect(() => {
    model.pictures();
    repaint();
  });
  return (avatar: Avatar | null) => {
    current = avatar;
    shown = -2;
    if (avatar) {
      jump(disc(), "bgColor", initialColor(avatar.owner));
      const initial = initialOf(avatar.name, bold);
      if (initial.rich !== letterRich) setSlot(letter(), (letterRich = initial.rich) ? RICH_BOLD : FONT.smBold);
      paintText(letter(), initial.text);
    } else paintText(letter(), "");
    repaint();
  };
}

interface PictureRefs {
  image?: NodeMirror;
  disc?: NodeMirror;
  letter?: NodeMirror;
}

/** The nodes a picture painter drives. The refs are filled as the nodes are
 *  created, ahead of the slot's onMount, which paints the first row. */
function Picture(props: { x: number; y: number; refs: PictureRefs }) {
  return (
    <>
      <View ref={(node: NodeMirror) => (props.refs.disc = node)} class="absolute w-[28] h-[28] rounded-[14] opacity-0 bg-[#5865f2] flex-col justify-center items-center" style={{ insetL: props.x + 2, insetT: props.y + 2 }}>
        <Text ref={(node: NodeMirror) => (props.refs.letter = node)} class="text-sm text-white font-bold">{" "}</Text>
      </View>
      <Image ref={(node: NodeMirror) => (props.refs.image = node)} class="absolute w-[32] h-[32] opacity-0" style={{ insetL: props.x, insetT: props.y }} />
    </>
  );
}

export function Centered(props: { title: string; detail: string; spinner?: boolean; button?: { id: string; label: string }; press: Press; top?: number }) {
  const lines = () => wrap(props.detail, FONT.xs, 270, 5);
  const top = () => props.top ?? 50;
  return (
    <>
      <Show when={props.spinner}>
        <View class="absolute left-[149]" style={{ insetT: top() - 34 }}>
          <ClassicSpinner size={22} color={THEME.muted} />
        </View>
      </Show>
      <Text class="absolute left-0 w-[320] text-base text-white font-bold text-center" style={{ insetT: top() }}>{props.title}</Text>
      <For each={lines()}>
        {(line, index) => <Text class="absolute left-[25] w-[270] text-xs text-[#b9bbbe] text-center" style={{ insetT: top() + 24 + index() * 15 }}>{line}</Text>}
      </For>
      <Show when={props.button}>
        {(button) => (
          <>
            <View
              class={props.press.is(button().id)
                ? "absolute left-[100] w-[120] h-[30] rounded-[6] bg-[#4752c4]"
                : "absolute left-[100] w-[120] h-[30] rounded-[6] bg-[#5865f2]"}
              style={{ insetT: top() + 110 }}
            />
            <Text class="absolute left-[100] w-[120] text-sm text-white font-bold text-center" style={{ insetT: top() + 117 }}>{button().label}</Text>
          </>
        )}
      </Show>
    </>
  );
}

function stateView<T>(state: ListState<T>, empty: { title: string; detail: string }, loading: string, retry: string, press: Press) {
  if (state.status === "error") return <Centered title={state.error!.title} detail={state.error!.detail} button={{ id: retry, label: "Try Again" }} press={press} />;
  if (state.status === "loading") return <Centered title="Loading" detail={loading} spinner press={press} />;
  return <Centered title={empty.title} detail={empty.detail} press={press} />;
}

const background = (color: string) => () => <View class="absolute left-0 top-0 w-[320] h-[240]" style={{ bgColor: color }} />;

// ---- servers ----------------------------------------------------------------------

const GUILD_H = 44;

interface GuildRow {
  key: string;
  guild: Guild;
  name: string;
  rich: boolean;
  y: number;
  h: number;
}

function GuildSlot(props: { env: DiscordEnv; pool: SlotPool<GuildRow>; slot: number; lit: (id: string) => boolean }) {
  let box!: NodeMirror;
  let wash!: NodeMirror;
  let name!: NodeMirror;
  let content!: NodeMirror;
  let skeletonNode!: NodeMirror;
  let skeletonShown = false;
  const refs: PictureRefs = {};
  const [id, setId] = createSignal("");
  const lit = createMemo(() => props.lit(id()));
  let y = -1;
  let rich = false;
  onMount(() => {
    const picture = createPicturePainter(props.env.model, () => refs.image!, () => refs.disc!, () => refs.letter!, props.env.bold);
    createEffect(() => jump(wash, "opacity", lit() ? 1 : 0));
    props.pool.attach(props.slot, (row, skeleton) => batch(() => {
      if (!row) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        paintText(name, "");
        picture(null);
        setId("");
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (row.y !== y) jump(box, "translateY", (y = row.y));
      setId(row.key);
      if (skeleton !== skeletonShown) showSkeleton(skeletonNode, content, (skeletonShown = skeleton));
      if (skeleton) return;
      if (row.rich !== rich) setSlot(name, (rich = row.rich) ? RICH_BOLD : FONT.smBold);
      paintText(name, row.name);
      picture({ kind: "icon", owner: row.guild.id, hash: row.guild.icon, name: row.guild.name });
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 w-[320] h-[44] opacity-0 contain-strict">
      <View ref={wash} class="absolute inset-0 opacity-0 bg-[#4f545c]" />
      <View class="absolute left-[52] right-0 bottom-0 h-[1] bg-[#3f4248]" />
      <Skeleton ref={(node) => (skeletonNode = node)} x={52} width={180} face lines={0} dark />
      <View ref={content} class="absolute inset-0">
        <Picture x={10} y={6} refs={refs} />
        <Text ref={name} class="absolute left-[52] top-[14] text-sm text-[#dcddde] font-bold">{" "}</Text>
      </View>
    </View>
  );
}

export function serversPage(env: DiscordEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { model, press } = env;
  createEffect(() => env.bold.want(model.guilds().items.map((guild) => guild.name)));
  const rows = createMemo((): GuildRow[] => {
    env.bold.revision();
    return model.guilds().items.map((guild, index) => {
      const name = fitName(guild.name, env.bold, FONT.smBold, W - 52 - 12);
      return { key: `guild.${guild.id}`, guild, name: name.text, rich: name.rich, y: index * GUILD_H, h: GUILD_H };
    });
  });
  const listed = () => model.guilds().status === "ready" && rows().length > 0;
  const pool = createSlotPool(() => (listed() ? rows() : NO_ROWS), layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: GUILD_H });
  const lit = highlight(env, layer, "");
  const keys = keyIndex(rows);
  const open = (row: GuildRow) => {
    model.openGuild(row.guild);
    stack.push("channels");
  };
  const content: PageContent = {
    view: () => (
      <>
        <For each={pool.slots}>{(slot) => <GuildSlot env={env} pool={pool} slot={slot} lit={lit} />}</For>
        <Show when={!listed()}>
          {stateView(model.guilds(), { title: "No Servers", detail: "Invite the bot to a server: run bun tools/companion.ts service discord status on the Mac for its invite link." }, "Asking your Mac for the bot's servers.", "guilds.retry", press)}
        </Show>
      </>
    ),
    height: () => rows().length * GUILD_H,
    focusOrder: () => keys().order,
    targets(top, offset, bottom) {
      if (model.guilds().status === "error") return [{ id: "guilds.retry", x: 100, y: top + 160 - offset, w: 120, h: 30, run: () => model.loadGuilds() }];
      const out: Target[] = [];
      for (const row of rows()) {
        const y = top + row.y - offset;
        if (y + row.h <= top || y >= bottom) continue;
        out.push({ id: row.key, x: 0, y, w: W, h: row.h, run: () => open(row) });
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
      else if (id === "guilds.retry") model.loadGuilds();
    },
  };
  return {
    title: () => "Servers",
    backLabel: "Servers",
    tint: "black",
    bare: true,
    fixed: background(THEME.list),
    content,
    key(pressed) {
      if (pressed & BTN.SQUARE || (pressed & BTN.CIRCLE && model.guilds().status === "error")) {
        model.loadGuilds();
        return true;
      }
      return false;
    },
  };
}

// ---- channels ---------------------------------------------------------------------

const CATEGORY_H = 26;
const CHANNEL_H = 34;

interface ChannelRow {
  /** "" for a category header, which takes no focus or tap. */
  key: string;
  channel: Channel | null;
  label: string;
  rich: boolean;
  y: number;
  h: number;
}

function ChannelSlot(props: { pool: SlotPool<ChannelRow>; slot: number; lit: (id: string) => boolean }) {
  let box!: NodeMirror;
  let wash!: NodeMirror;
  let hash!: NodeMirror;
  let name!: NodeMirror;
  let header!: NodeMirror;
  let content!: NodeMirror;
  let skeletonNode!: NodeMirror;
  let skeletonShown = false;
  const [id, setId] = createSignal("");
  const lit = createMemo(() => props.lit(id()));
  let y = -1;
  let h = -1;
  let rich = false;
  onMount(() => {
    createEffect(() => {
      jump(wash, "opacity", lit() ? 1 : 0);
      jump(name, "textColor", lit() ? "#ffffff" : THEME.text);
    });
    props.pool.attach(props.slot, (row, skeleton) => batch(() => {
      if (!row) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        for (const text of [name, header, hash]) paintText(text, "");
        setId("");
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (row.y !== y) jump(box, "translateY", (y = row.y));
      if (row.h !== h) jump(box, "height", (h = row.h));
      setId(row.key);
      if (skeleton !== skeletonShown) showSkeleton(skeletonNode, content, (skeletonShown = skeleton));
      if (skeleton) return;
      const channel = row.channel !== null;
      if (row.rich !== rich) {
        rich = row.rich;
        setSlot(name, rich ? RICH : FONT.sm);
        setSlot(header, rich ? RICH_BOLD : FONT.xxsBold);
      }
      paintText(header, channel ? "" : row.label);
      paintText(hash, channel ? "#" : "");
      paintText(name, channel ? row.label : "");
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 w-[320] h-[34] opacity-0 contain-strict">
      <View ref={wash} class="absolute left-[6] right-[6] top-[2] bottom-[2] rounded-[4] opacity-0 bg-[#4f545c]" />
      <Skeleton ref={(node) => (skeletonNode = node)} x={32} width={160} lines={0} dark />
      <View ref={content} class="absolute inset-0">
        <Text ref={header} class="absolute left-[10] top-[11] text-2xs text-[#8e9297] font-bold">{" "}</Text>
        <Text ref={hash} class="absolute left-[14] top-[7] text-base text-[#8e9297]">{" "}</Text>
        <Text ref={name} class="absolute left-[32] top-[9] text-sm text-[#dcddde]">{" "}</Text>
      </View>
    </View>
  );
}

export function channelsPage(env: DiscordEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { model, press } = env;
  createEffect(() => {
    const items = model.channels().items;
    env.text.want(items.map((channel) => channel.name));
    env.bold.want(items.map((channel) => channel.category ?? ""));
  });
  const rows = createMemo((): ChannelRow[] => {
    env.text.revision();
    env.bold.revision();
    const out: ChannelRow[] = [];
    let y = 4;
    let category: string | null | undefined;
    for (const channel of model.channels().items) {
      if (channel.category !== category) {
        category = channel.category;
        if (category !== null) {
          const label = fitName(category.toUpperCase(), env.bold, FONT.xxsBold, W - 20);
          out.push({ key: "", channel: null, label: label.text, rich: label.rich, y, h: CATEGORY_H });
          y += CATEGORY_H;
        }
      }
      const label = fitName(channel.name, env.text, FONT.sm, W - 32 - 12);
      out.push({ key: `channel.${channel.id}`, channel, label: label.text, rich: label.rich, y, h: CHANNEL_H });
      y += CHANNEL_H;
    }
    return out;
  });
  const height = () => {
    const list = rows();
    return list.length ? list[list.length - 1]!.y + list[list.length - 1]!.h + 6 : 0;
  };
  const listed = () => model.channels().status === "ready" && rows().length > 0;
  const pool = createSlotPool(() => (listed() ? rows() : NO_ROWS), layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: CATEGORY_H });
  const lit = highlight(env, layer, "");
  const keys = keyIndex(rows);
  const open = (row: ChannelRow) => {
    if (!row.channel) return;
    model.openChannel(row.channel);
    stack.push("chat");
  };
  const content: PageContent = {
    view: () => (
      <>
        <For each={pool.slots}>{(slot) => <ChannelSlot pool={pool} slot={slot} lit={lit} />}</For>
        <Show when={!listed()}>
          {stateView(model.channels(), { title: "No Channels", detail: "The bot cannot read any text channel here. Give it View Channels and Read Message History." }, "Asking your Mac for the channels.", "channels.retry", press)}
        </Show>
      </>
    ),
    height,
    focusOrder: () => keys().order,
    targets(top, offset, bottom) {
      if (model.channels().status === "error") return [{ id: "channels.retry", x: 100, y: top + 160 - offset, w: 120, h: 30, run: () => model.reloadChannels() }];
      const out: Target[] = [];
      for (const row of rows()) {
        if (!row.channel) continue;
        const y = top + row.y - offset;
        if (y + row.h <= top || y >= bottom) continue;
        out.push({ id: row.key, x: 0, y, w: W, h: row.h, run: () => open(row) });
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
      else if (id === "channels.retry") model.reloadChannels();
    },
  };
  return {
    title: () => toAscii(model.guild()?.name ?? "Channels"),
    backLabel: "Channels",
    tint: "black",
    bare: true,
    fixed: background(THEME.list),
    content,
    key(pressed) {
      if (pressed & BTN.SQUARE || (pressed & BTN.CIRCLE && model.channels().status === "error")) {
        model.reloadChannels();
        return true;
      }
      return false;
    },
  };
}

// ---- messages ---------------------------------------------------------------------

/** Message text: 14 px type on 16 px lines, from x 46. */
const BODY_X = 46;
const BODY_W = W - BODY_X - 10;
const BODY_LINE = 16;
const HEADER_H = 20;
const REPLY_H = 14;
const EARLIER_H = 34;
/** Messages by one author within this many ms share one header. */
const GROUP_MS = 7 * 60_000;
const MESSAGE_MIN_H = BODY_LINE + 4;
const GLYPH_STEP = 120;

export interface MessageRow {
  key: string;
  id: string;
  y: number;
  h: number;
  /** The first of an author's run: avatar, name and time. */
  head: boolean;
  system: boolean;
  name: string;
  nameW: number;
  when: string;
  reply: string;
  body: string;
  bodyY: number;
  avatar: Avatar;
  /** Name, reply and body draw from the glyph atlases. */
  rich: boolean;
  /** Not measured yet: the slot shows its skeleton at the estimated height. */
  pending: boolean;
  /** Kept while everything but the place stays (framework slot-list). */
  content: object | undefined;
}

const bodyCache = new Map<string, { content: string; stamp: number; lines: string[] }>();

function bodyLines(message: Message, glyphs: Glyphs | null): string[] {
  // A glyph's advance is the same in every atlas of a face, so a rich wrap
  // holds while later atlases grow.
  const stamp = glyphs ? 1 : -1;
  const cached = bodyCache.get(message.id);
  if (cached && cached.content === message.content && cached.stamp === stamp) return cached.lines;
  const edited = message.edited ? " (edited)" : "";
  const lines = glyphs ? glyphs.wrap(richText(message.content) + edited || " ", BODY_W) : wrap(toAscii(message.content) + edited || " ", FONT.sm, BODY_W);
  if (bodyCache.size > 1000) bodyCache.clear();
  bodyCache.set(message.id, { content: message.content, stamp, lines });
  return lines;
}

/** The texts of a message that may hold any script, by face. */
export function messageTexts(message: Message): { text: string[]; bold: string[] } {
  return {
    text: message.replyTo ? [message.content, message.replyTo.author, message.replyTo.content] : [message.content],
    bold: [message.author.name],
  };
}

/** A message opens a run (avatar, name, time) unless it follows its
 *  author's last within GROUP_MS. */
function opensRun(messages: readonly Message[], index: number): boolean {
  const message = messages[index]!;
  const previous = messages[index - 1];
  return message.system || !previous || previous.system || previous.author.id !== message.author.id ||
    message.time - previous.time > GROUP_MS || message.replyTo !== null;
}

/** Both atlases hold every glyph of the message's texts. */
function richMessage(message: Message, glyphs: { text: Glyphs; bold: Glyphs }): boolean {
  if (!glyphs.text.ready() || !glyphs.bold.ready()) return false;
  const texts = messageTexts(message);
  return texts.text.every((text) => glyphs.text.covers(text)) && texts.bold.every((text) => glyphs.bold.covers(text));
}

/** A message's row apart from its place. */
interface MessageShape {
  h: number;
  head: boolean;
  name: string;
  nameW: number;
  reply: string;
  body: string;
  bodyY: number;
  rich: boolean;
}

function messageShape(message: Message, head: boolean, rich: boolean, glyphs: { text: Glyphs; bold: Glyphs }): MessageShape {
  const lines = bodyLines(message, rich ? glyphs.text : null);
  const reply = !message.replyTo
    ? ""
    : rich
      ? glyphs.text.ellipsize(richText(`@${message.replyTo.author} ${message.replyTo.content}`), BODY_W)
      : ellipsize(`@${toAscii(message.replyTo.author)} ${toAscii(message.replyTo.content)}`, FONT.xxs, BODY_W);
  const name = message.system ? "" : rich ? glyphs.bold.ellipsize(richText(message.author.name), 150) : ellipsize(toAscii(message.author.name), FONT.xsBold, 150);
  const bodyY = messageBodyY(message, head);
  return {
    h: bodyY + lines.length * BODY_LINE + 3,
    head,
    name,
    nameW: name ? (rich ? glyphs.bold.measure(name) : measure(name, FONT.xsBold)) : 0,
    reply,
    body: lines.join("\n"),
    bodyY,
    rich,
  };
}

function messageBodyY(message: Message, head: boolean): number {
  return (head ? 6 : 1) + (message.replyTo ? REPLY_H : 0) + (head && !message.system ? HEADER_H : 0);
}

/** A message's height before it is wrapped: its text at about 7 px a
 *  character over the body width. */
function estimateMessage(message: Message, head: boolean): number {
  const lines = Math.max(1, Math.ceil((message.content.length * 7) / BODY_W));
  return messageBodyY(message, head) + lines * BODY_LINE + 3;
}

/** Message rows by id: an unchanged row keeps its object, so the slot
 *  showing it keeps its nodes as they are. */
const previousMessages = new Map<string, MessageRow>();

function placeMessages(rows: readonly MeasuredRow<Message, MessageShape>[]): MessageRow[] {
  const placed = rows.map(({ item: message, y, h, value: shape }) => {
    const before = previousMessages.get(message.id);
    const same = !!before && before.h === h && before.pending === !shape && (!shape || (before.body === shape.body && before.head === shape.head && before.rich === shape.rich && before.name === shape.name && before.reply === shape.reply));
    if (same && before!.y === y) return before!;
    const row: MessageRow = {
      key: `message.${message.id}`,
      id: message.id,
      y,
      h,
      head: shape?.head ?? false,
      system: message.system,
      name: shape?.name ?? "",
      nameW: shape?.nameW ?? 0,
      when: message.when,
      reply: shape?.reply ?? "",
      body: shape?.body ?? "",
      bodyY: shape?.bodyY ?? 0,
      avatar: { kind: "avatar", owner: message.author.id, hash: message.author.avatar, name: message.author.name },
      rich: shape?.rich ?? false,
      pending: !shape,
      content: !shape ? undefined : same ? before!.content : {},
    };
    previousMessages.set(message.id, row);
    return row;
  });
  if (previousMessages.size > 1000) previousMessages.clear();
  return placed;
}

function MessageSlot(props: { env: DiscordEnv; pool: SlotPool<MessageRow>; slot: number; lit: (id: string) => boolean }) {
  let box!: NodeMirror;
  let wash!: NodeMirror;
  let name!: NodeMirror;
  let when!: NodeMirror;
  let reply!: NodeMirror;
  let body!: NodeMirror;
  let content!: NodeMirror;
  let skeletonNode!: NodeMirror;
  let skeletonShown = false;
  const refs: PictureRefs = {};
  const [id, setId] = createSignal("");
  const lit = createMemo(() => props.lit(id()));
  let y = -1;
  let h = -1;
  let whenX = -1;
  let bodyY = -1;
  let tone = "";
  let rich = false;
  onMount(() => {
    const picture = createPicturePainter(props.env.model, () => refs.image!, () => refs.disc!, () => refs.letter!, props.env.bold);
    createEffect(() => jump(wash, "opacity", lit() ? 1 : 0));
    props.pool.attach(props.slot, (row, skeleton, moved) => batch(() => {
      if (!row) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        for (const text of [name, when, reply, body]) paintText(text, "");
        picture(null);
        setId("");
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (row.y !== y) jump(box, "translateY", (y = row.y));
      if (row.h !== h) jump(box, "height", (h = row.h));
      if (moved) return;
      setId(row.key);
      if (skeleton !== skeletonShown) showSkeleton(skeletonNode, content, (skeletonShown = skeleton));
      if (skeleton) return;
      const header = row.head && !row.system;
      if (row.rich !== rich) {
        rich = row.rich;
        setSlot(name, rich ? RICH_BOLD : FONT.xsBold);
        setSlot(reply, rich ? RICH : FONT.xxs);
        setSlot(body, rich ? RICH : FONT.sm);
      }
      paintText(name, header ? row.name : "");
      paintText(when, header ? row.when : "");
      paintText(reply, row.reply);
      paintText(body, row.body);
      const nextWhenX = BODY_X + row.nameW + 6;
      if (header && nextWhenX !== whenX) jump(when, "insetL", (whenX = nextWhenX));
      const top = (row.reply ? REPLY_H : 0) + 5;
      jump(name, "insetT", top);
      jump(when, "insetT", top + 1);
      jump(refs.image!, "insetT", top);
      jump(refs.disc!, "insetT", top + 2);
      if (row.bodyY !== bodyY) jump(body, "insetT", (bodyY = row.bodyY));
      const nextTone = row.system ? THEME.muted : THEME.text;
      if (nextTone !== tone) jump(body, "textColor", (tone = nextTone));
      picture(header ? row.avatar : null);
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 w-[320] h-[40] opacity-0 contain-strict">
      <View ref={wash} class="absolute inset-0 opacity-0 bg-[#32353b]" />
      <Skeleton ref={(node) => (skeletonNode = node)} x={BODY_X} width={BODY_W - 20} lines={1} dark />
      <View ref={content} class="absolute inset-0">
        <Picture x={8} y={5} refs={refs} />
        <Text ref={reply} class="absolute left-[46] top-[4] text-2xs text-[#b9bbbe]">{" "}</Text>
        <Text ref={name} class="absolute left-[46] top-[5] text-xs text-white font-bold">{" "}</Text>
        <Text ref={when} class="absolute left-[96] top-[6] text-2xs text-[#a3a6aa]">{" "}</Text>
        <Text ref={body} class="absolute left-[46] top-[25] text-sm text-[#dcddde] leading-[16]">{" "}</Text>
      </View>
    </View>
  );
}

export function chatPage(env: DiscordEnv, _stack: NavStack, layer: LayerContext): PageSpec {
  const { model, press } = env;
  const messages = createMemo((): readonly Message[] => model.chat()?.messages ?? []);
  const top = () => {
    const chat = model.chat();
    return chat && (chat.more || chat.loadingOlder) ? EARLIER_H : 6;
  };
  // A message's version: whether it opens a run and draws rich, kept as one
  // object per message while both hold.
  const versions = new WeakMap<Message, { head: boolean; rich: boolean }>();
  const versionOf = (message: Message, index: number) => {
    const head = opensRun(messages(), index);
    const rich = richMessage(message, env);
    const known = versions.get(message);
    if (known && known.head === head && known.rich === rich) return known;
    const next = { head, rich };
    versions.set(message, next);
    return next;
  };
  // Messages are wrapped when they come near the view or while the chat
  // stands still (framework slot-list); one not wrapped yet shows its
  // skeleton at an estimated height. Older pages arriving at the top keep
  // the reader's place through the list's rebase.
  const list = createMeasuredList<Message, MessageShape>({
    items: messages,
    key: (message) => message.id,
    version: versionOf,
    measure: (message, index) => {
      const version = versionOf(message, index);
      return messageShape(message, version.head, version.rich, env);
    },
    estimate: (message, index) => estimateMessage(message, opensRun(messages(), index)),
    offset: layer.offset,
    view: VIEW_H,
    overscan: OVERSCAN,
    top,
    rebase: layer.rebase,
  });
  // An atlas that loads can bring any message into the rich face.
  createEffect(() => {
    env.text.revision();
    env.bold.revision();
    list.recheck();
  });
  const layout = createMemo(() => ({ rows: placeMessages(list.rows()), height: list.height() + 8, top: top() }));
  // Glyphs for the messages around the visible band (two screens above and
  // below), again when the list changes or the band moves by GLYPH_STEP: an
  // atlas holds what one response carries, so it follows the reader. Asked
  // for once the list has stood still a few frames: in motion the band moves
  // every few frames, and the scan costs a frame.
  let lastOffset = Number.NaN;
  let still = 0;
  let doneRows: readonly MessageRow[] | null = null;
  let doneBand = Number.NaN;
  onFrame(() => {
    const offset = layer.offset();
    still = offset === lastOffset ? still + 1 : 0;
    lastOffset = offset;
    if (still < 6) return;
    const band = Math.floor(offset / GLYPH_STEP);
    const rows = layout().rows;
    if (rows === doneRows && band === doneBand) return;
    doneRows = rows;
    doneBand = band;
    const top = band * GLYPH_STEP - 2 * VIEW_H;
    const bottom = band * GLYPH_STEP + 3 * VIEW_H;
    const ids = new Set(rows.filter((row) => row.y + row.h > top && row.y < bottom).map((row) => row.id));
    const texts = messages().filter((message) => ids.has(message.id)).map(messageTexts);
    if (texts.length === 0) return;
    env.text.want(texts.flatMap((item) => item.text));
    env.bold.want(texts.flatMap((item) => item.bold));
  });
  const ready = () => model.chat()?.status === "ready";
  const pool = createSlotPool(() => (ready() ? layout().rows : NO_ROWS), layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: MESSAGE_MIN_H });
  const lit = highlight(env, layer, "");
  const keys = keyIndex(() => layout().rows);

  // A first page opens at the bottom. While the reader is at the bottom,
  // arrivals and rows measured to a new height keep it there. Older pages
  // coming in at the top keep the reader's place through the list's rebase.
  let arrivals = -1;
  let lastHeight = 0;
  createEffect(() => {
    const chat = model.chat();
    const current = layout();
    if (!chat || chat.status !== "ready") return;
    // The offset is read untracked: this runs when messages change, not as the list scrolls.
    const atBottom = untrack(layer.offset) + VIEW_H >= lastHeight - 48;
    if (arrivals < 0 || (atBottom && (chat.arrivals !== arrivals || current.height !== lastHeight))) {
      layer.reveal(Math.max(0, current.height - 1), current.height);
    }
    arrivals = chat.arrivals;
    lastHeight = current.height;
  });

  const content: PageContent = {
    view: () => (
      <>
        <For each={pool.slots}>{(slot) => <MessageSlot env={env} pool={pool} slot={slot} lit={lit} />}</For>
        <Show when={ready() && (model.chat()?.more || model.chat()?.loadingOlder)}>
          <View class={press.is("chat.earlier") ? "absolute left-[60] top-[6] w-[200] h-[24] rounded-[12] bg-[#4f545c]" : "absolute left-[60] top-[6] w-[200] h-[24] rounded-[12] bg-[#2f3136]"} />
          <Text class="absolute left-[60] top-[10] w-[200] text-xs text-[#b9bbbe] font-bold text-center">
            {model.chat()?.loadingOlder ? "Loading..." : "Load earlier messages"}
          </Text>
        </Show>
        <Show when={ready() && layout().rows.length === 0}>
          <Centered title={`Welcome to #${toAscii(model.chat()?.channel.name ?? "")}`} detail="This is the start of the channel. Press X to write the first message." press={press} />
        </Show>
        <Show when={model.chat()?.status === "loading"}>
          <Centered title="Loading" detail="Asking your Mac for the messages." spinner press={press} />
        </Show>
        <Show when={model.chat()?.status === "error"}>
          <Centered title={model.chat()!.error!.title} detail={model.chat()!.error!.detail} button={{ id: "chat.retry", label: "Try Again" }} press={press} />
        </Show>
      </>
    ),
    height: () => layout().height,
    focusOrder: () => keys().order,
    targets(top, offset) {
      const chat = model.chat();
      if (chat?.status === "error") return [{ id: "chat.retry", x: 100, y: top + 160 - offset, w: 120, h: 30, run: () => model.reloadChannel() }];
      if (chat?.more && !chat.loadingOlder) return [{ id: "chat.earlier", x: 60, y: top + 6 - offset, w: 200, h: 24, run: () => model.older() }];
      return [];
    },
    span(id) {
      const row = keys().byKey.get(id);
      return row ? [row.y, row.y + row.h] : null;
    },
    activate() {},
  };
  // Nearing the top by scrolling pages in older messages.
  onFrame(() => {
    const chat = model.chat();
    if (chat?.status === "ready" && chat.more && !chat.loadingOlder && layer.offset() < 4 && layout().height > VIEW_H) model.older();
  });
  return {
    title: () => `#${toAscii(model.chat()?.channel.name ?? "")}`,
    tint: "black",
    bare: true,
    fixed: background(THEME.chat),
    right: () => (ready() ? { id: "chat.compose", label: "Write", kind: "done", run: () => env.compose() } : null),
    content,
    key(pressed) {
      if (pressed & (BTN.LTRIGGER | BTN.RTRIGGER)) {
        layer.scrollBy(pressed & BTN.LTRIGGER ? -(VIEW_H - 34) : VIEW_H - 34);
        return true;
      }
      if (pressed & BTN.TRIANGLE && ready()) {
        env.compose();
        return true;
      }
      if (pressed & BTN.SQUARE || (pressed & BTN.CIRCLE && model.chat()?.status === "error")) {
        model.reloadChannel();
        return true;
      }
      return false;
    },
  };
}
