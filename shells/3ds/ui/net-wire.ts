// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/net-wire.ts — the records an applet's UI (ui/net.ts) and its
// worker (ui/net-worker.ts) exchange over the channels its app contract
// declares (NET_WORKER below). Both bundles import this module, so it imports
// nothing from the framework.
//
//   request  (UI -> worker): id u32, then the io.http descriptor as UTF-8
//            JSON {url, method, headers, body, timeoutMs, maxBytes}
//   response (worker -> UI): id u32, kind u8, payload
//     HEAD   the next bytes of the headers record io.http delivers, UTF-8
//            JSON {status, url, headers}; a long record takes several
//     BODY   the next bytes of the body
//     END    the ResourceStatus (i32), then "code: message" (UTF-8) when the
//            request failed, nothing when the whole answer arrived

/** A channel record (WORKER_LIMITS.payloadBytes in PocketJS). */
export const RECORD_BYTES = 1024;
export const ANSWER_HEADER = 5;
/** A descriptor rides one request record after its id. It is also within
 *  the 1024 bytes io.http admits. */
export const DESCRIPTOR_BYTES = RECORD_BYTES - 4;
export const ANSWER_BYTES = RECORD_BYTES - ANSWER_HEADER;
export const Answer = { head: 1, body: 2, end: 3 } as const;

/** Requests the host's http node runs at once: two on the 3DS's Pocket Link
 *  (engine/host-services/link_http.h) and two in the Tab5 firmware
 *  (pocket_http_esp). The worker holds the rest until one ends, so a refused
 *  start means the node cannot reach the network, not that it is busy. */
export const NODE_REQUESTS = 2;

/** ResourceStatus (PocketJS contracts/spec/worker.ts). */
export const Status = { ok: 0, failed: -1, cancelled: -2, unknown: -3, busy: -4, invalid: -5, unsupported: -6 } as const;

/** The worker domain every networked applet here declares in its app
 *  contract: one http node, a ring each way. */
export const NET_WORKER = {
  entry: "ui/net-worker.ts",
  nodes: [{ name: "http", kind: "http" }],
  channels: [
    { name: "request", kind: "ring", direction: "ui-to-worker", recordBytes: RECORD_BYTES, capacity: 4 },
    { name: "response", kind: "ring", direction: "worker-to-ui", recordBytes: RECORD_BYTES, capacity: 8 },
  ],
} as const;

export interface Descriptor {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export function encodeRequest(id: number, descriptor: Uint8Array): Uint8Array {
  const record = new Uint8Array(4 + descriptor.length);
  new DataView(record.buffer).setUint32(0, id, true);
  record.set(descriptor, 4);
  return record;
}

export function requestId(record: Uint8Array): number {
  return record.length >= 4 ? new DataView(record.buffer, record.byteOffset, record.byteLength).getUint32(0, true) : 0;
}

export function decodeRequest(record: Uint8Array): { id: number; descriptor: Descriptor } {
  return { id: requestId(record), descriptor: JSON.parse(text(record.subarray(4))) as Descriptor };
}

/** One response record: the header and `payload` (at most ANSWER_BYTES). */
export function encodeAnswer(id: number, kind: number, payload: Uint8Array): Uint8Array {
  const record = new Uint8Array(ANSWER_HEADER + payload.length);
  const view = new DataView(record.buffer);
  view.setUint32(0, id, true);
  view.setUint8(4, kind);
  record.set(payload, ANSWER_HEADER);
  return record;
}

export function decodeAnswer(record: Uint8Array): { id: number; kind: number; payload: Uint8Array } {
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  return { id: view.getUint32(0, true), kind: view.getUint8(4), payload: record.subarray(ANSWER_HEADER) };
}

/** An END payload: the status, then the failure's "code: message". */
export function encodeEnd(status: number, failure: string): Uint8Array {
  const reason = utf8(failure);
  const payload = new Uint8Array(4 + Math.min(reason.length, ANSWER_BYTES - 4));
  new DataView(payload.buffer).setInt32(0, status, true);
  payload.set(reason.subarray(0, payload.length - 4), 4);
  return payload;
}

export function decodeEnd(payload: Uint8Array): { status: number; failure: string } {
  const status = payload.length >= 4 ? new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getInt32(0, true) : Status.unknown;
  return { status, failure: text(payload.subarray(4)) };
}

/** UTF-8; lone surrogates become U+FFFD. QuickJS has no TextEncoder. */
export function utf8(value: string): Uint8Array {
  const out: number[] = [];
  for (const char of value) {
    let cp = char.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

/** U+FFFD as a number: a literal would put its glyph in every baked atlas. */
const REPLACEMENT = 0xfffd;

/** UTF-8 to a string; a malformed sequence becomes U+FFFD. QuickJS has no
 *  TextDecoder. */
export function text(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const lead = bytes[i]!;
    const length = lead < 0x80 ? 1 : lead >= 0xf0 && lead < 0xf5 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc2 ? 2 : 0;
    let cp = length === 1 ? lead : length === 2 ? lead & 0x1f : length === 3 ? lead & 0x0f : lead & 0x07;
    let ok = length > 0 && i + length <= bytes.length;
    for (let k = 1; ok && k < length; k++) {
      const next = bytes[i + k]!;
      if ((next & 0xc0) !== 0x80) ok = false;
      else cp = (cp << 6) | (next & 63);
    }
    if (ok && length === 3 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) ok = false;
    if (ok && length === 4 && (cp < 0x10000 || cp > 0x10ffff)) ok = false;
    out += String.fromCodePoint(ok ? cp : REPLACEMENT);
    i += ok ? length : 1;
  }
  return out;
}
