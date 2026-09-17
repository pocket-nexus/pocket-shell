// SPDX-License-Identifier: GPL-3.0-only
import { createState } from "./reactivity.ts";

export interface HostFile { path: string; name: string; kind: "directory" | "application" | "file"; size: number; icon?: string }
export type FilesIntent = { t: "files-list" | "files-open"; request: number; path: string; offset?: number; hidden?: boolean };
// Exactly 32 x 32 straight RGBA, base64 encoded. No arbitrary dimensions or payloads.
export function validNativeIcon(value: unknown): value is string {
  return typeof value === "string" && value.length === 5464 && /^[A-Za-z0-9+/]{5462}==$/.test(value);
}
export function decodeNativeIcon(value: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = new Uint8Array(4096);
  let bits = 0, count = 0, at = 0;
  for (let i = 0; i < value.length - 2; i++) {
    bits = (bits << 6) | alphabet.indexOf(value[i]!); count += 6;
    if (count >= 8) { count -= 8; bytes[at++] = (bits >>> count) & 255; }
  }
  return bytes;
}
let sequence = 0;

/** A request generation per window prevents late directory pages and launch
 * acknowledgements from replacing a newer navigation. The host owns paths. */
export function createHostFiles(send: (request: FilesIntent) => void) {
  const entries = createState<HostFile[]>([]);
  const address = createState("");
  const label = createState("");
  const parent = createState("computer");
  const status = createState("");
  const hidden = createState(false);
  const loading = createState(false);
  let generation = 0;
  let wanted = "";
  let expectedOffset = 0;
  let deadline = 0;
  const opened = new Map<number, { generation: number; deadline: number }>();
  return {
    entries, address, label, parent, status, hidden, loading,
    list(path: string, now: number) {
      generation = ++sequence; wanted = path; expectedOffset = 0; deadline = now + 10;
      address.set(path); label.set(""); entries.set([]); loading.set(true); status.set("Loading...");
      send({ t: "files-list", request: generation, path, offset: 0, hidden: hidden() });
    },
    cancel() { generation = ++sequence; loading.set(false); },
    open(path: string, now: number) {
      const request = ++sequence;
      opened.set(request, { generation, deadline: now + 10 });
      status.set("Opening...");
      send({ t: "files-open", request, path });
    },
    accept(value: unknown, now: number): boolean {
      if (!value || typeof value !== "object") return false;
      const v = value as Record<string, any>;
      if (v.t !== "files") return false;
      const launch = opened.get(v.request);
      if (launch) {
        opened.delete(v.request);
        if (launch.generation === generation) status.set(typeof v.error === "string" ? v.error : "Opened in macOS");
        return false;
      }
      if (v.request !== generation) return false;
      if (typeof v.error === "string") {
        status.set(v.error); loading.set(false); return true;
      }
      if (v.offset !== expectedOffset || !Array.isArray(v.entries) || v.entries.length > 32 ||
          !v.entries.every((e: HostFile) => e && typeof e.path === "string" && e.path.startsWith("/") &&
            typeof e.name === "string" && ["directory", "application", "file"].includes(e.kind) && Number.isFinite(e.size) && (e.icon === undefined || validNativeIcon(e.icon))) ||
          !Number.isSafeInteger(v.next) || v.next !== expectedOffset + v.entries.length ||
          typeof v.path !== "string" || typeof v.label !== "string" || typeof v.parent !== "string") return false;
      entries.set([...entries(), ...v.entries]);
      address.set(v.path); label.set(v.label); parent.set(v.parent);
      expectedOffset = v.next; deadline = now + 10;
      if (v.done === true) {
        status.set(`${entries().length} items`); loading.set(false);
      } else if (v.entries.length > 0) {
        status.set(`Loading ${entries().length} items...`);
        send({ t: "files-list", request: generation, path: wanted, offset: expectedOffset, hidden: hidden() });
      }
      return true;
    },
    tick(now: number) {
      for (const [id, launch] of opened) if (now > launch.deadline) {
        opened.delete(id);
        if (launch.generation === generation) status.set("No launch reply. Refresh to reconnect.");
      }
      if (loading() && now > deadline) { loading.set(false); status.set("File service unavailable. Refresh to retry."); }
    },
  };
}
export type HostFiles = ReturnType<typeof createHostFiles>;
