// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "bun:test";
import { resolveDesktopSystem } from "../scripts/system-plan.ts";
import { createDeviceInventory, createDevicesWindow, deviceSnapshot } from "../src/system-ui/devices.ts";
import { AQUA_THEME, CLASSIC_THEME, XP_THEME } from "../src/system-ui/theme.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("macOS installs the shared desktop and three independent example packages", async () => {
  const mac = await resolveDesktopSystem("macos-app");
  expect(mac.applications.map(app => app.package).sort()).toEqual(["dev.pocket-stack.cards", "dev.pocket-stack.motions", "dev.pocket-stack.stats"]);
  expect(mac.installation.installedPackages.slice().sort()).toEqual([mac.roles.systemUI, ...mac.applications.map(app => app.package)].sort());
  expect(mac.systemUI.plan.app.entry).toBe("src/system-ui/main.tsx");
  for (const target of ["linux-app", "web-app"] as const) {
    expect((await resolveDesktopSystem(target)).applications).toHaveLength(11);
  }
});

test("device views retain identity through mode switches, sorting, resizing and removal", () => {
  const inventory = createDeviceInventory();
  const psp = { id: "psp", kind: "psp", name: "Sony PSP", connection: "USB", serial: "", vendor: 1, product: 1 };
  const ipod = { ...psp, id: "ipod", kind: "ipodtouch4", name: "iPod touch 4" };
  inventory.accept({ t: "devices", devices: [psp, ipod] }, 0);
  const viewport = { w: 560, h: 280 };
  const first = createDevicesWindow(inventory, () => viewport, () => {});
  const second = createDevicesWindow(inventory, () => viewport, () => {});
  first.key("Home"); first.key("Right");
  expect(first.current()?.id).toBe("psp");
  first.setMode("list");
  expect(second.mode()).toBe("icons");
  expect(first.current()?.id).toBe("psp");
  first.click(100, 35);
  expect(first.filtered()[0]?.id).toBe("psp");
  expect(first.current()?.id).toBe("psp");
  inventory.accept({ t: "devices", devices: [ipod] }, 1); first.sync();
  expect(first.current()).toBeUndefined();
  expect(first.filtered()).toHaveLength(1);
  inventory.accept({ t: "devices", devices: Array.from({ length: 40 }, (_, i) => ({ ...psp, id: `psp-${i}`, name: `PSP ${String(i).padStart(2, "0")}` })) }, 2);
  first.descending.set(false); first.setMode("icons"); first.key("End");
  expect(first.visible().at(-1)?.id).toBe("psp-39");
  viewport.w = 360; viewport.h = 180; first.sync(); first.key("End");
  expect(first.offset() % first.columns()).toBe(0);
  expect(first.visible().some(d => d.id === first.selected())).toBe(true);
  first.setMode("list");
  expect(first.visible().some(d => d.id === first.selected())).toBe(true);
  first.key("Home");
  expect(first.offset()).toBe(0);
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
