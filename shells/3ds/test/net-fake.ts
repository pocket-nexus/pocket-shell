// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/net-fake.ts — an applet's worker for the sims. PocketJS's
// sim runs no worker realm, so this is the channel bridge the UI bundle finds
// on globalThis (`__pocketWorkerChannels`, framework/src/worker-channels.ts):
// it reads the UI's request records (ui/net-wire.ts) and answers them from
// fixture routes, as ui/net-worker.ts answers them with the host's http node.
//
// It keeps the worker's rules: at most NODE_REQUESTS run at once and the rest
// wait, an answer is a head, its body in 1019-byte records and an end, and
// the response ring holds RESPONSE_CAPACITY records, so a long body takes
// several frames. Time is the UI's frames: the bridge advances one tick each
// time the UI observes the response ring, which ui/net.ts does once a frame.
// Every route answers `delayTicks` ticks (default 1) after it starts.

import { bootConsole3ds, type Console3ds, type Console3dsOptions } from "../../../vendor/pocketjs/programs/sim/console-3ds.ts";
import { Answer, ANSWER_BYTES, decodeRequest, encodeAnswer, encodeEnd, NET_WORKER, NODE_REQUESTS, Status, utf8 } from "../ui/net-wire.ts";

export interface NetRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

export interface NetAnswer {
  readonly status?: number;
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  /** Ticks after the request starts before the answer streams. Default 1. */
  readonly delayTicks?: number;
  /** A transport failure in place of an answer: the end carries "code: message". */
  readonly error?: { readonly code: string; readonly message: string };
}

export type NetRoute = NetAnswer | ((request: NetRequest) => NetAnswer);
export type NetRoutes = Readonly<Record<string, NetRoute>>;

const REQUEST_ID = 1 + NET_WORKER.channels.findIndex((channel) => channel.name === "request");
const RESPONSE_ID = 1 + NET_WORKER.channels.findIndex((channel) => channel.name === "response");
const RESPONSE_CAPACITY = NET_WORKER.channels[RESPONSE_ID - 1]!.capacity;

export interface NetFake {
  /** "send <id> <METHOD> <url> <body bytes>" as a request record arrives,
   *  "start …" as the node starts it, "end <id> <status>" as its end leaves. */
  readonly log: string[];
  /** The most requests the UI had out at once: sent and not yet ended. */
  peak(): number;
  /** Requests out now. */
  inflight(): number;
}

interface Running {
  id: number;
  request: NetRequest;
  answer: NetAnswer;
  ready: number;
}

export function createNetFake(routes: NetRoutes): NetFake & { bridge: object } {
  const log: string[] = [];
  const waiting: { id: number; request: NetRequest }[] = [];
  const running: Running[] = [];
  const outgoing: Uint8Array[] = [];
  let tick = 0;
  let out = 0;
  let peak = 0;

  const queue = (id: number, kind: number, payload: Uint8Array) => {
    let at = 0;
    do {
      outgoing.push(encodeAnswer(id, kind, payload.subarray(at, at + ANSWER_BYTES)));
      at += ANSWER_BYTES;
    } while (at < payload.length);
  };
  const end = (id: number, status: number, failure = "") => {
    queue(id, Answer.end, encodeEnd(status, failure));
    log.push(`end ${id} ${status}`);
    out--;
  };
  const start = () => {
    while (running.length < NODE_REQUESTS && waiting.length > 0) {
      const { id, request } = waiting.shift()!;
      const route = routes[request.url];
      log.push(`start ${id} ${request.method} ${request.url} ${request.body.byteLength}`);
      if (!route) {
        end(id, Status.invalid, `invalid_request: no route for ${request.url}`);
        continue;
      }
      const answer = typeof route === "function" ? route(request) : route;
      running.push({ id, request, answer, ready: tick + Math.max(1, Math.floor(answer.delayTicks ?? 1)) });
    }
  };
  const answerReady = () => {
    for (const item of [...running]) {
      if (item.ready > tick) continue;
      running.splice(running.indexOf(item), 1);
      const { id, request, answer } = item;
      if (answer.error) {
        end(id, Status.failed, `${answer.error.code}: ${answer.error.message}`);
        continue;
      }
      const body = typeof answer.body === "string" ? utf8(answer.body) : answer.body ?? new Uint8Array(0);
      if (body.byteLength > request.maxBytes) {
        end(id, Status.failed, `response_too_large: the body is over ${request.maxBytes} bytes`);
        continue;
      }
      queue(id, Answer.head, utf8(JSON.stringify({ status: answer.status ?? 200, url: answer.url ?? request.url, headers: answer.headers ?? {} })));
      if (body.byteLength > 0) queue(id, Answer.body, body);
      end(id, Status.ok);
    }
    start();
  };

  const bridge = {
    configure: () => Status.ok,
    publish(channel: number, data: Uint8Array): number {
      if (channel !== REQUEST_ID) return Status.invalid;
      const { id, descriptor } = decodeRequest(data.slice());
      const request: NetRequest = {
        url: descriptor.url,
        method: descriptor.method ?? "GET",
        headers: descriptor.headers ?? {},
        body: utf8(descriptor.body ?? ""),
        timeoutMs: descriptor.timeoutMs ?? 30_000,
        maxBytes: descriptor.maxBytes ?? 256 * 1024,
      };
      log.push(`send ${id} ${request.method} ${request.url} ${request.body.byteLength}`);
      peak = Math.max(peak, ++out);
      waiting.push({ id, request });
      start();
      return Status.ok;
    },
    observe(channel: number): Uint8Array[] {
      if (channel !== RESPONSE_ID) return [];
      tick++;
      answerReady();
      return outgoing.splice(0, RESPONSE_CAPACITY);
    },
  };
  return { log, peak: () => peak, inflight: () => out, bridge };
}

/** A Console3ds with the fake worker on its http node, or none. */
export type NetConsole = Console3ds & { net: NetFake | null };

/** Boot a console whose applet's worker answers from `routes`; without
 *  routes the host runs no worker, as a console whose host has none. */
export async function bootWithNet(options: Console3dsOptions, routes: NetRoutes | undefined): Promise<NetConsole> {
  const g = globalThis as Record<string, unknown>;
  const fake = routes ? createNetFake(routes) : null;
  if (fake) g.__pocketWorkerChannels = fake.bridge;
  else delete g.__pocketWorkerChannels;
  const console3ds = await bootConsole3ds(options);
  return Object.assign(console3ds, { net: fake });
}
