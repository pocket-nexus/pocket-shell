// The demo's live state: the worker's sensor and scan snapshots and serial
// records, the board's device status and the radio's status, read once per
// frame or every few frames, and the commands sent back to the worker.
import { createSignal } from "solid-js";
import { deviceStatus, type DeviceStatus } from "@pocketjs/framework/device";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { wifiStatus, type WifiStatus } from "@pocketjs/framework/wifi";
import { worker } from "@pocketjs/framework/worker/channels";
import {
  decodeScan, decodeSensors, emptySensors, encodeCommand, type Scan, type Sensors,
} from "./protocol";
import { drainAudioEvents, plugged } from "./sound";

export interface SerialLine { kind: number; text: string }

const [sensors, setSensors] = createSignal<Sensors>(emptySensors());
const [scan, setScan] = createSignal<Scan>({ sequence: 0, bus: 0, state: 0, addresses: [] });
const [device, setDevice] = createSignal<DeviceStatus | null>(deviceStatus());
const [wifi, setWifi] = createSignal<WifiStatus | null>(wifiStatus());
const [toast, setToast] = createSignal<string>();
export { device, scan, sensors, toast, wifi };

let toastFrames = 0;
/** A toast for two seconds, as the factory firmware shows one. */
export function notify(text: string): void {
  setToast(text);
  toastFrames = 60;
}

export function dismissToast(): void {
  setToast(undefined);
  toastFrames = 0;
}

let sequence = 0;
const commands = () => worker.channel("commands");
/** Send one command record; the sequence number it carries, 0 when the ring
 *  was full. */
export function send(command: number, fill?: (view: DataView, bytes: Uint8Array) => void): number {
  const next = ++sequence;
  return commands().publish(encodeCommand(command, next, fill)) ? next : 0;
}

/** Serial records since the last call. */
let serialListener: ((kind: number, data: Uint8Array) => void) | undefined;
export function onSerial(listener: ((kind: number, data: Uint8Array) => void) | undefined): void {
  serialListener = listener;
}

/** Re-read the device status now (after an op that changed it). */
export function refreshDevice(): void {
  setDevice(deviceStatus());
}

let frame = 0;
let pendingSensors: Uint8Array | undefined;
let ports: Record<string, boolean> | undefined;
export function startStore(): void {
  const sensorsChannel = worker.channel("sensors");
  const scanChannel = worker.channel("scan");
  const serialChannel = worker.channel("serial");
  onFrame(() => {
    ++frame;
    // The panels redraw at most ten times a second.
    let latest: Uint8Array | undefined;
    for (const record of sensorsChannel.observe()) latest = record.copy();
    if (latest) pendingSensors = latest;
    if (pendingSensors && frame % 3 === 0) {
      setSensors(decodeSensors(pendingSensors));
      pendingSensors = undefined;
    }
    for (const record of scanChannel.observe()) setScan(decodeScan(record.copy()));
    for (const record of serialChannel.observe()) {
      const bytes = record.copy();
      serialListener?.(bytes[0]!, bytes.subarray(2, 2 + bytes[1]!));
    }
    drainAudioEvents();
    if (frame % 15 === 0) {
      const status = deviceStatus();
      setDevice(status);
      // A plug that comes or goes shows a toast with a two-note sound.
      if (status) {
        const now: Record<string, boolean> = {};
        for (const port of status.ports) now[port.id] = port.connected;
        if (ports) {
          for (const port of status.ports) {
            if (port.id !== "usb-c" && ports[port.id] !== port.connected) {
              notify(`${port.label} ${port.connected ? "connected" : "disconnected"}`);
              plugged(port.connected);
            }
          }
        }
        ports = now;
      }
    }
    if (frame % 15 === 7) setWifi(wifiStatus());
    if (toastFrames > 0 && --toastFrames === 0) setToast(undefined);
  });
}
