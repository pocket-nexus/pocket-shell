// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/net.ts — fetch for an applet. The UI realm has no network
// (PocketJS docs/APPLETS.md, "The applet's worker"): each request goes to the
// applet's worker (ui/net-worker.ts) on the `request` ring, and its answer
// comes back on `response` (ui/net-wire.ts). Records go out and come back
// once per frame.
//
// A request's descriptor (URL, method, headers and body as JSON) is at most
// DESCRIPTOR_BYTES; a longer one is refused here before it leaves, as the
// worker's io.http would refuse it.

import { createRoot } from "solid-js";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { worker } from "@pocketjs/framework/worker/channels";
import { Answer, decodeAnswer, decodeEnd, DESCRIPTOR_BYTES, encodeRequest, Status, text, utf8, type Descriptor } from "./net-wire.ts";

export { DESCRIPTOR_BYTES };

/** Where the paired companion answers its services (PocketJS
 *  contracts/spec/link.ts LINK_SERVICES_ORIGIN). */
export const COMPANION_ORIGIN = "https://companion.pocket";

/** The URL of `path` on the companion's `service`. */
export function companionService(service: string, path = "/"): string {
  return `${COMPANION_ORIGIN}/${service}${path.startsWith("/") ? path : `/${path}`}`;
}

export type NetMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export interface FetchOptions {
  method?: NetMethod;
  headers?: Readonly<Record<string, string>>;
  body?: string;
  /** Default 30000; the host's limit is 120000. */
  timeoutMs?: number;
  /** The whole body's cap; default 128 KiB, at most 256 KiB. */
  maxBytes?: number;
}

/** A request that did not get its answer. `code` is the transport's portable
 *  code: unavailable, invalid_request, busy, dns, connect, tls, timeout,
 *  redirect, response_too_large, protocol, cancelled or other. */
export class NetError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "NetError";
    this.code = code;
  }
}

export class NetResponse {
  readonly status: number;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly ok: boolean;
  private readonly data: Uint8Array;
  constructor(status: number, url: string, headers: Readonly<Record<string, string>>, data: Uint8Array) {
    this.status = status;
    this.url = url;
    this.headers = headers;
    this.ok = status >= 200 && status < 300;
    this.data = data;
  }
  async bytes(): Promise<Uint8Array> {
    return this.data.slice();
  }
  async text(): Promise<string> {
    return text(this.data);
  }
  async json<T = unknown>(): Promise<T> {
    return JSON.parse(text(this.data)) as T;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 128 * 1024;
/** Past its own timeout the worker's node ends a request; the UI gives up
 *  this much later, for a worker that never answers. */
const GRACE_MS = 10_000;

/** The portable code of an end without a failure text, by ResourceStatus. */
const STATUS_CODES: Record<number, string> = {
  [Status.failed]: "other",
  [Status.cancelled]: "cancelled",
  [Status.unknown]: "timeout",
  [Status.busy]: "busy",
  [Status.invalid]: "invalid_request",
  [Status.unsupported]: "unavailable",
};

interface Pending {
  url: string;
  deadline: number;
  head: Uint8Array[];
  body: Uint8Array[];
  resolve(response: NetResponse): void;
  reject(error: NetError): void;
}

function descriptorOf(url: string, options: FetchOptions): Descriptor {
  return {
    url,
    ...(options.method ? { method: options.method } : {}),
    ...(options.headers ? { headers: { ...options.headers } } : {}),
    ...(options.body !== undefined ? { body: options.body } : {}),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  };
}

/** The bytes a request's descriptor takes: at most DESCRIPTOR_BYTES go out. */
export function requestBytes(url: string, options: FetchOptions = {}): number {
  return utf8(JSON.stringify(descriptorOf(url, options))).length;
}

function joined(blocks: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const block of blocks) length += block.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  return out;
}

function failure(status: number, reason: string): NetError {
  const colon = reason.indexOf(":");
  if (colon > 0) return new NetError(reason.slice(0, colon).trim(), reason.slice(colon + 1).trim());
  return new NetError(STATUS_CODES[status] ?? "other", reason || `The request ended with status ${status}.`);
}

let channels: { requests: ReturnType<typeof worker.channel>; responses: ReturnType<typeof worker.channel> } | null = null;
const pending = new Map<number, Pending>();
const outbox: Uint8Array[] = [];
let nextId = 1;

function settle(id: number, call: Pending, status: number, reason: string): void {
  pending.delete(id);
  if (status !== Status.ok) {
    call.reject(failure(status, reason));
    return;
  }
  let head: { status?: number; url?: string; headers?: Record<string, string> } = {};
  try {
    head = JSON.parse(text(joined(call.head))) as typeof head;
  } catch {
    call.reject(new NetError("protocol", "The answer had no readable head."));
    return;
  }
  call.resolve(new NetResponse(head.status ?? 0, head.url ?? call.url, head.headers ?? {}, joined(call.body)));
}

function frame(): void {
  const open = channels!;
  while (outbox.length > 0 && open.requests.publish(outbox[0]!)) outbox.shift();
  for (const view of open.responses.observe()) {
    const { id, kind, payload } = decodeAnswer(view.copy());
    const call = pending.get(id);
    if (!call) continue;
    if (kind === Answer.head) call.head.push(payload);
    else if (kind === Answer.body) call.body.push(payload);
    else if (kind === Answer.end) {
      const end = decodeEnd(payload);
      settle(id, call, end.status, end.failure);
    }
  }
  if (pending.size === 0) return;
  const now = Date.now();
  for (const [id, call] of pending) {
    if (now <= call.deadline) continue;
    pending.delete(id);
    call.reject(new NetError("timeout", "The request did not finish in time."));
  }
}

/** The channels and the frame hook, made by the first request. The hook
 *  lives in a root of its own, so the page that asked first can unmount. */
function open(): NonNullable<typeof channels> {
  if (channels) return channels;
  channels = { requests: worker.channel("request"), responses: worker.channel("response") };
  createRoot(() => onFrame(frame));
  return channels;
}

export function fetch(url: string, options: FetchOptions = {}): Promise<NetResponse> {
  const descriptor = utf8(JSON.stringify(descriptorOf(url, options)));
  if (descriptor.length > DESCRIPTOR_BYTES) {
    return Promise.reject(new NetError("invalid_request", `The request is ${descriptor.length} bytes; one request carries at most ${DESCRIPTOR_BYTES}.`));
  }
  try {
    open();
  } catch {
    return Promise.reject(new NetError("unavailable", "This host runs no worker for the applet."));
  }
  return new Promise<NetResponse>((resolve, reject) => {
    const id = nextId++;
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    pending.set(id, { url, deadline: Date.now() + timeout + GRACE_MS, head: [], body: [], resolve, reject });
    outbox.push(encodeRequest(id, descriptor));
  });
}
