// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/discord/model.ts — servers, channels and the open channel's
// messages as signals over the API client, plus the live poll and the
// picture textures.
//
// An open channel shows its newest page; "Load earlier messages" pages back.
// While it is open one poll is always outstanding: the companion holds it
// until a message arrives through its gateway (or POLL_WAIT_S passes), the
// poll appends what it got and starts the next. A failed poll waits
// RETRY_S and tries again, so a dropped link heals by itself.
//
// Avatars and server icons arrive as IMG entries, one at a time behind the
// pages, and are uploaded once each; at most MAX_PICTURES stay, and the rest
// of a busy channel shows initials.

import { createSignal, type Accessor } from "solid-js";
import { after } from "@pocketjs/framework/clock";
import { getOps } from "@pocketjs/framework/host";
import { createDiscordClient, errorText, type Channel, type DiscordClient, type Guild, type Message } from "./api.ts";

export const RETRY_S = 3;
export const MAX_PICTURES = 96;
/** Messages kept for an open channel; older ones are dropped from the top. */
export const MAX_MESSAGES = 300;

export interface ListState<T> {
  status: "loading" | "ready" | "error";
  items: T[];
  error: { title: string; detail: string } | null;
}

export interface ChatState {
  channel: Channel;
  guild: Guild;
  status: "loading" | "ready" | "error";
  messages: Message[];
  error: { title: string; detail: string } | null;
  /** Older messages exist past the first one loaded. */
  more: boolean;
  loadingOlder: boolean;
  /** Bumped when messages arrive at the end (live or sent). */
  arrivals: number;
}

export interface DiscordModel {
  client: DiscordClient;
  guilds: Accessor<ListState<Guild>>;
  loadGuilds(): void;
  guild: Accessor<Guild | null>;
  channels: Accessor<ListState<Channel>>;
  openGuild(guild: Guild): void;
  reloadChannels(): void;
  chat: Accessor<ChatState | null>;
  openChannel(channel: Channel): void;
  closeChannel(): void;
  reloadChannel(): void;
  older(): void;
  /** Send `text` to the open channel; resolves with an error text or "". */
  send(text: string): Promise<string>;
  /** The texture of a picture, or -1 while it loads or when it has none.
   *  Reading it subscribes to `pictures`. */
  picture(kind: "avatar" | "icon", owner: string, hash: string | null): number;
  pictures: Accessor<number>;
}

const LOADING = <T,>(): ListState<T> => ({ status: "loading", items: [], error: null });

