// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/maps/api.ts — the companion's maps and store services
// (tools/companion/services/maps.ts and store.ts in PocketJS) through the
// applet's worker (ui/net.ts).
//
// Every request goes to https://companion.pocket/maps/... or /store/...,
// which Pocket Companion on the linked Mac answers. The host's http node
// runs two requests at a time, so tiles, geocodes, the position and the saved view
// share one queue; a geocode, a locate and the store go ahead of tiles, and
// the tiles on screen go ahead of the ring around them. A tile arrives as an
// IMG entry (256x256 RGB565) and becomes a texture here; the newest
// TILE_TEXTURES stay uploaded and the least recently drawn are freed.

import { createSignal } from "solid-js";
import { getOps } from "@pocketjs/framework/host";
import { companionService, fetch, NetError, type NetResponse } from "../ui/net.ts";
import { notLinked, theComputer } from "../ui/companion.ts";

export const MAX_INFLIGHT = 2;
/** Tiles kept as textures: 128 KiB each, the least recently drawn go first. */
export const TILE_TEXTURES = 40;
/** A tile's side in px, and its IMG entry's size: the 8-byte header and RGB565. */
export const TILE = 256;
const TILE_BYTES = 8 + TILE * TILE * 2;

export interface Place {
  name: string;
  lat: number;
  lon: number;
}

export interface Location {
  lat: number;
  lon: number;
  city: string;
}

/** The centre and zoom of the map, as the store keeps them. */
export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
}

/** A failed request: the transport's code, or "service" for an error the daemon sent. */
export class MapsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface Task {
  url: string;
  /** Ahead of the queued tiles; a ring tile goes to the back. */
  rank: "first" | "visible" | "ring";
  /** The tile this task fetches ("z/x/y"), for pruning; "" otherwise. */
  tile: string;
  method?: "POST";
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  resolve: (response: NetResponse) => void;
  reject: (error: MapsError) => void;
}

export interface MapsClient {
  geocode(query: string): Promise<Place[]>;
  locate(): Promise<Location>;
  /** The saved view, or null when none was saved yet. */
  load(): Promise<MapView | null>;
  save(view: MapView): Promise<void>;
  /** Ask for a tile; `tiles()` changes when one arrives. A visible tile goes
   *  ahead of a ring tile in the queue. */
  want(z: number, x: number, y: number, visible: boolean): void;
  /** The tile's texture handle, or -1 until it arrives; a drawn tile is the
   *  last to be freed. */
  tile(z: number, x: number, y: number): number;
  /** Keep a tile that stays on screen last in line to be freed. */
  touch(key: string): void;
  /** A tile is uploaded (no request needed). */
  has(z: number, x: number, y: number): boolean;
  /** Drop the queued (not started) requests for tiles outside `keep`. */
  prune(keep: ReadonlySet<string>): void;
  tiles: () => number;
  inflight(): number;
}

export const tileKey = (z: number, x: number, y: number): string => `${z}/${x}/${y}`;

