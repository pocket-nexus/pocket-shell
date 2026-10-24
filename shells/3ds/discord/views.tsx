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
import type { NavButton } from "../ui/bar.tsx";
import { viewHeight, type LayerContext, type NavStack, type PageContent, type PageSpec } from "../ui/nav.tsx";
import { COMPACT, SCREEN_H, SCREEN_W } from "../ui/screen.ts";
import { ellipsize, FONT, measure, toAscii, wrap } from "../ui/text.ts";
import { richText, type Glyphs } from "../ui/glyphs.ts";
import { createSlotPool, paintText, type SlotPool } from "../ui/slots.ts";
import type { Press, Target } from "../ui/touch.ts";
import type { Channel, Guild, Message } from "./api.ts";
import type { ChatState, DiscordModel, ListState } from "./model.ts";
import { glyph } from "@pocketjs/framework/modality";

const OVERSCAN = 80;

// Sized to the surface by fitSurface(), which each page calls first.
let W = 320;
let VIEW_H = 204;
let BODY_W = 0;

function fitSurface(): void {
  W = SCREEN_W;
  VIEW_H = viewHeight();
  BODY_W = W - BODY_X - 10;
}

/** The bar's Reload button on a surface larger than the 3DS's: the touch
 *  path for Y's reload. */
