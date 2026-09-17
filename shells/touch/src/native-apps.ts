// SPDX-License-Identifier: GPL-3.0-or-later
import { appTable, launchApp, closeApp, onNativeAppReturn, type NativeAppReturn } from "@pocketjs/framework/launcher";

// These home slots become actual apps only on a native navigation host.
// The mock catalog and its gesture tests remain usable on other hosts.
export const NATIVE_SLOTS = [
  { index: 4, id: "dev.pocket-stack.clear", name: "Clear", title: "Pocket Clear", color: "#e85b4b" },
  { index: 14, id: "dev.pocket-stack.voxel", name: "Voxel", title: "Pocket Voxel", color: "#665477" },
] as const;

export function nativeApps() {
  const table = appTable();
  if (table?.kind !== "native") return [];
  return NATIVE_SLOTS.flatMap(slot => {
    const entry = table.apps.find(app => app.id === slot.id);
    return entry ? [{ ...slot, ...entry }] : [];
  });
}

export { launchApp, closeApp, onNativeAppReturn, type NativeAppReturn };