export function createMapsClient(): MapsClient {
  const queue: Task[] = [];
  let running = 0;
  const textures = new Map<string, number>();
  const asked = new Set<string>();
  const [tiles, setTiles] = createSignal(0);

  const pump = () => {
    while (running < MAX_INFLIGHT && queue.length > 0) {
      const task = queue.shift()!;
      running++;
      fetch(task.url, {
        timeoutMs: task.timeoutMs,
        maxBytes: task.maxBytes,
        ...(task.method ? { method: task.method, headers: { "content-type": "application/json" }, body: task.body ?? "" } : {}),
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
            task.reject(new MapsError("service", message));
          }
          pump();
        },
        (error: unknown) => {
          running--;
          const code = error instanceof NetError ? error.code : "other";
          task.reject(new MapsError(code, error instanceof Error ? error.message : String(error)));
          pump();
        },
      );
    }
  };

  const RANK = { first: 0, visible: 1, ring: 2 } as const;
  const request = (url: string, options: { rank: Task["rank"]; tile?: string; body?: string; timeoutMs?: number; maxBytes?: number }) =>
    new Promise<NetResponse>((resolve, reject) => {
      const task: Task = {
        url,
        rank: options.rank,
        tile: options.tile ?? "",
        ...(options.body !== undefined ? { method: "POST" as const, body: options.body } : {}),
        timeoutMs: options.timeoutMs ?? 30_000,
        maxBytes: options.maxBytes ?? 64 * 1024,
        resolve,
        reject,
      };
      // Behind the queued tasks of its rank, ahead of the lower ranks.
      const at = queue.findIndex((queued) => RANK[queued.rank] > RANK[task.rank]);
      queue.splice(at < 0 ? queue.length : at, 0, task);
      pump();
    });

  const json = async <T>(url: string, options: { body?: string; timeoutMs?: number } = {}): Promise<T> =>
    JSON.parse(await (await request(url, { rank: "first", ...options })).text()) as T;

  const isView = (value: unknown): value is MapView => {
    const v = value as Partial<MapView> | null;
    return !!v && typeof v === "object" && Number.isFinite(v.lat) && Number.isFinite(v.lon) && Number.isFinite(v.zoom);
  };

  return {
    geocode: async (query) => {
      const value = await json<{ items?: Place[] }>(companionService("maps", `/geocode?q=${encodeURIComponent(query)}`), { timeoutMs: 30_000 });
      return Array.isArray(value.items) ? value.items.filter((item) => item && typeof item.name === "string" && Number.isFinite(item.lat) && Number.isFinite(item.lon)) : [];
    },
    locate: async () => {
      const value = await json<Partial<Location>>(companionService("maps", "/locate"), { timeoutMs: 20_000 });
      if (!Number.isFinite(value.lat) || !Number.isFinite(value.lon)) throw new MapsError("service", "No position came back.");
      return { lat: value.lat!, lon: value.lon!, city: typeof value.city === "string" ? value.city : "" };
    },
    load: async () => {
      const value = await json<{ value?: unknown }>(companionService("store", "/get?name=maps"), { timeoutMs: 10_000 });
      return isView(value.value) ? { lat: value.value.lat, lon: value.value.lon, zoom: value.value.zoom } : null;
    },
    save: async (view) => {
      await json<{ ok?: boolean }>(companionService("store", "/set?name=maps"), { body: JSON.stringify(view), timeoutMs: 10_000 });
    },
    want(z, x, y, visible) {
      const key = tileKey(z, x, y);
      if (asked.has(key) || textures.has(key)) return;
      asked.add(key);
      request(companionService("maps", `/tile?z=${z}&x=${x}&y=${y}`), { rank: visible ? "visible" : "ring", tile: key, timeoutMs: 40_000, maxBytes: TILE_BYTES + 1024 }).then(
        async (response) => {
          asked.delete(key);
          const handle = getOps().uploadImgEntry?.(await response.bytes()) ?? -1;
          if (handle < 0) return;
          textures.set(key, handle);
          while (textures.size > TILE_TEXTURES) {
            const [oldest, old] = textures.entries().next().value as [string, number];
            textures.delete(oldest);
            getOps().freeTexture?.(old);
          }
          setTiles(tiles() + 1);
        },
        () => asked.delete(key),
      );
    },
    tile(z, x, y) {
      const key = tileKey(z, x, y);
      const handle = textures.get(key);
      if (handle === undefined) return -1;
      // Recently drawn tiles are the last to be freed.
      textures.delete(key);
      textures.set(key, handle);
      return handle;
    },
    touch(key) {
      const handle = textures.get(key);
      if (handle === undefined) return;
      textures.delete(key);
      textures.set(key, handle);
    },
    has: (z, x, y) => textures.has(tileKey(z, x, y)),
    prune(keep) {
      for (let index = queue.length - 1; index >= 0; index--) {
        const task = queue[index]!;
        if (!task.tile || keep.has(task.tile)) continue;
        queue.splice(index, 1);
        asked.delete(task.tile);
        task.reject(new MapsError("cancelled", "the tile left the view"));
      }
    },
    tiles,
    inflight: () => running,
  };
}

/** The message a viewer sees for a failed request. */
export function errorText(error: unknown): string {
  const code = error instanceof MapsError ? error.code : "";
  if (code === "unavailable") return notLinked("Maps").detail;
  if (code === "timeout") return `${theComputer()} or OpenStreetMap did not answer in time.`;
  const message = error instanceof Error ? error.message : String(error);
  return message || "The request failed.";
}
