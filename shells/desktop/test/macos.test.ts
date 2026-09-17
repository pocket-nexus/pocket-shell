// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "bun:test";
import { connect } from "node:net";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "../scripts/system-plan.ts";
import { deviceSnapshot } from "../src/system-ui/devices.ts";

const contents = resolve(ROOT, "dist/Pocket Shell.app/Contents");
const binary = resolve(contents, "MacOS/PocketShell");

test("the signed bundle contains the desktop with Devices and the original icon", async () => {
  expect(readdirSync(resolve(contents, "Resources/dist")).sort()).toEqual([
    "pocket-desktop-system-ui.js", "pocket-desktop-system-ui.pak",
  ]);
  const original = new Uint8Array(await Bun.file(resolve(ROOT, "assets/macos/AppIcon.icns")).arrayBuffer());
  const bundled = new Uint8Array(await Bun.file(resolve(contents, "Resources/AppIcon.icns")).arrayBuffer());
  expect(bundled).toEqual(original);
  expect(Bun.spawnSync(["codesign", "--verify", "--strict", resolve(contents, "..")]).exitCode).toBe(0);
  expect(Bun.spawnSync([binary, "--self-test"]).exitCode).toBe(0);
  const inventory = Bun.spawnSync([binary, "--devices"], { cwd: "/tmp" });
  expect(inventory.exitCode).toBe(0);
  expect(deviceSnapshot(JSON.parse(inventory.stdout.toString()))).not.toBeNull();
});

test("native companion handles fragmented handshakes, refresh and bounded messages", async () => {
  const service = Bun.spawn([binary, "--device-service"], { stdout: "pipe", stderr: "pipe" });
  const reader = service.stdout.getReader();
  let endpoint = "";
  let client: ReturnType<typeof connect> | undefined;
  try {
    while (!endpoint.includes("\n")) {
      const next = await reader.read();
      if (next.done) throw new Error("Device service exited before binding");
      endpoint += new TextDecoder().decode(next.value);
    }
    expect(endpoint.trim()).toMatch(/^127\.0\.0\.1:\d+$/);
    const port = Number(endpoint.trim().split(":")[1]);
    client = connect({ host: "127.0.0.1", port });
    const socket = client;
    let pending = Buffer.alloc(0);
    let ended = false;
    socket.on("data", chunk => { pending = Buffer.concat([pending, typeof chunk === "string" ? Buffer.from(chunk) : chunk]); });
    socket.on("close", () => { ended = true; });
    socket.on("error", () => { ended = true; });
    async function bytes(count: number): Promise<Buffer> {
      const deadline = Date.now() + 4000;
      while (pending.length < count && !ended && Date.now() < deadline) await Bun.sleep(10);
      if (pending.length < count) throw new Error("Incomplete native companion reply");
      const out = pending.subarray(0, count);
      pending = pending.subarray(count);
      return out;
    }
    const app = Buffer.from("pocket-desktop-system-ui");
    socket.write(Buffer.from([0x50, 0x4b]));
    await Bun.sleep(20);
    socket.write(Buffer.concat([Buffer.from([0x4e, 0x54, 1, 0, app.length]), app]));
    expect(await bytes(8)).toEqual(Buffer.from([0x50, 0x4b, 0x4e, 0x54, 1, 0, 0, 0]));
    async function inventory() {
      const header = await bytes(8);
      expect(header[0]).toBe(0x10);
      const length = header.readUInt32LE(4);
      expect(length).toBeLessThan(256 * 1024);
      expect(deviceSnapshot(JSON.parse((await bytes(length)).toString()))).not.toBeNull();
    }
    await inventory();
    const request = Buffer.from(JSON.stringify({ t: "devices-refresh" }));
    const header = Buffer.alloc(8);
    header[0] = 0x10;
    header.writeUInt32LE(request.length, 4);
    socket.write(Buffer.concat([header, request]));
    await inventory();
    const oversized = Buffer.alloc(8);
    oversized[0] = 0x10;
    oversized.writeUInt32LE(4097, 4);
    socket.write(oversized);
    const deadline = Date.now() + 2500;
    while (!ended && Date.now() < deadline) await Bun.sleep(10);
    expect(ended).toBe(true);
  } finally {
    client?.destroy();
    reader.releaseLock();
    service.kill();
    await service.exited;
  }
}, 10000);
