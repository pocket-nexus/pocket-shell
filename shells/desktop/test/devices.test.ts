// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "bun:test";
import { resolveDesktopSystem } from "../scripts/system-plan.ts";
import { deviceSnapshot } from "../src/system-ui/devices.ts";

test("macOS keeps the shared desktop entry without preinstalled demo packages", async () => {
  const mac = await resolveDesktopSystem("macos-app");
  expect(mac.applications).toEqual([]);
  expect(mac.installation.installedPackages).toEqual([mac.roles.systemUI]);
  expect(mac.systemUI.plan.app.entry).toBe("src/system-ui/main.tsx");
  for (const target of ["linux-app", "web-app"] as const) {
    expect((await resolveDesktopSystem(target)).applications).toHaveLength(11);
  }
});

test("device snapshots reject malformed or ambiguous identities", () => {
  const psp = { id: "psp-1", kind: "psp", name: "PSP", connection: "PSPLINK USB", serial: "", vendor: 0x054c, product: 0x01c9 } as const;
  expect(deviceSnapshot({ t: "devices", devices: [psp] })?.devices).toEqual([psp]);
  expect(deviceSnapshot({ t: "devices", devices: [] })?.devices).toEqual([]);
  expect(deviceSnapshot({ t: "devices", devices: [psp, psp] })).toBeNull();
  expect(deviceSnapshot({ t: "devices", devices: [{ ...psp, kind: "unknown" }] })).toBeNull();
  expect(deviceSnapshot({ t: "devices", devices: [{ ...psp, id: null }] })).toBeNull();
  expect(deviceSnapshot({ t: "devices", devices: "bad" })).toBeNull();
  expect(deviceSnapshot({ t: "devices", devices: Array(65).fill(psp) })).toBeNull();
  expect(deviceSnapshot({ t: "devices", devices: [], error: "USB unavailable" })?.error).toBe("USB unavailable");
});
