// SPDX-License-Identifier: GPL-3.0-only
import { createState } from "./reactivity.ts";
export interface ConnectedDevice {
  id: string;
  kind: "psp" | "ipodtouch4";
  name: string;
  connection: string;
  serial: string;
  vendor: number;
  product: number;
}

export interface DeviceSnapshot {
  t: "devices";
  devices: ConnectedDevice[];
  error?: string;
}

/** Validate the native companion boundary before changing visible state. */
export function deviceSnapshot(value: unknown): DeviceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (message.t !== "devices" || !Array.isArray(message.devices) || message.devices.length > 64) return null;
  const ids = new Set<string>();
  const devices: ConnectedDevice[] = [];
  for (const item of message.devices) {
    if (!item || typeof item !== "object") return null;
    const d = item as ConnectedDevice;
    if (!["psp", "ipodtouch4"].includes(d.kind) ||
        ![d.id, d.name, d.connection, d.serial].every(s => typeof s === "string" && s.length <= 256) ||
        !d.id || ids.has(d.id) || !Number.isInteger(d.vendor) || !Number.isInteger(d.product)) return null;
    ids.add(d.id);
    devices.push(d);
  }
  return { t: "devices", devices, ...(typeof message.error === "string" ? { error: message.error.slice(0, 256) } : {}) };
}

export const DEVICE_LAYOUT = { toolbar: 30, header: 20, row: 22, status: 20, cellW: 112, cellH: 76, pad: 6 } as const;
export type DeviceClass = "handheld" | "media-player";
export const deviceClass = (d: ConnectedDevice): DeviceClass => d.kind === "psp" ? "handheld" : "media-player";

/** One discovery feed per desktop; windows own only navigation state. */
export function createDeviceInventory() {
  const devices = createState<ConnectedDevice[]>([]);
  const received = createState(false);
  const status = createState("Looking for connected devices...");
  let lastSnapshot = -1;
  return {
    devices, received, status,
    accept(value: unknown, now: number) {
      const snapshot = deviceSnapshot(value);
      if (!snapshot) return;
      lastSnapshot = now;
      received.set(true);
      if (JSON.stringify(devices()) !== JSON.stringify(snapshot.devices)) devices.set(snapshot.devices);
      status.set(snapshot.error ?? `${snapshot.devices.length} ${snapshot.devices.length === 1 ? "device" : "devices"} connected via USB`);
    },
    tick(now: number) {
      if ((lastSnapshot >= 0 && now - lastSnapshot > 4) || (lastSnapshot < 0 && now > 5)) {
        received.set(true);
        if (devices().length) devices.set([]);
        status.set("Device discovery unavailable. Reopen Pocket Shell to reconnect.");
      }
    },
  };
}

/** Discovery is shared; view mode, sorting, scrolling and selection belong to each window. */
export function createDevicesWindow(
  inventory: ReturnType<typeof createDeviceInventory>,
  viewport: () => { w: number; h: number },
  refresh: () => void,
) {
  const L = DEVICE_LAYOUT;
  const selected = createState<string | null>(null);
  const mode = createState<"icons" | "list">("icons");
  const offset = createState(0);
  const descending = createState(false);
  const filtered = () => [...inventory.devices()].sort((a, b) =>
    (a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) * (descending() ? -1 : 1));
  const columns = () => mode() === "list" ? 1 : Math.max(1, Math.floor((viewport().w - 12 - L.pad * 2) / L.cellW));
  const contentTop = () => L.toolbar + (mode() === "list" ? L.header : L.pad);
  const rowHeight = () => mode() === "list" ? L.row : L.cellH;
  const capacity = () => columns() * Math.max(1, Math.floor((viewport().h - contentTop() - L.status) / rowHeight()));
  const maxOffset = () => Math.max(0, Math.ceil((filtered().length - capacity()) / columns()) * columns());
  const clampOffset = (value: number) => offset.set(Math.min(maxOffset(), Math.max(0, Math.floor(value / columns()) * columns())));
  const visible = () => filtered().slice(offset(), offset() + capacity());
  const current = () => filtered().find(d => d.id === selected());
  const reveal = () => {
    const index = filtered().findIndex(d => d.id === selected());
    if (index >= 0 && index < offset()) clampOffset(index);
    else if (index >= offset() + capacity()) clampOffset(index - capacity() + columns());
    else clampOffset(offset());
  };
  const setMode = (next: "icons" | "list") => { mode.set(next); offset.set(0); reveal(); };
  return {
    ...inventory, selected, mode, setMode, visible, current, refresh, viewport, capacity,
    offset, filtered, descending, columns, contentTop, rowHeight, maxOffset,
    nameWidth: () => Math.floor((viewport().w - 12) * .46),
    sync() { if (!current()) selected.set(null); clampOffset(offset()); },
    click(x: number, y: number) {
      const { w, h } = viewport();
      if (x < 0 || y < 0 || x >= w || y >= h - L.status) return;
      if (y < L.toolbar) {
        if (y < 4 || y >= 26) return;
        if (x >= 6 && x < 70) refresh();
        else if (x >= w - 136 && x < w - 72) setMode("icons");
        else if (x >= w - 70 && x < w - 6) setMode("list");
        return;
      }
      if (mode() === "list" && y < contentTop()) {
        if (x < w * .46) { descending.set(!descending()); reveal(); }
        return;
      }
      if (y < contentTop()) return;
      if (x >= w - 12 && maxOffset() > 0) {
        clampOffset(Math.round((y - contentTop()) / (h - contentTop() - L.status) * maxOffset()));
        return;
      }
      const col = mode() === "list" ? 0 : Math.floor((x - L.pad) / L.cellW);
      const row = Math.floor((y - contentTop()) / rowHeight());
      selected.set(col >= 0 && col < columns() ? visible()[row * columns() + col]?.id ?? null : null);
    },
    key(key: string) {
      const k = key.toLowerCase();
      if (k === "escape") return selected.set(null);
      if (!["up", "down", "left", "right", "home", "end", "pageup", "pagedown"].includes(k)) return;
      const devices = filtered(), index = devices.findIndex(d => d.id === selected());
      const delta = k === "up" ? -columns() : k === "down" ? columns() : k === "left" ? -1 : k === "right" ? 1 : k === "pageup" ? -capacity() : capacity();
      const next = k === "home" ? 0 : k === "end" ? devices.length - 1 : index < 0 ? 0 : Math.min(devices.length - 1, Math.max(0, index + delta));
      if (devices[next]) { selected.set(devices[next]!.id); reveal(); }
    },
    scroll(dy: number) { clampOffset(offset() + Math.sign(dy) * columns()); },
  };
}
export type DevicesData = ReturnType<typeof createDevicesWindow>;
