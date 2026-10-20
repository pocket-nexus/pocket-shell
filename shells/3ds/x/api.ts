// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/x/api.ts — X through the linked Mac's companion service
// (PocketJS tools/companion/services/x.ts) at https://companion.pocket/x/.
//
// The Mac holds the X session; the console asks for a page of the timeline,
// a thread or an avatar and gets compact JSON (an avatar: a 32x32 IMG entry
// the console uploads as a texture), and likes, reposts and replies through
// it. Requests share one queue of at most
// MAX_INFLIGHT, the NET module's limit; avatars wait behind pages.

import { fetch, NetError } from "@pocketjs/framework/net";
import { companionService } from "@pocketjs/framework/link";
import { GLYPH_ATLAS_URL } from "../ui/glyphs.ts";

export const MAX_INFLIGHT = 2;
/** A first request can wait while the Mac reads x.com's client. */
const PAGE_TIMEOUT_MS = 90_000;

export type Kind = "following" | "foryou";
export const KINDS: readonly { id: Kind; label: string }[] = [
  { id: "following", label: "Following" },
  { id: "foryou", label: "For You" },
];

export interface Post {
  id: string;
  name: string;
  handle: string;
  text: string;
  time: number;
  replies: number;
  reposts: number;
  likes: number;
  /** The signed-in account liked or reposted it. */
  liked?: boolean;
  reposted?: boolean;
  views?: number;
  replyTo?: string;
  repostedBy?: string;
  quote?: { name: string; handle: string; text: string };
  media?: { count: number; kind: "photo" | "video" | "gif" };
  avatar?: string;
}

export interface Page {
  posts: Post[];
  cursor: string | null;
}

export interface Thread {
  post: Post | null;
  before: Post[];
  replies: Post[];
  cursor: string | null;
}

/** A failed request: "signed-out" (no X session on the Mac), "unavailable"
 *  (no Mac linked), "timeout", "api" (X refused or changed), "other". */
export class XError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type Action = "like" | "unlike" | "repost" | "unrepost";

interface Task {
  path: string;
  /** A full URL instead of an x service path (the glyphs service). */
  url?: string;
  method?: "POST";
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  binary: boolean;
  resolve: (value: unknown) => void;
  reject: (error: XError) => void;
}

export interface XClient {
  timeline(kind: Kind, cursor?: string | null): Promise<Page>;
  thread(id: string, cursor?: string | null): Promise<Thread>;
  /** The avatar's IMG entry bytes. */
  avatar(url: string): Promise<Uint8Array>;
  act(action: Action, id: string): Promise<void>;
  /** A glyph atlas from the companion's glyphs service, in this queue. */
  atlas(body: string): Promise<Uint8Array>;
  /** Reply to post `id`; the new post when X returned it. */
  reply(id: string, text: string): Promise<Post | null>;
  inflight(): number;
  peak(): number;
}

export function createXClient(): XClient {
  const queue: Task[] = [];
  let running = 0;
  let peak = 0;

  const pump = () => {
    while (running < MAX_INFLIGHT && queue.length > 0) {
      const task = queue.shift()!;
      running++;
      peak = Math.max(peak, running);
      fetch(task.url ?? companionService("x", task.path), {
        timeoutMs: task.timeoutMs,
        maxBytes: task.maxBytes,
        ...(task.method ? { method: task.method, headers: { "content-type": "application/json" }, body: task.body ?? "" } : {}),
      }).then(
        async (response) => {
          running--;
          pump();
          if (task.binary) {
            if (!response.ok) task.reject(new XError("api", `HTTP ${response.status}`));
            else task.resolve(await response.bytes());
            return;
          }
          let body: { error?: string; message?: string } & Record<string, unknown>;
          try {
            body = await response.json();
          } catch {
            task.reject(new XError("api", `The Mac answered ${response.status} without JSON.`));
            return;
          }
          if (!response.ok) task.reject(new XError(body.error === "signed-out" ? "signed-out" : "api", body.message ?? `HTTP ${response.status}`));
          else task.resolve(body);
        },
        (error: unknown) => {
          running--;
          pump();
          const code = error instanceof NetError ? error.code : "other";
          task.reject(new XError(code, error instanceof Error ? error.message : String(error)));
        },
      );
    }
  };

  const request = <T,>(path: string, options: { urgent?: boolean; binary?: boolean; timeoutMs?: number; maxBytes?: number; body?: string; url?: string } = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const task: Task = {
        path,
        ...(options.url ? { url: options.url } : {}),
        ...(options.body !== undefined ? { method: "POST" as const, body: options.body } : {}),
        timeoutMs: options.timeoutMs ?? PAGE_TIMEOUT_MS,
        maxBytes: options.maxBytes ?? 256 * 1024,
        binary: options.binary ?? false,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (options.urgent) queue.unshift(task);
      else queue.push(task);
      pump();
    });

  const withCursor = (path: string, cursor?: string | null) => (cursor ? `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : path);

  return {
    timeline: (kind, cursor) => request<Page>(withCursor(`/timeline?kind=${kind}`, cursor), { urgent: true }),
    thread: (id, cursor) => request<Thread>(withCursor(`/post/${id}`, cursor), { urgent: true }),
    avatar: (url) => request<Uint8Array>(`/avatar?u=${encodeURIComponent(url)}`, { binary: true, timeoutMs: 20_000, maxBytes: 8 * 1024 }),
    atlas: (body) => request<Uint8Array>("", { url: GLYPH_ATLAS_URL, body, binary: true, timeoutMs: 20_000, maxBytes: 256 * 1024 }),
    act: (action, id) => request<unknown>(`/${action}?id=${id}`, { urgent: true, body: "", timeoutMs: 30_000 }).then(() => undefined),
    reply: (id, text) =>
      request<{ post?: Post }>("/reply", { urgent: true, body: JSON.stringify({ id, text }), timeoutMs: 30_000 }).then((answer) => answer.post ?? null),
    inflight: () => running,
    peak: () => peak,
  };
}

/** The message a reader sees for a failed request. */
export function errorText(error: unknown): { title: string; detail: string } {
  const code = error instanceof XError ? error.code : "";
  if (code === "signed-out") {
    return { title: "Not signed in to X", detail: "Sign in on your Mac: bun tools/companion.ts service x login" };
  }
  if (code === "unavailable") {
    return { title: "Not linked to a Mac", detail: "X loads through your Mac. Pair one in Settings > Mac and open Pocket Companion." };
  }
  if (code === "timeout") return { title: "The request timed out", detail: "The Mac or X did not answer in time." };
  const message = error instanceof Error ? error.message : String(error);
  return { title: "Could not load X", detail: message || "The request failed." };
}
