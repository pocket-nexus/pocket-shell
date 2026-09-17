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

export const DEVICE_LAYOUT = {
  sidebar: 168, toolbar: 38, header: 24, row: 32,
  status: 22, details: 94, treeTop: 8, treeRow: 28,
} as const;

export type DeviceClass = "handheld" | "media-player";
export type DevicePlace = "all" | DeviceClass;
export const DEVICE_PLACES = [
  { id: "all", label: "Connected devices", icon: "devices" },
  { id: "handheld", label: "Game consoles", icon: "handheld" },
  { id: "media-player", label: "Media players", icon: "media-player" },
] as const;
export const deviceClass = (d: ConnectedDevice): DeviceClass => d.kind === "psp" ? "handheld" : "media-player";
export const deviceClassName = (d: ConnectedDevice): string => d.kind === "psp" ? "Game console" : "Media player";

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

/** Explorer navigation and selection are local to each window. Discovery is shared. */
export function createDevicesWindow(
  inventory: ReturnType<typeof createDeviceInventory>,
  viewport: () => { w: number; h: number },
  refresh: () => void,
) {
  const L = DEVICE_LAYOUT;
  const selected = createState<string | null>(null);
  const expanded = createState(true);
  const offset = createState(0);
  const history = createState<{ items: DevicePlace[]; at: number }>({ items: ["all"], at: 0 });
  const descending = createState(false);
  const place = () => history().items[history().at]!;
  const label = () => DEVICE_PLACES.find(p => p.id === place())!.label;
  const filtered = () => inventory.devices()
    .filter(d => place() === "all" || deviceClass(d) === place())
    .sort((a, b) => (a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) * (descending() ? -1 : 1));
  const capacity = () => Math.max(1, Math.floor((viewport().h - L.toolbar - L.header - L.details - L.status) / L.row));
  const nameWidth = () => Math.max(132, Math.floor((viewport().w - L.sidebar - 12) * 0.49));
  const visible = () => filtered().slice(offset(), offset() + capacity());
  const current = () => filtered().find(d => d.id === selected());
  const clampOffset = (value: number) => offset.set(Math.min(Math.max(0, filtered().length - capacity()), Math.max(0, value)));
  const clearSelection = () => { selected.set(null); offset.set(0); };
  const go = (next: DevicePlace) => {
    if (next !== place()) {
      const h = history();
      history.set({ items: [...h.items.slice(0, h.at + 1), next], at: h.at + 1 });
    }
    clearSelection();
  };
  const back = () => {
    const h = history();
    if (h.at > 0) { history.set({ ...h, at: h.at - 1 }); clearSelection(); }
  };
  const forward = () => {
    const h = history();
    if (h.at < h.items.length - 1) { history.set({ ...h, at: h.at + 1 }); clearSelection(); }
  };
  return {
    ...inventory, selected, expanded, visible, current, refresh, viewport, capacity,
    offset, filtered, place, label, history, descending, go, back, forward, nameWidth,
    sync() {
      if (!filtered().some(d => d.id === selected())) selected.set(null);
      clampOffset(offset());
    },
    click(x: number, y: number) {
      if (x < 0 || y < 0 || x >= viewport().w || y >= viewport().h) return;
      if (y < L.toolbar) {
        if (y < 7 || y >= 31) return;
        if (x >= 8 && x < 36) back();
        else if (x >= 40 && x < 68) forward();
        else if (x >= viewport().w - 86 && x < viewport().w - 8) refresh();
        return;
      }
      if (y >= viewport().h - L.status) return;
      if (x < L.sidebar) {
        const row = Math.floor((y - L.toolbar - L.treeTop) / L.treeRow);
        if (row === 0) {
          if (x < 24) expanded.set(!expanded());
          else go("all");
        } else if (expanded() && (row === 1 || row === 2)) go(DEVICE_PLACES[row]!.id);
        return;
      }
      if (y < L.toolbar + L.header) {
        if (x < L.sidebar + nameWidth()) {
          descending.set(!descending());
          const index = filtered().findIndex(d => d.id === selected());
          clampOffset(index < 0 ? 0 : index);
        }
      } else if (y < viewport().h - L.status - L.details) {
        const index = Math.floor((y - L.toolbar - L.header) / L.row);
        if (x >= viewport().w - 12 && filtered().length > capacity()) {
          const height = viewport().h - L.toolbar - L.header - L.status - L.details;
          clampOffset(Math.round((y - L.toolbar - L.header) / height * (filtered().length - capacity())));
        } else selected.set(visible()[index]?.id ?? null);
      }
    },
    key(key: string) {
      const k = key.toLowerCase();
      if (k === "escape") return selected.set(null);
      if (k === "backspace" || k === "left") return back();
      if (k === "right") return forward();
      if (k !== "up" && k !== "down" && k !== "home" && k !== "end") return;
      const devices = filtered();
      const index = devices.findIndex(d => d.id === selected());
      const next = k === "home" ? 0 : k === "end" ? devices.length - 1
        : Math.min(devices.length - 1, Math.max(0, index + (k === "down" ? 1 : -1)));
      if (devices[next]) {
        selected.set(devices[next]!.id);
        if (next < offset()) clampOffset(next);
        else if (next >= offset() + capacity()) clampOffset(next - capacity() + 1);
      }
    },
    scroll(dy: number) { clampOffset(offset() + Math.sign(dy)); },
  };
}

export type DevicesData = ReturnType<typeof createDevicesWindow>;
