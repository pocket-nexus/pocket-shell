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
  sidebar: 216,
  toolbar: 56,
  section: 44,
  row: 52,
  status: 28,
  cardTop: 132,
  cardRow: 76,
} as const;

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

/** Client-local input model. The desktop owns chrome, focus and service polling. */
export function createDevicesWindow(
  inventory: ReturnType<typeof createDeviceInventory>,
  viewport: () => { w: number; h: number },
  refresh: () => void,
) {
  const L = DEVICE_LAYOUT;
  const selected = createState<string | null>(null);
  const expanded = createState(true);
  const offset = createState(0);
  const capacity = () => Math.max(1, Math.floor((viewport().h - L.cardTop - L.status) / L.cardRow));
  const visible = () => inventory.devices().slice(offset(), offset() + capacity());
  const current = () => inventory.devices().find(d => d.id === selected());
  const clampOffset = (value: number) => offset.set(Math.min(Math.max(0, inventory.devices().length - capacity()), Math.max(0, value)));
  return {
    ...inventory, selected, expanded, visible, current, refresh,
    sync() {
      if (!inventory.devices().some(d => d.id === selected())) selected.set(null);
      clampOffset(offset());
    },
    click(x: number, y: number) {
      if (y < L.toolbar) {
        if (x >= viewport().w - 104) refresh();
        else if (x < 100) selected.set(null);
      } else if (y < viewport().h - L.status) {
        if (x < L.sidebar) {
          if (y < L.toolbar + L.section) expanded.set(!expanded());
          else if (expanded()) {
            const device = visible()[Math.floor((y - L.toolbar - L.section) / L.row)];
            if (device) selected.set(device.id);
          }
        } else if (!current() && y >= L.cardTop) {
          const device = visible()[Math.floor((y - L.cardTop) / L.cardRow)];
          if (device) selected.set(device.id);
        }
      }
    },
    key(key: string) {
      const k = key.toLowerCase();
      if (k === "escape") return selected.set(null);
      if (k === "left") return expanded.set(false);
      if (k === "right") return expanded.set(true);
      if (k !== "up" && k !== "down") return;
      expanded.set(true);
      const devices = inventory.devices();
      const index = devices.findIndex(d => d.id === selected());
      const next = Math.min(devices.length - 1, Math.max(0, index + (k === "down" ? 1 : -1)));
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
