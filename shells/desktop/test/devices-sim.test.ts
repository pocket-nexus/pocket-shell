// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "bun:test";
import { bootWorld, treeHasText, type SimWorld } from "../../../vendor/pocketjs/hosts/sim/sim.ts";

function step(world: SimWorld, frames = 2) {
  for (let i = 0; i < frames; i++) {
    world.frame(0);
    for (let tick = 0; tick < world.ticksPerFrame; tick++) world.tick();
  }
}

test("Devices discovers, expands, selects, refreshes and removes disconnected devices", async () => {
  const inbox: string[] = [];
  const sent: string[] = [];
  const send = (message: object) => inbox.push(JSON.stringify(message));
  const world = await bootWorld("pocket-shell-devices", 60, {}, ops => {
    ops.svcOpen = (name: string) => name === "system-ui";
    ops.svcPoll = () => inbox.splice(0).join("\n");
    ops.svcSend = (line: string) => sent.push(line);
  }, { width: 800, height: 600 });
  const psp = { id: "psp-1", kind: "psp", name: "PSP", connection: "PSPLINK USB", serial: "", vendor: 0x054c, product: 0x01c9 };
  const ipod = { id: "ipod-1", kind: "ipodtouch4", name: "iPod touch 4", connection: "USB", serial: "fixture", vendor: 0x05ac, product: 0x129e };
  const has = (text: string) => treeHasText(world.getTree(), text);
  const click = (x: number, y: number) => {
    send({ t: "mouse", x, y, d: true });
    send({ t: "mouse", x, y, d: false });
    step(world);
  };
  step(world);
  expect(has("Looking for connected devices...")).toBe(true);
  for (const unwanted of ["Notepad", "Minesweeper", "Hero", "All Programs"]) expect(has(unwanted)).toBe(false);
  send({ t: "hello", w: 800, h: 600 });
  send({ t: "devices", devices: [psp, ipod] });
  step(world);
  expect(has("PSPLINK USB")).toBe(true);
  expect(has("iPod touch 4")).toBe(true);
  click(100, 125);
  expect(has("Device: Sony PlayStation Portable")).toBe(true);
  click(100, 78);
  expect(has("iPod touch 4")).toBe(false);
  click(100, 78);
  expect(has("iPod touch 4")).toBe(true);
  click(100, 175);
  expect(has("Device: Apple iPod touch (4th generation)")).toBe(true);
  click(750, 26);
  expect(sent).toContain(JSON.stringify({ t: "devices-refresh" }));
  // Identity, not row index, preserves selection when enumeration order changes.
  send({ t: "devices", devices: [ipod, psp] });
  step(world);
  expect(has("Device: Apple iPod touch (4th generation)")).toBe(true);
  send({ t: "devices", devices: [psp] });
  step(world);
  expect(has("Connected devices")).toBe(true);
  expect(has("iPod touch 4")).toBe(false);
  send({ t: "key", k: "t", cmd: true, sh: true });
  step(world);
  expect(has("Classic 98")).toBe(true);
  send({ t: "key", k: "t", cmd: true, sh: true });
  step(world);
  expect(has("Windows XP")).toBe(true);
  // No heartbeat means the old inventory must not continue to look connected.
  step(world, 250);
  expect(has("PSPLINK USB")).toBe(false);
  expect(has("Device discovery is unavailable. Reopen Pocket Shell to reconnect.")).toBe(true);
  send({ t: "devices", devices: [] });
  step(world);
  expect(has("No supported devices connected")).toBe(true);
  expect(has("0 devices connected via USB")).toBe(true);
}, 30000);