function reloadButton(run: () => void): (() => NavButton) | undefined {
  return COMPACT ? undefined : () => ({ id: "discord.reload", label: "Reload", kind: "plain", run });
}
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
        <View class="absolute" style={{ insetL: W / 2 - 11, insetT: top() - 34 }}>
          <ClassicSpinner size={22} color={THEME.muted} />
        </View>
      </Show>
      <Text class="absolute left-0 text-base text-white font-bold text-center" style={{ insetT: top(), width: W }}>{props.title}</Text>
      <For each={lines()}>
        {(line, index) => <Text class="absolute w-[270] text-xs text-[#b9bbbe] text-center" style={{ insetL: (W - 270) / 2, insetT: top() + 24 + index() * 15 }}>{line}</Text>}
      </For>
      <Show when={props.button}>
        {(button) => (
          <>
            <View
              class={props.press.is(button().id)
                ? "absolute w-[120] h-[30] rounded-[6] bg-[#4752c4]"
                : "absolute w-[120] h-[30] rounded-[6] bg-[#5865f2]"}
              style={{ insetL: (W - 120) / 2, insetT: top() + 110 }}
            />
            <Text class="absolute w-[120] text-sm text-white font-bold text-center" style={{ insetL: (W - 120) / 2, insetT: top() + 117 }}>{button().label}</Text>
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

const background = (color: string) => () => <View class="absolute left-0 top-0" style={{ bgColor: color, width: SCREEN_W, height: SCREEN_H }} />;

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
  const refs: PictureRefs = {};
  const [id, setId] = createSignal("");
  const lit = createMemo(() => props.lit(id()));
  let y = -1;
  let rich = false;
  onMount(() => {
    const picture = createPicturePainter(props.env.model, () => refs.image!, () => refs.disc!, () => refs.letter!, props.env.bold);
    createEffect(() => jump(wash, "opacity", lit() ? 1 : 0));
    props.pool.attach(props.slot, (row) => batch(() => {
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
      if (row.rich !== rich) setSlot(name, (rich = row.rich) ? RICH_BOLD : FONT.smBold);
      paintText(name, row.name);
      picture({ kind: "icon", owner: row.guild.id, hash: row.guild.icon, name: row.guild.name });
      setId(row.key);
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 h-[44] opacity-0 contain-strict" style={{ width: W }}>
      <View ref={wash} class="absolute inset-0 opacity-0 bg-[#4f545c]" />
      <View class="absolute left-[52] right-0 bottom-0 h-[1] bg-[#3f4248]" />
      <Picture x={10} y={6} refs={refs} />
      <Text ref={name} class="absolute left-[52] top-[14] text-sm text-[#dcddde] font-bold">{" "}</Text>
    </View>
  );
}

export function serversPage(env: DiscordEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
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
      if (model.guilds().status === "error") return [{ id: "guilds.retry", x: (W - 120) / 2, y: top + 160 - offset, w: 120, h: 30, run: () => model.loadGuilds() }];
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
    right: reloadButton(() => model.loadGuilds()),
    content,
    legend: () => [{ button: "square", label: "Reload" }],
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
    props.pool.attach(props.slot, (row) => batch(() => {
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
      const channel = row.channel !== null;
      if (row.rich !== rich) {
        rich = row.rich;
        setSlot(name, rich ? RICH : FONT.sm);
        setSlot(header, rich ? RICH_BOLD : FONT.xxsBold);
      }
      paintText(header, channel ? "" : row.label);
      paintText(hash, channel ? "#" : "");
      paintText(name, channel ? row.label : "");
      setId(row.key);
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 h-[34] opacity-0 contain-strict" style={{ width: W }}>
      <View ref={wash} class="absolute left-[6] right-[6] top-[2] bottom-[2] rounded-[4] opacity-0 bg-[#4f545c]" />
      <Text ref={header} class="absolute left-[10] top-[11] text-2xs text-[#8e9297] font-bold">{" "}</Text>
      <Text ref={hash} class="absolute left-[14] top-[7] text-base text-[#8e9297]">{" "}</Text>
      <Text ref={name} class="absolute left-[32] top-[9] text-sm text-[#dcddde]">{" "}</Text>
    </View>
  );
}

export function channelsPage(env: DiscordEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
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
      if (model.channels().status === "error") return [{ id: "channels.retry", x: (W - 120) / 2, y: top + 160 - offset, w: 120, h: 30, run: () => model.reloadChannels() }];
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
    right: reloadButton(() => model.reloadChannels()),
    content,
    legend: () => [{ button: "square", label: "Reload" }],
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
}

const bodyCache = new Map<string, { content: string; stamp: number; lines: string[] }>();

function bodyLines(message: Message, glyphs: Glyphs | null): string[] {
  // A rich layout is valid for the atlas revision it measured with.
  const stamp = glyphs ? glyphs.revision() : -1;
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

export function messageRows(chat: ChatState, glyphs: { text: Glyphs; bold: Glyphs } | null = null): { rows: MessageRow[]; height: number; top: number } {
  const top = chat.more || chat.loadingOlder ? EARLIER_H : 6;
  let y = top;
  let previous: Message | null = null;
  const rows = chat.messages.map((message): MessageRow => {
    const head = message.system || !previous || previous.system || previous.author.id !== message.author.id ||
      message.time - previous.time > GROUP_MS || message.replyTo !== null;
    previous = message;
    const texts = messageTexts(message);
    const rich = !!glyphs && glyphs.text.ready() && texts.text.every((text) => glyphs.text.covers(text)) && texts.bold.every((text) => glyphs.bold.covers(text));
    const lines = bodyLines(message, rich ? glyphs!.text : null);
    const reply = !message.replyTo
      ? ""
      : rich
        ? glyphs!.text.ellipsize(richText(`@${message.replyTo.author} ${message.replyTo.content}`), BODY_W)
        : ellipsize(`@${toAscii(message.replyTo.author)} ${toAscii(message.replyTo.content)}`, FONT.xxs, BODY_W);
    const name = message.system ? "" : rich ? glyphs!.bold.ellipsize(richText(message.author.name), 150) : ellipsize(toAscii(message.author.name), FONT.xsBold, 150);
    const offset = (head ? 6 : 1) + (reply ? REPLY_H : 0);
    const bodyY = offset + (head && !message.system ? HEADER_H : 0);
    const h = bodyY + lines.length * BODY_LINE + 3;
    const row: MessageRow = {
      key: `message.${message.id}`,
      id: message.id,
      y,
      h,
      head,
      system: message.system,
      name,
      nameW: name ? (rich ? glyphs!.bold.measure(name) : measure(name, FONT.xsBold)) : 0,
      when: message.when,
      reply,
      body: lines.join("\n"),
      bodyY,
      avatar: { kind: "avatar", owner: message.author.id, hash: message.author.avatar, name: message.author.name },
      rich,
    };
    y += h;
    return row;
  });
  return { rows, height: y + 8, top };
}

function MessageSlot(props: { env: DiscordEnv; pool: SlotPool<MessageRow>; slot: number; lit: (id: string) => boolean }) {
  let box!: NodeMirror;
  let wash!: NodeMirror;
  let name!: NodeMirror;
  let when!: NodeMirror;
  let reply!: NodeMirror;
  let body!: NodeMirror;
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
    props.pool.attach(props.slot, (row) => batch(() => {
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
      setId(row.key);
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 h-[40] opacity-0 contain-strict" style={{ width: W }}>
      <View ref={wash} class="absolute inset-0 opacity-0 bg-[#32353b]" />
      <Picture x={8} y={5} refs={refs} />
      <Text ref={reply} class="absolute left-[46] top-[4] text-2xs text-[#b9bbbe]">{" "}</Text>
      <Text ref={name} class="absolute left-[46] top-[5] text-xs text-white font-bold">{" "}</Text>
      <Text ref={when} class="absolute left-[96] top-[6] text-2xs text-[#a3a6aa]">{" "}</Text>
      <Text ref={body} class="absolute left-[46] top-[25] text-sm text-[#dcddde] leading-[16]">{" "}</Text>
    </View>
  );
}

export function chatPage(env: DiscordEnv, _stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press } = env;
  const layout = createMemo(() => {
    const chat = model.chat();
    env.text.revision();
    env.bold.revision();
    return chat ? messageRows(chat, env) : { rows: [] as MessageRow[], height: 0, top: 0 };
  });
  // Glyphs for the messages around the visible band (two screens above and
  // below), again when the list changes or the band moves by GLYPH_STEP: an
  // atlas holds what one response carries, so it follows the reader.
  const band = createMemo(() => Math.floor(layer.offset() / GLYPH_STEP));
  createEffect(() => {
    const messages = model.chat()?.messages ?? [];
    const top = band() * GLYPH_STEP - 2 * VIEW_H;
    const bottom = band() * GLYPH_STEP + 3 * VIEW_H;
    const ids = new Set(layout().rows.filter((row) => row.y + row.h > top && row.y < bottom).map((row) => row.id));
    const texts = messages.filter((message) => ids.has(message.id)).map(messageTexts);
    if (texts.length === 0) return;
    env.text.want(texts.flatMap((item) => item.text));
    env.bold.want(texts.flatMap((item) => item.bold));
  });
  const ready = () => model.chat()?.status === "ready";
  const pool = createSlotPool(() => (ready() ? layout().rows : NO_ROWS), layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: MESSAGE_MIN_H });
  const lit = highlight(env, layer, "");
  const keys = keyIndex(() => layout().rows);

  // Arrivals at the end follow the reader to the bottom when they were
  // there already; a first page opens at the bottom. Older pages coming in
  // at the top keep the reader's place by moving the scroll by what was
  // added above.
  let arrivals = -1;
  let firstId = "";
  let firstY = 0;
  let lastHeight = 0;
  createEffect(() => {
    const chat = model.chat();
    const current = layout();
    if (!chat || chat.status !== "ready") return;
    // The offset is read untracked: this runs when messages change, not as the list scrolls.
    const atBottom = untrack(layer.offset) + VIEW_H >= lastHeight - 48;
    const first = current.rows[0];
    if (arrivals < 0 || (chat.arrivals !== arrivals && atBottom)) {
      layer.reveal(Math.max(0, current.height - 1), current.height);
    } else if (first && firstId && first.id !== firstId) {
      const moved = current.rows.find((row) => row.id === firstId);
      if (moved) layer.scrollBy(moved.y - firstY);
    }
    arrivals = chat.arrivals;
    firstId = first?.id ?? "";
    firstY = first?.y ?? 0;
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
          <Centered title={`Welcome to #${toAscii(model.chat()?.channel.name ?? "")}`} detail={`This is the start of the channel. Press ${glyph("triangle")} to write the first message.`} press={press} />
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
      if (chat?.status === "error") return [{ id: "chat.retry", x: (W - 120) / 2, y: top + 160 - offset, w: 120, h: 30, run: () => model.reloadChannel() }];
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
    activateLabel: () => "",
    legend: () => [
      { button: "lr", label: "Page" },
      ...(ready() ? [{ button: "triangle" as const, label: "Write" }] : []),
      { button: "square", label: "Reload" },
    ],
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
