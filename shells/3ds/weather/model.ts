// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/weather/model.ts — what Weather shows: the saved places and the
// units from the companion's store, a search's results, each place's
// forecast and the place that is open, as signals over the API client.
//
// The store loads first; the places it holds get their forecasts, two
// requests at a time, with the open place's first. A forecast is kept
// STALE_MS before a place opened again asks for a new one; Reload asks
// at once. Every change to the places or the units is written back to the
// store in order; while the store has not answered, a change stays in
// memory and the Places page says so.

import { createSignal, type Accessor } from "solid-js";
import { companionNow } from "@pocketjs/framework/link";
import { errorText, type Forecast, type Place, type Saved, type Units, type WeatherClient } from "./api.ts";

/** A forecast older than this is asked for again when its place opens. */
export const STALE_MS = 10 * 60_000;

export interface Trouble {
  title: string;
  detail: string;
}

export interface ForecastState {
  status: "loading" | "ready" | "error";
  /** The last forecast that arrived; kept while a reload runs or fails. */
  forecast: Forecast | null;
  /** When `forecast` arrived (companionNow), 0 for none. */
  at: number;
  error: Trouble | null;
}

export interface SearchState {
  status: "idle" | "loading" | "ready" | "error";
  query: string;
  results: readonly Place[];
  error: Trouble | null;
}

export type StoreStatus = "loading" | "ready" | "error";

export interface WeatherModel {
  client: WeatherClient;
  /** The store's answer: loading, ready (the saved places are in), or error. */
  store: Accessor<StoreStatus>;
  /** Why the store could not be read or written; null when it could. */
  storeError: Accessor<Trouble | null>;
  places: Accessor<readonly Place[]>;
  units: Accessor<Units>;
  toggleUnits(): void;
  add(place: Place): void;
  remove(id: number): void;
  /** The Places page shows a Remove button on every row. */
  editing: Accessor<boolean>;
  setEditing(on: boolean): void;
  search: Accessor<SearchState>;
  /** Geocode `query`; "" clears the results. */
  setQuery(query: string): void;
  clearSearch(): void;
  /** Open the keyboard for the search words (set by the app). */
  editQuery(): void;
  forecast(id: number): ForecastState | undefined;
  /** Ask for a place's forecast unless a fresh one is in or on its way. */
  load(place: Place, force?: boolean): void;
  loadAll(force?: boolean): void;
  /** The store again when it failed, else every forecast again. */
  refresh(): void;
  current: Accessor<Place | null>;
  open(place: Place): void;
}

const IDLE_SEARCH: SearchState = { status: "idle", query: "", results: [], error: null };