export function createDiscordModel(client: DiscordClient = createDiscordClient()): DiscordModel {
  const [guilds, setGuilds] = createSignal<ListState<Guild>>(LOADING());
  const [guild, setGuild] = createSignal<Guild | null>(null);
  const [channels, setChannels] = createSignal<ListState<Channel>>(LOADING());
  const [chat, setChat] = createSignal<ChatState | null>(null, { equals: false });
  const [pictures, setPictures] = createSignal(0);

  let guildRun = 0;
  const loadGuilds = () => {
    const run = ++guildRun;
    setGuilds(LOADING<Guild>());
    client.guilds().then(
      (items) => run === guildRun && setGuilds({ status: "ready", items, error: null }),
      (error: unknown) => run === guildRun && setGuilds({ status: "error", items: [], error: errorText(error) }),
    );
  };

  let channelRun = 0;
  const loadChannels = (target: Guild) => {
    const run = ++channelRun;
    setChannels(LOADING<Channel>());
    client.channels(target.id).then(
      (items) => run === channelRun && setChannels({ status: "ready", items, error: null }),
      (error: unknown) => run === channelRun && setChannels({ status: "error", items: [], error: errorText(error) }),
    );
  };

  // ---- the open channel ----------------------------------------------------------

  let chatRun = 0;
  const append = (state: ChatState, incoming: readonly Message[]) => {
    const known = new Set(state.messages.map((message) => message.id));
    const fresh = incoming.filter((message) => !known.has(message.id));
    if (fresh.length === 0) return;
    state.messages = [...state.messages, ...fresh];
    if (state.messages.length > MAX_MESSAGES) {
      state.messages = state.messages.slice(state.messages.length - MAX_MESSAGES);
      state.more = true;
    }
    state.arrivals++;
    setChat(state);
  };

  const poll = (run: number) => {
    const state = chat();
    if (run !== chatRun || !state) return;
    const last = state.messages[state.messages.length - 1]?.id ?? "0";
    client.poll(state.channel.id, last).then(
      (incoming) => {
        if (run !== chatRun) return;
        append(state, incoming);
        poll(run);
      },
      () => {
        if (run !== chatRun) return;
        after(RETRY_S, () => poll(run));
      },
    );
  };

  const loadChannel = (channel: Channel) => {
    const current = guild();
    if (!current) return;
    const run = ++chatRun;
    const state: ChatState = { channel, guild: current, status: "loading", messages: [], error: null, more: false, loadingOlder: false, arrivals: 0 };
    setChat(state);
    client.messages(channel.id).then(
      (page) => {
        if (run !== chatRun) return;
        state.status = "ready";
        state.messages = page.messages;
        state.more = page.more;
        state.arrivals++;
        setChat(state);
        poll(run);
      },
      (error: unknown) => {
        if (run !== chatRun) return;
        state.status = "error";
        state.error = errorText(error);
        setChat(state);
      },
    );
  };

  // ---- pictures ------------------------------------------------------------------

  const handles = new Map<string, number>();
  const wanted: { key: string; kind: "avatar" | "icon"; owner: string; hash: string }[] = [];
  let fetching = false;
  const nextPicture = () => {
    if (fetching) return;
    const job = wanted.shift();
    if (!job) return;
    fetching = true;
    client.picture(job.kind, job.owner, job.hash).then(
      (entry) => {
        fetching = false;
        const handle = getOps().uploadImgEntry?.(entry) ?? -1;
        handles.set(job.key, handle);
        setPictures(pictures() + 1);
        nextPicture();
      },
      () => {
        fetching = false;
        handles.set(job.key, -1);
        nextPicture();
      },
    );
  };

  return {
    client,
    guilds,
    loadGuilds,
    guild,
    channels,
    openGuild(target) {
      setGuild(target);
      loadChannels(target);
    },
    reloadChannels() {
      const current = guild();
      if (current) loadChannels(current);
    },
    chat,
    openChannel: loadChannel,
    closeChannel() {
      chatRun++;
      setChat(null);
    },
    reloadChannel() {
      const state = chat();
      if (state) loadChannel(state.channel);
    },
    older() {
      const state = chat();
      if (!state || state.status !== "ready" || !state.more || state.loadingOlder) return;
      const run = chatRun;
      state.loadingOlder = true;
      setChat(state);
      client.messages(state.channel.id, state.messages[0]?.id).then(
        (page) => {
          if (run !== chatRun) return;
          const known = new Set(state.messages.map((message) => message.id));
          state.messages = [...page.messages.filter((message) => !known.has(message.id)), ...state.messages];
          state.more = page.more;
          state.loadingOlder = false;
          setChat(state);
        },
        () => {
          if (run !== chatRun) return;
          state.loadingOlder = false;
          setChat(state);
        },
      );
    },
    async send(text) {
      const state = chat();
      const content = text.trim();
      if (!state || !content) return "";
      try {
        const sent = await client.send(state.channel.id, content);
        if (chat() === state) append(state, [sent]);
        return "";
      } catch (error) {
        return errorText(error).detail;
      }
    },
    picture(kind, owner, hash) {
      pictures();
      if (!hash) return -1;
      const key = `${kind}/${owner}/${hash}`;
      const have = handles.get(key);
      if (have !== undefined) return have;
      if (handles.size + wanted.length >= MAX_PICTURES || wanted.some((job) => job.key === key)) return -1;
      wanted.push({ key, kind, owner, hash });
      nextPicture();
      return -1;
    },
    pictures,
  };
}
