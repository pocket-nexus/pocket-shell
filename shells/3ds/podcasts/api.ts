// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/podcasts/api.ts — the companion's podcasts service
// (tools/companion/services/podcasts.ts in PocketJS) and its store service
// (services/store.ts) over @pocketjs/framework/net.
//
// Every request goes to https://companion.pocket/podcasts/... or
// https://companion.pocket/store/..., which omarchy-pocketd answers on this
// device. The NET module admits two requests at a time, so searches, feeds,
// playback, the library and artwork share one queue; the first four go
// ahead of artwork. Artwork arrives as an IMG entry (a square RGB565
// picture, 128 for a row or 256 for a page) and becomes a texture here; the
// newest ART_TEXTURES stay uploaded and older ones are freed.

import { createSignal } from "solid-js";
import { getOps } from "@pocketjs/framework/host";
import { fetch, NetError, type PocketResponse } from "@pocketjs/framework/net";
import { companionService } from "@pocketjs/framework/link";
import { theComputer } from "../ui/companion.ts";

export const MAX_INFLIGHT = 2;
export const ART_TEXTURES = 40;
/** The artwork sizes the service renders. */
export const ART_ROW = 128;
export const ART_LARGE = 256;
export type ArtSize = typeof ART_ROW | typeof ART_LARGE;
/** The store document the library lives in. */
const LIBRARY_NAME = "podcasts";
/** Positions kept for episodes played, newest last. */
export const POSITIONS_KEPT = 200;

export interface Show {
  id: string;
  title: string;
  author: string;
  feedUrl: string;
  /** The artwork's URL, for `want()`; "" when the feed names none. */
  artwork: string;
}

export interface Episode {
  guid: string;
  title: string;
  /** Milliseconds since the epoch; 0 when the feed gives no date. */
  published: number;
  /** Seconds; 0 when the feed gives no duration. */
  durationS: number;
  audioUrl: string;
  /** Plain text, at most 1000 characters. */
  description: string;
}

export interface Feed {
  title: string;
  author: string;
  artwork: string;
  episodes: Episode[];
}

export interface PlayInfo {
  source: { host: string; port: number; token: string };
  durationS: number;
  position: number;
}

/** What the store keeps: the subscriptions and where each episode stopped. */
export interface Library {
  subscriptions: Show[];
  /** Seconds into the episode, by its audio URL. */
  positions: Record<string, number>;
}

/** A failed request: the NET code, or "service" for an error the daemon sent. */
export class PodcastError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface Task {
  url: string;
  urgent: boolean;
  timeoutMs: number;
  maxBytes: number;
  body?: string;
  resolve: (response: PocketResponse) => void;
  reject: (error: PodcastError) => void;
}

export interface PodcastClient {
  search(query: string): Promise<Show[]>;
  episodes(feedUrl: string): Promise<Feed>;
  play(audioUrl: string, at: number, durationS: number): Promise<PlayInfo>;
  stop(): void;
  /** The library from the store; null when none was saved yet. */
  library(): Promise<Library | null>;
  save(library: Library): Promise<void>;
  /** Ask for a picture; `arts()` changes when one arrives. */
  want(url: string, size: ArtSize): void;
  art(url: string, size: ArtSize): number;
  arts: () => number;
  inflight(): number;
}

const isShow = (value: unknown): value is Show => {
  const show = value as Partial<Show> | null;
  return !!show && typeof show.feedUrl === "string" && typeof show.title === "string";
};

/** A library document as the store returned it, with every field in shape. */
export function readLibrary(value: unknown): Library | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<Library>;
  const subscriptions = Array.isArray(raw.subscriptions)
    ? raw.subscriptions.filter(isShow).map((show) => ({ id: String(show.id ?? show.feedUrl), title: show.title, author: show.author ?? "", feedUrl: show.feedUrl, artwork: show.artwork ?? "" }))
    : [];
  const positions: Record<string, number> = {};
  if (raw.positions && typeof raw.positions === "object") {
    for (const [url, seconds] of Object.entries(raw.positions)) if (typeof seconds === "number" && seconds >= 0) positions[url] = seconds;
  }
  return { subscriptions, positions };
}

