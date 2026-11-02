// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/weather/api.ts — Open-Meteo through the applet's worker
// (ui/net.ts), and the companion's store service for the saved places.
//
// Geocoding (geocoding-api.open-meteo.com) answers a name with up to eight
// places; the forecast API (api.open-meteo.com) answers a place's
// coordinates with the current conditions, seven days of hours and seven
// days of highs, lows, sunrise and sunset, every time in the place's own
// zone. Neither needs a key. The host's http node runs MAX_INFLIGHT (2)
// requests at a time, so every request goes through one queue; the forecast
// for the page on screen and the store's requests jump the queue ahead of
// the list's refreshes. Temperatures arrive in Celsius and wind in km/h; the
// units toggle converts on the device, so it costs no request.
//
// The places and the units live in the companion's store service (PocketJS
// tools/companion/services/store.ts) under the name `weather`:
// GET /get?name=weather answers {value}, POST /set?name=weather with the
// JSON document answers {ok: true}. Pocket Companion answers both for this
// device. A document longer than one request goes in parts (ui/store.ts).

import { companionService, fetch, NetError, requestBytes, type NetResponse } from "../ui/net.ts";
import { loadDocument, saveDocument, type StoreRequests } from "../ui/store.ts";
import { notLinked, theComputer } from "../ui/companion.ts";

export const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";
export const FORECAST_API = "https://api.open-meteo.com/v1/forecast";
export const STORE_NAME = "weather";
export const MAX_INFLIGHT = 2;
export const FORECAST_DAYS = 7;
export const GEOCODE_COUNT = 8;

export interface Place {
  /** Open-Meteo's geonames id. */
  id: number;
  name: string;
  /** The first-level division (a state, a prefecture); "" when none. */
  region: string;
  country: string;
  latitude: number;
  longitude: number;
}

export type Units = "c" | "f";

/** The store document. */
export interface Saved {
  places: Place[];
  units: Units;
  /** The place open last (its id), so the app opens on its forecast. */
  current?: number;
}

export interface Current {
  /** "YYYY-MM-DDTHH:MM" in the place's zone. */
  time: string;
  temperature: number;
  apparent: number;
  code: number;
  /** km/h */
  wind: number;
  /** percent */
  humidity: number;
}

export interface Hour {
  time: string;
  temperature: number;
  code: number;
  /** percent */
  precipitation: number;
}

export interface Day {
  /** "YYYY-MM-DD" */
  date: string;
  code: number;
  max: number;
  min: number;
  sunrise: string;
  sunset: string;
}

export interface Forecast {
  timezone: string;
  current: Current;
  hourly: Hour[];
  daily: Day[];
}

/** A failed request, with the transport's error code when there is one; "http" for
 *  a refused request, "protocol" for an answer not in the expected shape. */
export class WeatherError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface Task {
  url: string;
  method?: "POST";
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  resolve: (response: NetResponse) => void;
  reject: (error: WeatherError) => void;
}

export interface WeatherClient {
  geocode(query: string): Promise<Place[]>;
  /** `urgent` puts the request ahead of the queue (the page on screen). */
  forecast(place: Place, urgent?: boolean): Promise<Forecast>;
  /** The store document, or null when none was saved yet. */
  loadSaved(): Promise<Saved | null>;
  save(saved: Saved): Promise<void>;
  /** Requests in flight (for tests: never above MAX_INFLIGHT). */
  inflight(): number;
}

export function geocodeUrl(query: string): string {
  return `${GEOCODING_API}?name=${encodeURIComponent(query)}&count=${GEOCODE_COUNT}&language=en&format=json`;
}

export function forecastUrl(place: Place): string {
  return `${FORECAST_API}?latitude=${place.latitude}&longitude=${place.longitude}`
    + "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m"
    + "&hourly=temperature_2m,weather_code,precipitation_probability"
    + "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset"
    + `&timezone=auto&forecast_days=${FORECAST_DAYS}`;
}

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : NaN);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** A place from a geocoding result ({name, admin1, country, latitude,
 *  longitude}) or from the store (a Place as saved); null when a field is
 *  missing. */
export function parsePlace(entry: unknown): Place | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const place: Place = {
    id: num(e.id),
    name: str(e.name),
    region: str(e.region) || str(e.admin1),
    country: str(e.country),
    latitude: num(e.latitude),
    longitude: num(e.longitude),
  };
  return Number.isFinite(place.id) && place.name !== "" && Number.isFinite(place.latitude) && Number.isFinite(place.longitude) ? place : null;
}

/** The places of a geocoding answer ({results: [...]}); [] for none. */
export function parsePlaces(body: unknown): Place[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: Place[] = [];
  for (const entry of results) {
    const place = parsePlace(entry);
    if (place) out.push(place);
  }
  return out;
}

/** The store's value as a document; null when nothing usable was saved. */
export function parseSaved(value: unknown): Saved | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { places?: unknown; units?: unknown };
  const places: Place[] = [];
  if (Array.isArray(v.places)) {
    for (const entry of v.places) {
      const place = parsePlace(entry);
      if (place && !places.some((p) => p.id === place.id)) places.push(place);
    }
  }
  const current = typeof (v as { current?: unknown }).current === "number" && places.some((p) => p.id === (v as { current: number }).current) ? (v as { current: number }).current : undefined;
  return { places, units: v.units === "f" ? "f" : "c", ...(current !== undefined ? { current } : {}) };
}

/** Open-Meteo's forecast answer as a Forecast; the current conditions are
 *  required, the hours and days are whatever columns line up. */
