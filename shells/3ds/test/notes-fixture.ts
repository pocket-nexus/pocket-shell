// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/notes-fixture.ts — an fs module in memory for the Notes
// sims, shaped by PocketJS contracts/spec/fs.ts: nine synchronous ops over a
// tree of byte files under one root, JSON lines in and out. The sim's
// bundle loader clears `globalThis.fs` before it evaluates a guest, so the
// fixture installs the namespace as an accessor whose setter ignores that
// clear; uninstall() puts a plain property back.

/** A text payload crosses as a JSON string, bytes as {"$b": base64}. */
const BLOB_KEY = "$b";
const WRITE_APPEND = 1;
const MAX_IO_BYTES = 64 * 1024;

export interface MemoryFs {
  ns: Record<string, (...args: never[]) => string | number>;
  files: Map<string, Uint8Array>;
  /** The file's text, or null when none. */
  text(path: string): string | null;
  install(): void;
  uninstall(): void;
}

function parent(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

export function createMemoryFs(): MemoryFs {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  let lastError = "";
  const fail = (error: string): 1 => {
    lastError = error;
    return 1;
  };
  const ok = (): 0 => {
    lastError = "";
    return 0;
  };
  const line = (value: unknown): string => {
    const text = JSON.stringify(value);
    lastError = typeof value === "object" && value !== null && "error" in value ? String((value as { error: string }).error) : "";
    return text;
  };
  const mkdirs = (path: string): boolean => {
    if (path === "") return true;
    if (files.has(path)) return false;
    if (!mkdirs(parent(path))) return false;
    dirs.add(path);
    return true;
  };
  const isDir = (path: string) => path === "" || dirs.has(path);
  const childrenOf = (path: string) => {
    const prefix = path === "" ? "" : `${path}/`;
    const names = new Set<string>();
    for (const file of files.keys()) if (file.startsWith(prefix) && !file.slice(prefix.length).includes("/")) names.add(file.slice(prefix.length));
    for (const dir of dirs) if (dir.startsWith(prefix) && dir !== path && !dir.slice(prefix.length).includes("/")) names.add(dir.slice(prefix.length));
    return [...names].sort((a, b) => {
      const ca = [...a].map((ch) => ch.codePointAt(0)!);
      const cb = [...b].map((ch) => ch.codePointAt(0)!);
      for (let i = 0; i < Math.min(ca.length, cb.length); i++) if (ca[i] !== cb[i]) return ca[i]! - cb[i]!;
      return ca.length - cb.length;
    });
  };
  const decode = (payload: string): Uint8Array | null => {
    const value = JSON.parse(payload) as unknown;
    if (typeof value === "string") return new TextEncoder().encode(value);
    if (value && typeof value === "object" && typeof (value as Record<string, unknown>)[BLOB_KEY] === "string") {
      return new Uint8Array(Buffer.from((value as Record<string, string>)[BLOB_KEY]!, "base64"));
    }
    return null;
  };

  const ns = {
    read(path: string, offset: number, maxBytes: number): string {
      const bytes = files.get(path);
      if (!bytes) return line({ error: isDir(path) ? "is a directory" : "not found" });
      if (maxBytes < 1 || maxBytes > MAX_IO_BYTES) return line({ error: "bad length" });
      const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + maxBytes));
      return line({ data: { [BLOB_KEY]: Buffer.from(chunk).toString("base64") }, size: bytes.length, eof: offset + chunk.length >= bytes.length });
    },
    write(path: string, data: string, mode: number): number {
      if (path === "" || isDir(path)) return fail("is a directory");
      const bytes = decode(data);
      if (!bytes) return fail("bad payload");
      if (!mkdirs(parent(path))) return fail("not a directory");
      const previous = mode === WRITE_APPEND ? files.get(path) : undefined;
      if (previous) {
        const joined = new Uint8Array(previous.length + bytes.length);
        joined.set(previous, 0);
        joined.set(bytes, previous.length);
        files.set(path, joined);
      } else {
        files.set(path, bytes);
      }
      return ok();
    },
    remove(path: string, recursive: number): number {
      if (path === "") return fail("is the root");
      if (files.delete(path)) return ok();
      if (!dirs.has(path)) return fail("not found");
      const children = childrenOf(path);
      if (children.length && !recursive) return fail("not empty");
      for (const file of [...files.keys()]) if (file.startsWith(`${path}/`)) files.delete(file);
      for (const dir of [...dirs]) if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
      return ok();
    },
    list(path: string, offset: number): string {
      if (!isDir(path)) return line({ error: files.has(path) ? "not a directory" : "not found" });
      const entries = childrenOf(path).slice(offset).map((name) => {
        const full = path === "" ? name : `${path}/${name}`;
        const file = files.get(full);
        return file ? { name, kind: "file", size: file.length } : { name, kind: "dir", size: 0 };
      });
      return line({ entries, eof: true });
    },
    stat(path: string): string {
      const file = files.get(path);
      if (file) return line({ kind: "file", size: file.length });
      if (isDir(path)) return line({ kind: "dir", size: 0 });
      return line({ error: "not found" });
    },
    mkdir(path: string): number {
      return mkdirs(path) ? ok() : fail("not a directory");
    },
    rename(from: string, to: string): number {
      const file = files.get(from);
      if (!file) return fail(dirs.has(from) ? "unsupported" : "not found");
      if (isDir(to)) return fail("is a directory");
      if (!isDir(parent(to))) return fail("not found");
      files.delete(from);
      files.set(to, file);
      return ok();
    },
    usage(): string {
      let used = 0;
      for (const file of files.values()) used += file.length;
      return line({ usedBytes: used, quotaBytes: 0 });
    },
    lastError(): string {
      return lastError;
    },
  };

  const fs: MemoryFs = {
    ns,
    files,
    text(path) {
      const bytes = files.get(path);
      return bytes ? new TextDecoder().decode(bytes) : null;
    },
    install() {
      Object.defineProperty(globalThis, "fs", { configurable: true, enumerable: true, get: () => ns, set: () => undefined });
    },
    uninstall() {
      Object.defineProperty(globalThis, "fs", { configurable: true, enumerable: true, writable: true, value: undefined });
    },
  };
  return fs;
}