export function createPodcastClient(): PodcastClient {
  const queue: Task[] = [];
  let running = 0;
  const textures = new Map<string, number>();
  const asked = new Set<string>();
  const [arts, setArts] = createSignal(0);

  const pump = () => {
    while (running < MAX_INFLIGHT && queue.length > 0) {
      const task = queue.shift()!;
      running++;
      fetch(task.url, {
        timeoutMs: task.timeoutMs,
        maxBytes: task.maxBytes,
        ...(task.body !== undefined ? { method: "POST" as const, headers: { "content-type": "application/json" }, body: task.body } : {}),
      }).then(
        async (response) => {
          running--;
          if (response.ok) task.resolve(response);
          else {
            let message = `${theComputer()} answered ${response.status}.`;
            try {
              const body = JSON.parse(await response.text()) as { error?: string };
              if (body.error) message = body.error;
            } catch {
              // Not JSON: keep the status.
            }
            task.reject(new PodcastError("service", message));
          }
          pump();
        },
        (error: unknown) => {
          running--;
          const code = error instanceof NetError ? error.code : "other";
          task.reject(new PodcastError(code, error instanceof Error ? error.message : String(error)));
          pump();
        },
      );
    }
  };

  const request = (url: string, urgent: boolean, timeoutMs: number, maxBytes: number, body?: string) =>
    new Promise<PocketResponse>((resolve, reject) => {
      const task: Task = { url, urgent, timeoutMs, maxBytes, body, resolve, reject };
      if (urgent) {
        const at = queue.findIndex((queued) => !queued.urgent);
        queue.splice(at < 0 ? queue.length : at, 0, task);
      } else queue.push(task);
      pump();
    });

  const json = async <T>(service: string, path: string, timeoutMs = 60_000, body?: string): Promise<T> =>
    JSON.parse(await (await request(service === "store" ? companionService("store", path) : companionService("podcasts", path), true, timeoutMs, 256 * 1024, body)).text()) as T;

  return {
    search: async (query) => {
      const value = await json<{ items?: Show[] }>("podcasts", `/search?q=${encodeURIComponent(query)}`);
      return Array.isArray(value.items) ? value.items.filter(isShow) : [];
    },
    episodes: async (feedUrl) => {
      const value = await json<Partial<Feed>>("podcasts", `/episodes?feed=${encodeURIComponent(feedUrl)}`);
      return { title: value.title ?? "", author: value.author ?? "", artwork: value.artwork ?? "", episodes: Array.isArray(value.episodes) ? value.episodes : [] };
    },
    play: (audioUrl, at, durationS) =>
      json<PlayInfo>("podcasts", `/play?url=${encodeURIComponent(audioUrl)}&at=${Math.max(0, Math.floor(at))}&duration=${Math.max(0, Math.floor(durationS))}`, 90_000),
    stop() {
      void request(companionService("podcasts", "/stop"), true, 10_000, 1024).catch(() => undefined);
    },
    library: async () => readLibrary((await json<{ value?: unknown }>("store", `/get?name=${LIBRARY_NAME}`, 20_000)).value),
    save: async (library) => {
      await json<unknown>("store", `/set?name=${LIBRARY_NAME}`, 20_000, JSON.stringify(library));
    },
    want(url, size) {
      const key = `${size}:${url}`;
      if (!url || asked.has(key)) return;
      asked.add(key);
      request(companionService("podcasts", `/art?url=${encodeURIComponent(url)}&size=${size}`), false, 30_000, 8 + size * size * 2 + 64).then(
        async (response) => {
          const handle = getOps().uploadImgEntry?.(await response.bytes()) ?? -1;
          if (handle < 0) return;
          textures.set(key, handle);
          while (textures.size > ART_TEXTURES) {
            const [oldest, old] = textures.entries().next().value as [string, number];
            textures.delete(oldest);
            asked.delete(oldest);
            getOps().freeTexture?.(old);
          }
          setArts(arts() + 1);
        },
        () => asked.delete(key),
      );
    },
    art(url, size) {
      const key = `${size}:${url}`;
      const handle = textures.get(key);
      if (handle === undefined) return -1;
      // Recently drawn pictures are the last to be freed.
      textures.delete(key);
      textures.set(key, handle);
      return handle;
    },
    arts,
    inflight: () => running,
  };
}

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** "12:34" or "1:02:03". */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const s = whole % 60, m = Math.floor(whole / 60) % 60, h = Math.floor(whole / 3600);
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "1h 2m", "42m", "" for 0. */
export function lengthText(seconds: number): string {
  if (!seconds) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "1m";
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 28" in the current year, "Oct 28, 2025" in another; "" for 0. */
export function dateText(ms: number, now: number): string {
  if (!ms) return "";
  const date = new Date(ms), year = new Date(now).getFullYear();
  const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === year ? day : `${day}, ${date.getFullYear()}`;
}
