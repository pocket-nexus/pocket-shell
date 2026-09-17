// SPDX-License-Identifier: GPL-3.0-only
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
