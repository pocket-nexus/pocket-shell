// SPDX-License-Identifier: GPL-3.0-or-later
// applets/kit/images.ts — pictures from the network as textures, through the
// `images` service (QuickJS has no image decoder). Four at a time, the newest
// first, the least recently drawn freed past LIMIT.
import { createSignal } from "solid-js";
import { getOps } from "@pocketjs/framework/host";
import { companionService, fetch } from "./platform.tsx";

const LIMIT = 64;
const AT_ONCE = 4;

export interface Images {
  /** The texture for `url`, or -1 until it arrives: read `revision()` to hear of it.
   *  `round` cuts a circle, for an avatar. */
  texture(url: string, side: number, round?: boolean): number;
  revision: () => number;
}

export function createImages(): Images {
  const textures = new Map<string, number>();
  const asked = new Set<string>();
  const waiting: { key: string; url: string; side: number; round: boolean }[] = [];
  const [revision, setRevision] = createSignal(0);
  let running = 0;
  const pump = () => {
    while (running < AT_ONCE && waiting.length > 0) {
      const job = waiting.pop()!;
      running++;
      const path = `/fetch?url=${encodeURIComponent(job.url)}&w=${job.side}&h=${job.side}${job.round ? "&round=1" : ""}`;
      fetch(companionService("images", path), { timeoutMs: 30_000, maxBytes: 8 + job.side * job.side * 4 + 64 }).then(
        async (response) => {
          running--;
          const handle = response.ok ? getOps().uploadImgEntry?.(await response.bytes()) ?? -1 : -1;
          if (handle >= 0) {
            textures.set(job.key, handle);
            while (textures.size > LIMIT) {
              const [oldest, old] = textures.entries().next().value as [string, number];
              textures.delete(oldest);
              getOps().freeTexture?.(old);
            }
            setRevision(revision() + 1);
          }
          pump();
        },
        () => {
          running--;
          asked.delete(job.key);
          pump();
        },
      );
    }
  };
  return {
    revision,
    texture(url, side, round = false) {
      const key = `${side}:${round ? 1 : 0}:${url}`;
      const have = textures.get(key);
      if (have !== undefined) {
        textures.delete(key);
        textures.set(key, have);
        return have;
      }
      if (!asked.has(key)) {
        asked.add(key);
        waiting.push({ key, url, side, round });
        pump();
      }
      return -1;
    },
  };
}
