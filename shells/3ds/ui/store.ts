// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/store.ts — a JSON document in the companion's store service
// (https://companion.pocket/store/), whatever its size.
//
// One request's descriptor is at most DESCRIPTOR_BYTES (ui/net.ts), its body
// included. A document whose /set fits is saved whole under its name. A
// larger one is saved in parts: its JSON text is cut into strings saved as
// `<name>.0` … `<name>.<n-1>`, each the longest piece whose request fits, and
// then `<name>` is saved as {"parts": n}, so a reader never finds a count
// before its parts. A reader gets `<name>` and, when it names parts, gets
// each one and joins them. The app passes its own requests, so the store's
// traffic waits in the app's queue like the rest.

import { DESCRIPTOR_BYTES } from "./net.ts";

export interface StoreRequests {
  /** GET /get?name=<name>: the stored value, or null when there is none. */
  get(name: string): Promise<unknown>;
  /** POST /set?name=<name> with `body`, a JSON text. */
  set(name: string, body: string): Promise<void>;
  /** The descriptor bytes of that /set request. */
  bytes(name: string, body: string): number;
}

/** The count a parts record names, or null for any other value. */
function partsOf(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const parts = (value as { parts?: unknown }).parts;
  return keys.length === 1 && Number.isInteger(parts) && (parts as number) > 0 ? (parts as number) : null;
}

/** `text` in pieces whose /set under `name.<index>` each fits one request. */
export function storeParts(store: StoreRequests, name: string, text: string): string[] {
  const parts: string[] = [];
  for (let at = 0; at < text.length; ) {
    const part = `${name}.${parts.length}`;
    let low = 0;
    let high = text.length - at;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (store.bytes(part, JSON.stringify(text.slice(at, at + mid))) <= DESCRIPTOR_BYTES) low = mid;
      else high = mid - 1;
    }
    if (low === 0) throw new Error(`store: a request for ${part} does not fit ${DESCRIPTOR_BYTES} bytes`);
    parts.push(text.slice(at, at + low));
    at += low;
  }
  return parts;
}

export async function saveDocument(store: StoreRequests, name: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value);
  if (store.bytes(name, text) <= DESCRIPTOR_BYTES) {
    await store.set(name, text);
    return;
  }
  const parts = storeParts(store, name, text);
  for (const [index, part] of parts.entries()) await store.set(`${name}.${index}`, JSON.stringify(part));
  await store.set(name, JSON.stringify({ parts: parts.length }));
}

/** The document saved under `name`, or null when there is none or a part
 *  is missing. */
export async function loadDocument(store: StoreRequests, name: string): Promise<unknown> {
  const value = await store.get(name);
  const parts = partsOf(value);
  if (parts === null) return value ?? null;
  let text = "";
  for (let index = 0; index < parts; index++) {
    const part = await store.get(`${name}.${index}`);
    if (typeof part !== "string") return null;
    text += part;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