export function createWeatherModel(client: WeatherClient, options: { editQuery: () => void }): WeatherModel {
  const [store, setStore] = createSignal<StoreStatus>("loading");
  const [storeError, setStoreError] = createSignal<Trouble | null>(null);
  const [places, setPlaces] = createSignal<readonly Place[]>([]);
  const [units, setUnits] = createSignal<Units>("c");
  const [editing, setEditing] = createSignal(false);
  const [search, setSearch] = createSignal<SearchState>(IDLE_SEARCH);
  const [forecasts, setForecasts] = createSignal<ReadonlyMap<number, ForecastState>>(new Map());
  const [current, setCurrent] = createSignal<Place | null>(null);
  const generations = new Map<number, number>();
  let searchRun = 0;
  let storeRun = 0;
  /** Writes to the store, one after another in the order they were asked. */
  let saving: Promise<void> = Promise.resolve();

  const put = (id: number, state: ForecastState) => {
    const next = new Map(forecasts());
    next.set(id, state);
    setForecasts(next);
  };
  const drop = (id: number) => {
    if (!forecasts().has(id)) return;
    const next = new Map(forecasts());
    next.delete(id);
    setForecasts(next);
  };

  const load = (place: Place, force = false) => {
    const have = forecasts().get(place.id);
    if (have && (have.status === "loading" || (have.status === "ready" && !force && companionNow() - have.at < STALE_MS))) return;
    const run = (generations.get(place.id) ?? 0) + 1;
    generations.set(place.id, run);
    put(place.id, { status: "loading", forecast: have?.forecast ?? null, at: have?.at ?? 0, error: null });
    client.forecast(place, current()?.id === place.id).then(
      (forecast) => {
        if (generations.get(place.id) === run) put(place.id, { status: "ready", forecast, at: companionNow(), error: null });
      },
      (error: unknown) => {
        if (generations.get(place.id) === run) put(place.id, { status: "error", forecast: have?.forecast ?? null, at: have?.at ?? 0, error: errorText(error) });
      },
    );
  };

  const loadAll = (force = false) => {
    const list = places();
    const open = current();
    const first = open ? list.find((place) => place.id === open.id) : undefined;
    for (const place of first ? [first, ...list.filter((place) => place !== first)] : list) load(place, force);
  };

  const persist = () => {
    if (store() !== "ready") return;
    const open = current();
    const saved: Saved = { places: [...places()], units: units(), ...(open ? { current: open.id } : {}) };
    saving = saving
      .then(() => client.save(saved))
      .then(
        () => {
          setStoreError(null);
        },
        (error: unknown) => {
          setStoreError(errorText(error));
        },
      );
  };

  const loadStore = () => {
    const run = ++storeRun;
    setStore("loading");
    setStoreError(null);
    client.loadSaved().then(
      (saved) => {
        if (run !== storeRun) return;
        if (saved) {
          // A place added while the store was out of reach stays, and is written now.
          const mine = places().filter((place) => !saved.places.some((kept) => kept.id === place.id));
          setPlaces([...saved.places, ...mine]);
          setUnits(saved.units);
          // The place open last, else the first, is the one the app opens on.
          if (!current()) setCurrent(places().find((place) => place.id === saved.current) ?? places()[0] ?? null);
          setStore("ready");
          if (mine.length) persist();
        } else {
          setStore("ready");
          if (places().length) persist();
        }
        loadAll();
      },
      (error: unknown) => {
        if (run !== storeRun) return;
        setStore("error");
        setStoreError(errorText(error));
      },
    );
  };
  loadStore();

  return {
    client,
    store,
    storeError,
    places,
    units,
    toggleUnits() {
      setUnits(units() === "c" ? "f" : "c");
      persist();
    },
    add(place) {
      if (places().some((kept) => kept.id === place.id)) return;
      setPlaces([...places(), place]);
      persist();
      load(place);
    },
    remove(id) {
      if (!places().some((kept) => kept.id === id)) return;
      setPlaces(places().filter((kept) => kept.id !== id));
      generations.delete(id);
      drop(id);
      if (current()?.id === id) setCurrent(places()[0] ?? null);
      if (places().length === 0) setEditing(false);
      persist();
    },
    editing,
    setEditing,
    search,
    setQuery(query) {
      const words = query.trim();
      const run = ++searchRun;
      if (!words) {
        setSearch(IDLE_SEARCH);
        return;
      }
      setSearch({ status: "loading", query: words, results: [], error: null });
      client.geocode(words).then(
        (results) => {
          if (run === searchRun) setSearch({ status: "ready", query: words, results, error: null });
        },
        (error: unknown) => {
          if (run === searchRun) setSearch({ status: "error", query: words, results: [], error: errorText(error) });
        },
      );
    },
    clearSearch() {
      searchRun++;
      setSearch(IDLE_SEARCH);
    },
    editQuery: () => options.editQuery(),
    forecast: (id) => forecasts().get(id),
    load,
    loadAll,
    refresh() {
      if (store() === "ready") loadAll(true);
      else loadStore();
    },
    current,
    open(place) {
      if (current()?.id !== place.id) {
        setCurrent(place);
        persist();
      }
      load(place);
    },
  };
}