export function parseForecast(body: unknown): Forecast {
  const b = (body ?? {}) as { timezone?: unknown; current?: unknown; hourly?: unknown; daily?: unknown };
  const current = b.current as Record<string, unknown> | undefined;
  if (!current || typeof current !== "object") throw new WeatherError("protocol", "The forecast has no current conditions.");
  const column = (table: unknown, name: string): unknown[] => {
    const list = table && typeof table === "object" ? (table as Record<string, unknown>)[name] : undefined;
    return Array.isArray(list) ? list : [];
  };
  const hourly: Hour[] = [];
  {
    const times = column(b.hourly, "time");
    const temperature = column(b.hourly, "temperature_2m");
    const code = column(b.hourly, "weather_code");
    const precipitation = column(b.hourly, "precipitation_probability");
    for (let i = 0; i < times.length; i++) {
      const time = str(times[i]);
      if (time) hourly.push({ time, temperature: num(temperature[i]), code: num(code[i]), precipitation: num(precipitation[i]) });
    }
  }
  const daily: Day[] = [];
  {
    const dates = column(b.daily, "time");
    const code = column(b.daily, "weather_code");
    const max = column(b.daily, "temperature_2m_max");
    const min = column(b.daily, "temperature_2m_min");
    const sunrise = column(b.daily, "sunrise");
    const sunset = column(b.daily, "sunset");
    for (let i = 0; i < dates.length; i++) {
      const date = str(dates[i]);
      if (date) daily.push({ date, code: num(code[i]), max: num(max[i]), min: num(min[i]), sunrise: str(sunrise[i]), sunset: str(sunset[i]) });
    }
  }
  return {
    timezone: str(b.timezone),
    current: {
      time: str(current.time),
      temperature: num(current.temperature_2m),
      apparent: num(current.apparent_temperature),
      code: num(current.weather_code),
      wind: num(current.wind_speed_10m),
      humidity: num(current.relative_humidity_2m),
    },
    hourly,
    daily,
  };
}

export function createWeatherClient(): WeatherClient {
  const queue: Task[] = [];
  let running = 0;

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
          pump();
          if (response.ok) {
            task.resolve(response);
            return;
          }
          let message = `HTTP ${response.status}`;
          try {
            // Open-Meteo refuses with {error: true, reason}; the store with {error}.
            const body = JSON.parse(await response.text()) as { error?: unknown; reason?: unknown };
            if (typeof body.reason === "string") message = body.reason;
            else if (typeof body.error === "string") message = body.error;
          } catch {
            // Not JSON: keep the status.
          }
          task.reject(new WeatherError("http", message));
        },
        (error: unknown) => {
          running--;
          pump();
          const code = error instanceof NetError ? error.code : "other";
          task.reject(new WeatherError(code, error instanceof Error ? error.message : String(error)));
        },
      );
    }
  };

  const request = (task: Omit<Task, "resolve" | "reject">, urgent: boolean): Promise<NetResponse> =>
    new Promise<NetResponse>((resolve, reject) => {
      const queued: Task = { ...task, resolve, reject };
      if (urgent) queue.unshift(queued);
      else queue.push(queued);
      pump();
    });

  const json = async <T>(task: Omit<Task, "resolve" | "reject">, urgent: boolean): Promise<T> => {
    const response = await request(task, urgent);
    try {
      return JSON.parse(await response.text()) as T;
    } catch {
      throw new WeatherError("protocol", "The response was not JSON.");
    }
  };

  const setRequest = (name: string, body: string) => ({ url: companionService("store", `/set?name=${name}`), method: "POST" as const, body, timeoutMs: 10_000, maxBytes: 4096 });
  const store: StoreRequests = {
    get: async (name) => (await json<{ value?: unknown }>({ url: companionService("store", `/get?name=${name}`), timeoutMs: 10_000, maxBytes: 64 * 1024 }, true)).value ?? null,
    async set(name, body) {
      const answer = await json<{ ok?: unknown }>(setRequest(name, body), true);
      if (answer.ok !== true) throw new WeatherError("protocol", "The store did not confirm the save.");
    },
    bytes: (name, body) => {
      const { url, ...task } = setRequest(name, body);
      return requestBytes(url, { ...task, headers: { "content-type": "application/json" } });
    },
  };

  return {
    geocode: async (query) => parsePlaces(await json<unknown>({ url: geocodeUrl(query), timeoutMs: 20_000, maxBytes: 64 * 1024 }, true)),
    // Seven days of hours in three columns is about 25 KB of JSON.
    forecast: async (place, urgent = false) => parseForecast(await json<unknown>({ url: forecastUrl(place), timeoutMs: 20_000, maxBytes: 256 * 1024 }, urgent)),
    loadSaved: async () => parseSaved(await loadDocument(store, STORE_NAME)),
    save: (saved) => saveDocument(store, STORE_NAME, saved),
    inflight: () => running,
  };
}

/** The message a reader sees for a failed request. */
export function errorText(error: unknown): { title: string; detail: string } {
  const code = error instanceof WeatherError ? error.code : "";
  if (code === "unavailable") return notLinked("Weather");
  if (code === "timeout") return { title: "The request timed out", detail: `${theComputer()} or Open-Meteo did not answer in time.` };
  if (code === "dns" || code === "connect" || code === "tls") {
    return { title: "Open-Meteo is out of reach", detail: `${theComputer()} could not connect to Open-Meteo. Check the network.` };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { title: "Could not load", detail: message || "The request failed." };
}
