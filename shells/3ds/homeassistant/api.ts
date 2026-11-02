// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/homeassistant/api.ts — the companion's homeassistant service
// (https://companion.pocket/homeassistant/…, PocketJS tools/companion/
// services/homeassistant.ts) through the applet's worker (ui/net.ts).
//
// The Home Assistant URL and the access token live in Pocket Companion's
// store on the linked Mac; the applet sends them once, at setup, and after that
// asks for entity states and service calls as plain JSON. The host's http
// node runs two requests at a time: a call goes ahead of a poll.

import { companionService, fetch, NetError } from "../ui/net.ts";
import { notLinked, theComputer } from "../ui/companion.ts";

export const MAX_INFLIGHT = 2;

/** An entity as the service reduces it. */
export interface Entity {
  /** "light.kitchen" */
  id: string;
  /** "light" */
  domain: string;
  name: string;
  state: string;
  unit: string;
  icon?: string;
  attributes: {
    brightness?: number;
    temperature?: number;
    current_temperature?: number;
    hvac_modes?: string[];
    hvac_mode?: string;
    percentage?: number;
    media_title?: string;
    media_artist?: string;
    battery_level?: number;
    device_class?: string;
  };
}

export interface SetupState {
  url: string;
  ready: boolean;
}

export type TabId = "lights" | "climate" | "sensors" | "media" | "other";

export interface Tab {
  id: TabId;
  label: string;
  domains: readonly string[];
}

/** The pages of the Home app, each the domains it lists. */
export const TABS: readonly Tab[] = [
  { id: "lights", label: "Lights", domains: ["light", "switch", "input_boolean"] },
  { id: "climate", label: "Climate", domains: ["climate"] },
  { id: "sensors", label: "Sensors", domains: ["sensor", "binary_sensor"] },
  { id: "media", label: "Media", domains: ["media_player"] },
  { id: "other", label: "Other", domains: ["scene", "script", "automation", "cover", "lock", "fan"] },
];

/** Every domain a tab lists: the states request asks for these alone. */
export const DOMAINS: readonly string[] = TABS.flatMap((tab) => tab.domains);

/** A failed request: the transport's error code, "setup" when Home Assistant is not
 *  set up on this device (or refused the token), or "http". */
export class HaError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface Task {
  path: string;
  method: "GET" | "POST";
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  resolve: (value: unknown) => void;
  reject: (error: HaError) => void;
}

export interface HaClient {
  setup(): Promise<SetupState>;
  /** Try the pair on this device; resolves with the instance's message. */
  connect(url: string, token: string): Promise<string>;
  forget(): Promise<void>;
  states(): Promise<Entity[]>;
  call(domain: string, service: string, entityId: string, data?: Record<string, unknown>): Promise<void>;
  /** Requests in flight (tests: never above MAX_INFLIGHT). */
  inflight(): number;
}

export function createHaClient(): HaClient {
  const queue: Task[] = [];
  let running = 0;

  const pump = () => {
    while (running < MAX_INFLIGHT && queue.length > 0) {
      const task = queue.shift()!;
      running++;
      fetch(companionService("homeassistant", task.path), {
        method: task.method,
        timeoutMs: task.timeoutMs,
        maxBytes: task.maxBytes,
        ...(task.body !== undefined ? { body: task.body, headers: { "content-type": "application/json" } } : {}),
      }).then(
        async (response) => {
          running--;
          pump();
          try {
            const payload = (await response.json()) as { error?: string; message?: string; setup?: string };
            if (response.status === 409 || response.status === 401) throw new HaError("setup", payload.error ?? "");
            if (!response.ok) throw new HaError("http", payload.message ?? payload.error ?? `HTTP ${response.status}`);
            task.resolve(payload);
          } catch (error) {
            task.reject(error instanceof HaError ? error : new HaError("protocol", "The answer was not JSON."));
          }
        },
        (error: unknown) => {
          running--;
          pump();
          const code = error instanceof NetError ? error.code : "other";
          task.reject(new HaError(code, error instanceof Error ? error.message : String(error)));
        },
      );
    }
  };

  const request = <T,>(path: string, options: { method?: "GET" | "POST"; body?: unknown; urgent?: boolean; timeoutMs?: number; maxBytes?: number } = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const task: Task = {
        path,
        method: options.method ?? "GET",
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        timeoutMs: options.timeoutMs ?? 20_000,
        maxBytes: options.maxBytes ?? 128 * 1024,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (options.urgent) queue.unshift(task);
      else queue.push(task);
      pump();
    });

  return {
    setup: () => request<{ url?: string; ready?: boolean }>("/setup", { urgent: true }).then((answer) => ({ url: answer.url ?? "", ready: !!answer.ready })),
    connect: (url, token) =>
      request<{ ok?: boolean; message?: string }>("/setup", { method: "POST", body: { url, token }, urgent: true, timeoutMs: 30_000 }).then((answer) => answer.message ?? "API running."),
    forget: () => request<unknown>("/forget", { method: "POST", body: {}, urgent: true }).then(() => undefined),
    states: () =>
      request<{ entities?: Entity[] }>(`/states?domains=${DOMAINS.join(",")}`, { timeoutMs: 30_000, maxBytes: 256 * 1024 }).then((answer) =>
        Array.isArray(answer.entities) ? answer.entities : [],
      ),
    call: (domain, service, entityId, data) =>
      request<unknown>("/call", { method: "POST", body: { domain, service, entity_id: entityId, ...(data ? { data } : {}) }, urgent: true, timeoutMs: 30_000 }).then(() => undefined),
    inflight: () => running,
  };
}

/** The message a reader sees for a failed request. */
export function errorText(error: unknown): { title: string; detail: string } {
  const code = error instanceof HaError ? error.code : "";
  if (code === "setup") {
    return { title: "Connect to Home Assistant", detail: error instanceof Error && error.message ? error.message : "Enter the URL and a long-lived access token in Setup." };
  }
  if (code === "unavailable") return notLinked("Home");
  if (code === "timeout") return { title: "The request timed out", detail: `${theComputer()} or Home Assistant did not answer in time.` };
  const message = error instanceof Error ? error.message : String(error);
  return { title: "Could not load", detail: message || "The request failed." };
}
