// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "bun:test";
import { resolveDesktopSystem } from "../scripts/system-plan.ts";
import { createDeviceInventory, createDevicesWindow, deviceSnapshot } from "../src/system-ui/devices.ts";
import { AQUA_THEME, CLASSIC_THEME, XP_THEME } from "../src/system-ui/theme.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("macOS keeps the shared desktop entry without preinstalled demo packages", async () => {
  const mac = await resolveDesktopSystem("macos-app");
  expect(mac.applications).toEqual([]);
  expect(mac.installation.installedPackages).toEqual([mac.roles.systemUI]);
  expect(mac.systemUI.plan.app.entry).toBe("src/system-ui/main.tsx");
  for (const target of ["linux-app", "web-app"] as const) {
    expect((await resolveDesktopSystem(target)).applications).toHaveLength(11);
  }
});

test("device categories retain identity through sorting, history and removal", () => {
  const inventory = createDeviceInventory();
  const psp = { id: "psp", kind: "psp", name: "PSP", connection: "USB", serial: "", vendor: 1, product: 1 };
  const ipod = { ...psp, id: "ipod", kind: "ipodtouch4", name: "iPod" };
  inventory.accept({ t: "devices", devices: [psp, ipod] }, 0);
  const first = createDevicesWindow(inventory, () => ({ w: 560, h: 280 }), () => {});
  const second = createDevicesWindow(inventory, () => ({ w: 560, h: 280 }), () => {});
  first.go("handheld"); first.key("Home");
  expect(first.current()?.id).toBe("psp");
  expect(second.filtered()).toHaveLength(2);
  first.back(); first.key("Home");
  expect(first.current()?.id).toBe("ipod");
  first.click(200, 45); // sort header; selection is a stable device id
  expect(first.current()?.id).toBe("ipod");
  expect(first.filtered()[0]?.id).toBe("psp");
  first.forward();
  expect(first.place()).toBe("handheld");
  inventory.accept({ t: "devices", devices: [ipod] }, 1); first.sync();
  expect(first.current()).toBeUndefined();
  expect(first.filtered()).toHaveLength(0);
  expect(second.filtered()).toHaveLength(1);
});

test("each theme supplies application and category art at both render densities", () => {
  for (const name of ["files", "devices", "handheld", "media-player"] as const) {
    for (const size of [16, 32] as const) {
      const paths = [CLASSIC_THEME, XP_THEME, AQUA_THEME].map(theme => theme.icon(name, size));
      expect(new Set(paths).size).toBe(3);
      for (const path of paths) {
        for (const scale of [1, 2]) {
          const file = path.replace(/-(16|32)\.png$/, `-${size * scale}.png`);
          const png = readFileSync(resolve(import.meta.dir, "../assets", file));
          expect(png.readUInt32BE(16)).toBe(size * scale);
          expect(png.readUInt32BE(20)).toBe(size * scale);
        }
      }
    }
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
