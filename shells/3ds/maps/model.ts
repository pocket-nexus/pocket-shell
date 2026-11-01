// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/maps/model.ts — what the Maps applet shows: the view (a centre and
// a zoom in Web Mercator), the marker a search dropped, the search words and
// their results, and a notice line. The model outlives a remount
// (ui/keep.ts), so a drag's centre and a search's results carry over.
//
// The view is saved to the companion's store (name "maps") once it has
// rested SAVE_AFTER_S after a pan, a zoom, a locate or a chosen result, and
// restored on the first start; without a saved view the daemon's position
// (/locate) is the start, and without that the whole world at zoom 3.

import { createSignal, type Accessor } from "solid-js";
import { after } from "@pocketjs/framework/clock";
import { errorText, type MapsClient, type MapView, type Place, TILE } from "./api.ts";
import { yourComputer } from "../ui/companion.ts";

export const MIN_ZOOM = 3;
export const MAX_ZOOM = 17;
/** Web Mercator's edge: past it the projection runs off to infinity. */
export const MAX_LAT = 85.05112878;
/** The zoom a located or chosen place is shown at, when the view was wider. */
const PLACE_ZOOM = 13;
const LOCATE_ZOOM = 11;
const SAVE_AFTER_S = 1;
const NOTICE_S = 3;
const WORLD: MapView = { lat: 20, lon: 0, zoom: MIN_ZOOM };

export interface ResultsState {
  status: "idle" | "loading" | "ready" | "error";
  items: readonly Place[];
  error: string;
}

export interface MapsModel {
  view: Accessor<MapView>;
  /** Move the centre by a travel in screen px at the current zoom. */
  panBy(dx: number, dy: number): void;
  /** Zoom in (+1) or out (-1) about the centre. */
  zoomBy(step: number): void;
  /** The marker of the chosen place, or null. */
  marker: Accessor<Place | null>;
  /** Centre on where the companion says the computer is. */
  locate(): void;
  locating: Accessor<boolean>;
  query: Accessor<string>;
  /** Look `query` up; `results()` follows. */
  search(query: string): void;
  results: Accessor<ResultsState>;
  /** Open the keyboard for the search words (set by the app). */
  editQuery(): void;
  /** Centre on a result and drop the marker there. */
  choose(place: Place): void;
  /** A short message for the viewer, "" when none. */
  notice: Accessor<string>;
  /** Restore the saved view, once per realm. */
  start(): void;
  /** Save the view once it has rested (after a drag ends, a zoom, a locate). */
  settle(): void;
}

// ---- Web Mercator -----------------------------------------------------------------

/** The world's side in px at `zoom`. */
export const worldSize = (zoom: number): number => TILE * 2 ** zoom;

/** World px of a position at `zoom`. */
export function toWorld(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const n = worldSize(zoom);
  const s = Math.sin((Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

/** The position at world px (x, y) at `zoom`; x wraps round the world. */
export function fromWorld(x: number, y: number, zoom: number): { lat: number; lon: number } {
  const n = worldSize(zoom);
  const wrapped = ((x % n) + n) % n;
  const t = Math.PI * (1 - (2 * Math.max(0, Math.min(n, y))) / n);
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(t)), lon: (wrapped / n) * 360 - 180 };
}

/** Metres one px covers at the centre's latitude and `zoom`. */
export function metresPerPx(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export function createMapsModel(client: MapsClient, options: { editQuery: () => void }): MapsModel {
  const [view, setView] = createSignal<MapView>(WORLD);
  const [marker, setMarker] = createSignal<Place | null>(null);
  const [locating, setLocating] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [results, setResults] = createSignal<ResultsState>({ status: "idle", items: [], error: "" });
  const [notice, setNotice] = createSignal("");
  let started = false;
  let searchRun = 0;
  let noticeRun = 0;
  let saveRun = 0;
  let saved: MapView | null = null;

  const say = (text: string) => {
    const run = ++noticeRun;
    setNotice(text);
    after(NOTICE_S, () => run === noticeRun && setNotice(""));
  };

  const settle = () => {
    const run = ++saveRun;
    after(SAVE_AFTER_S, () => {
      if (run !== saveRun) return;
      const now = view();
      if (saved && saved.lat === now.lat && saved.lon === now.lon && saved.zoom === now.zoom) return;
      saved = now;
      client.save(now).catch(() => undefined);
    });
  };

  const place = (lat: number, lon: number, zoom: number) => {
    setView({ lat: Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)), lon: ((((lon + 180) % 360) + 360) % 360) - 180, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom))) });
  };

  const locate = () => {
    if (locating()) return;
    setLocating(true);
    client.locate().then(
      (location) => {
        setLocating(false);
        place(location.lat, location.lon, Math.max(view().zoom, LOCATE_ZOOM));
        say(location.city ? `Near ${location.city}` : `Centred on ${yourComputer()}'s position`);
        settle();
      },
      (error: unknown) => {
        setLocating(false);
        say(`Could not locate: ${errorText(error)}`);
      },
    );
  };

  return {
    view,
    panBy(dx, dy) {
      const now = view();
      const centre = toWorld(now.lat, now.lon, now.zoom);
      const moved = fromWorld(centre.x + dx, centre.y + dy, now.zoom);
      place(moved.lat, moved.lon, now.zoom);
    },
    zoomBy(step) {
      const now = view();
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, now.zoom + step));
      if (zoom === now.zoom) return;
      place(now.lat, now.lon, zoom);
      settle();
    },
    marker,
    locate,
    locating,
    query,
    search(next) {
      const words = next.trim();
      setQuery(words);
      const run = ++searchRun;
      if (!words) return setResults({ status: "idle", items: [], error: "" });
      setResults({ status: "loading", items: [], error: "" });
      client.geocode(words).then(
        (items) => run === searchRun && setResults({ status: "ready", items, error: "" }),
        (error: unknown) => run === searchRun && setResults({ status: "error", items: [], error: errorText(error) }),
      );
    },
    results,
    editQuery: () => options.editQuery(),
    choose(found) {
      setMarker(found);
      place(found.lat, found.lon, Math.max(view().zoom, PLACE_ZOOM));
      settle();
    },
    notice,
    start() {
      if (started) return;
      started = true;
      client.load().then(
        (stored) => {
          if (stored) {
            saved = stored;
            place(stored.lat, stored.lon, stored.zoom);
          } else locate();
        },
        () => locate(),
      );
    },
    settle,
  };
}
