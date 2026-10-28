// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/youtube/api.ts — the companion's youtube service
// (tools/companion/services/youtube.ts in PocketJS) over @pocketjs/framework/net.
//
// Every request goes to https://companion.pocket/youtube/..., which the
// linked Mac answers with yt-dlp and ffmpeg. The NET module admits two
// requests at a time, so lists, playback and thumbnails share one queue;
// lists and playback go ahead of thumbnails. A thumbnail arrives as an IMG
// entry (128x64 RGB565) and becomes a texture here; the newest
// THUMB_TEXTURES stay uploaded and older ones are freed.

import { createSignal } from "solid-js";
import { getOps } from "@pocketjs/framework/host";
import { companionService } from "@pocketjs/framework/link";
import { fetch, NetError, type PocketResponse } from "@pocketjs/framework/net";
import { theComputer } from "../ui/companion.ts";
export const MAX_INFLIGHT = 2;
export const THUMB_TEXTURES = 40;

export interface Video {
  id: string;
  title: string;
  channel: string;
  /** Seconds; 0 when live or unknown. */
  duration: number;
  views: number;
}

export type Codec = "h264" | "pal8";

export interface PlayInfo {
  source: { host: string; port: number; token: string };
  codec: Codec;
  fps: number;
  /** The picture's size at the top-left of the 512x256 media texture. */
  frameW: number;
  frameH: number;
  durationS: number;
  position: number;
  title: string;
}

export type Topic = "tech" | "music" | "gaming" | "news";
export const TOPICS: readonly { id: Topic; label: string }[] = [
  { id: "tech", label: "Tech" },
  { id: "music", label: "Music" },
  { id: "gaming", label: "Gaming" },
  { id: "news", label: "News" },
];

/** A failed request: the NET code, or "service" for an error the Mac sent. */
export class YtError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface Task {
  path: string;
  urgent: boolean;
  timeoutMs: number;
  maxBytes: number;
  resolve: (response: PocketResponse) => void;
  reject: (error: YtError) => void;
}

export interface YtClient {
  feed(topic: Topic): Promise<Video[]>;
  search(query: string): Promise<Video[]>;
  play(id: string, codec: Codec, at: number): Promise<PlayInfo>;
  stop(): void;
  /** Ask for a thumbnail; `thumbs()` changes when one arrives. */
  want(id: string): void;
  thumb(id: string): number;
  thumbs: () => number;
  inflight(): number;
}

export function createYtClient(): YtClient {
  const queue: Task[] = [];
  let running = 0;
  const textures = new Map<string, number>();
  const asked = new Set<string>();
  const [thumbs, setThumbs] = createSignal(0);

  const pump = () => {
    while (running < MAX_INFLIGHT && queue.length > 0) {
      const task = queue.shift()!;
      running++;
      fetch(companionService("youtube", task.path), { timeoutMs: task.timeoutMs, maxBytes: task.maxBytes }).then(
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
            task.reject(new YtError("service", message));
          }
          pump();
        },
        (error: unknown) => {
          running--;
          const code = error instanceof NetError ? error.code : "other";
          task.reject(new YtError(code, error instanceof Error ? error.message : String(error)));
          pump();
        },
      );
    }
  };

  const request = (path: string, urgent: boolean, timeoutMs: number, maxBytes: number) =>
    new Promise<PocketResponse>((resolve, reject) => {
      const task: Task = { path, urgent, timeoutMs, maxBytes, resolve, reject };
      if (urgent) {
        const at = queue.findIndex((queued) => !queued.urgent);
        queue.splice(at < 0 ? queue.length : at, 0, task);
      } else queue.push(task);
      pump();
    });

  const json = async <T>(path: string, timeoutMs = 60_000): Promise<T> =>
    JSON.parse(await (await request(path, true, timeoutMs, 128 * 1024)).text()) as T;

  const items = (value: { items?: Video[] }) => (Array.isArray(value.items) ? value.items : []);

  return {
    feed: async (topic) => items(await json<{ items?: Video[] }>(`/feed?topic=${topic}`)),
    search: async (query) => items(await json<{ items?: Video[] }>(`/search?q=${encodeURIComponent(query)}`)),
    play: (id, codec, at) => json<PlayInfo>(`/play?id=${id}&codec=${codec}&at=${Math.max(0, Math.floor(at))}`, 90_000),
    stop() {
      void request("/stop", true, 10_000, 1024).catch(() => undefined);
    },
    want(id) {
      if (asked.has(id)) return;
      asked.add(id);
      request(`/thumb?id=${id}`, false, 30_000, 32 * 1024).then(
        async (response) => {
          const handle = getOps().uploadImgEntry?.(await response.bytes()) ?? -1;
          if (handle < 0) return;
          textures.set(id, handle);
          while (textures.size > THUMB_TEXTURES) {
            const [oldest, old] = textures.entries().next().value as [string, number];
            textures.delete(oldest);
            asked.delete(oldest);
            getOps().freeTexture?.(old);
          }
          setThumbs(thumbs() + 1);
        },
        () => asked.delete(id),
      );
    },
    thumb(id) {
      const handle = textures.get(id);
      if (handle === undefined) return -1;
      // Recently drawn thumbnails are the last to be freed.
      textures.delete(id);
      textures.set(id, handle);
      return handle;
    },
    thumbs,
    inflight: () => running,
  };
}

/** "12:34" or "1:02:03"; "LIVE" for 0. */
export function durationText(seconds: number): string {
  if (!seconds) return "LIVE";
  const s = Math.floor(seconds % 60), m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "1.2M views", "830K views", "41 views". */
export function viewsText(views: number): string {
  const unit = (n: number, suffix: string) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}${suffix}`;
  const count = views >= 1e9 ? unit(views / 1e9, "B") : views >= 1e6 ? unit(views / 1e6, "M") : views >= 1e3 ? unit(views / 1e3, "K") : String(views);
  return `${count} ${views === 1 ? "view" : "views"}`;
}
