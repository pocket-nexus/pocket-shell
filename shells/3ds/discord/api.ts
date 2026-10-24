// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/discord/api.ts — the companion's discord service
// (https://companion.pocket/discord/…, PocketJS tools/companion/services/
// discord.ts) over @pocketjs/framework/net.
//
// The bot and its token live on the Mac; the console asks the companion for
// servers, channels and messages and gets plain JSON, and for avatars and
// server icons as IMG entries it uploads as textures. The NET module admits
// two requests at a time: pages go first, pictures after them, and the live
// poll of an open channel takes one slot for up to POLL_WAIT_S seconds.

import { fetch, NetError } from "@pocketjs/framework/net";
import { companionService } from "@pocketjs/framework/link";
import { GLYPH_ATLAS_URL } from "../ui/glyphs.ts";
import { notLinked, tethered, theComputer, yourComputer } from "../ui/companion.ts";

export const MAX_INFLIGHT = 2;
/** How long the companion holds a poll open waiting for a new message. */
export const POLL_WAIT_S = 8;

export interface Guild {
  id: string;
  name: string;
  icon: string | null;
}

export interface Channel {
  id: string;
  name: string;
  category: string | null;
  topic: string;
}

export interface Message {
  id: string;
  author: { id: string; name: string; avatar: string | null; bot: boolean };
  content: string;
  time: number;
  when: string;
  edited: boolean;
  attachments: number;
  replyTo: { author: string; content: string } | null;
  system: boolean;
}

/** A failed request: the NET error code, "setup" when Discord is not set up
 *  on the Mac, or "http". */
export class DiscordError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface Task {
  url: string;
  method: "GET" | "POST";
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  binary: boolean;
  resolve: (value: unknown) => void;
  reject: (error: DiscordError) => void;
}

export interface DiscordClient {
  guilds(): Promise<Guild[]>;
  channels(guild: string): Promise<Channel[]>;
  /** The newest page, or the page before `before`; oldest first. */
  messages(channel: string, before?: string): Promise<{ messages: Message[]; more: boolean }>;
  /** Messages after `after`, waiting up to POLL_WAIT_S for one to arrive. */
  poll(channel: string, after: string): Promise<Message[]>;
  send(channel: string, content: string): Promise<Message>;
  /** An avatar or server icon as an IMG entry. */
  picture(kind: "avatar" | "icon", owner: string, hash: string): Promise<Uint8Array>;
  /** A glyph atlas from the companion's glyphs service, in this queue. */
  atlas(body: string): Promise<Uint8Array>;
  /** Requests in flight (tests: never above MAX_INFLIGHT). */
  inflight(): number;
  peak(): number;
}

export function createDiscordClient(): DiscordClient {
  const queue: Task[] = [];
  let running = 0;
  let peak = 0;

  const pump = () => {
    while (running < MAX_INFLIGHT && queue.length > 0) {
      const task = queue.shift()!;
      running++;
      peak = Math.max(peak, running);
      fetch(task.url, {
        method: task.method,
        timeoutMs: task.timeoutMs,
        maxBytes: task.maxBytes,
        ...(task.body !== undefined ? { body: task.body, headers: { "content-type": "application/json" } } : {}),
      }).then(
        async (response) => {
          running--;
          pump();
          try {
            if (task.binary) {
              if (!response.ok) throw new DiscordError("http", `HTTP ${response.status}`);
              task.resolve(await response.bytes());
              return;
            }
            const payload = (await response.json()) as { error?: string; setup?: string };
            if (response.status === 409) throw new DiscordError("setup", payload.setup ?? "");
            if (!response.ok) throw new DiscordError("http", payload.error ?? `HTTP ${response.status}`);
            task.resolve(payload);
          } catch (error) {
            task.reject(error instanceof DiscordError ? error : new DiscordError("protocol", "The answer was not JSON."));
          }
        },
        (error: unknown) => {
          running--;
          pump();
          const code = error instanceof NetError ? error.code : "other";
          task.reject(new DiscordError(code, error instanceof Error ? error.message : String(error)));
        },
      );
    }
  };

  const request = <T,>(path: string, options: { method?: "GET" | "POST"; body?: unknown; urgent?: boolean; timeoutMs?: number; binary?: boolean; url?: string; maxBytes?: number } = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const task: Task = {
        url: options.url ?? companionService("discord", path),
        method: options.method ?? "GET",
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        timeoutMs: options.timeoutMs ?? 20_000,
        maxBytes: options.maxBytes ?? 192 * 1024,
        binary: options.binary ?? false,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (options.urgent) queue.unshift(task);
      else queue.push(task);
      pump();
    });

  return {
    guilds: () => request<{ guilds: Guild[] }>("/guilds", { urgent: true }).then((answer) => answer.guilds ?? []),
    channels: (guild) => request<{ channels: Channel[] }>(`/guilds/${guild}/channels`, { urgent: true }).then((answer) => answer.channels ?? []),
    messages: (channel, before) =>
      request<{ messages: Message[]; more: boolean }>(`/channels/${channel}/messages${before ? `?before=${before}` : ""}`, { urgent: true }).then((answer) => ({
        messages: answer.messages ?? [],
        more: !!answer.more,
      })),
    poll: (channel, after) =>
      request<{ messages: Message[] }>(`/channels/${channel}/messages?after=${after}&wait=${POLL_WAIT_S}`, { timeoutMs: (POLL_WAIT_S + 12) * 1000 }).then(
        (answer) => answer.messages ?? [],
      ),
    send: (channel, content) =>
      request<{ message: Message }>(`/channels/${channel}/messages`, { method: "POST", body: { content }, urgent: true }).then((answer) => answer.message),
    picture: (kind, owner, hash) => request<Uint8Array>(`/${kind}/${owner}/${hash}`, { binary: true }),
    atlas: (body) => request<Uint8Array>("", { url: GLYPH_ATLAS_URL, method: "POST", body: JSON.parse(body) as unknown, binary: true, maxBytes: 256 * 1024 }),
    inflight: () => running,
    peak: () => peak,
  };
}

/** The message a reader sees for a failed request. */
export function errorText(error: unknown): { title: string; detail: string } {
  const code = error instanceof DiscordError ? error.code : "";
  if (code === "setup") {
    return {
      title: `Set up Discord on ${yourComputer()}`,
      detail: `Create a bot in the Discord developer portal, invite it to your servers, then on ${tethered() ? yourComputer() : "the Mac"} run: bun tools/companion.ts service discord token <bot-token>`,
    };
  }
  if (code === "unavailable") {
    return notLinked("Discord", "runs");
  }
  if (code === "timeout") return { title: "The request timed out", detail: `${theComputer()} or Discord did not answer in time.` };
  const message = error instanceof Error ? error.message : String(error);
  return { title: "Could not load", detail: message || "The request failed." };
}
