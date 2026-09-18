// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "bun:test";
import { connect } from "node:net";
import { readdirSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ROOT } from "../scripts/system-plan.ts";
import { deviceSnapshot } from "../src/system-ui/devices.ts";

const contents = resolve(ROOT, "dist/Pocket Shell.app/Contents");
const binary = resolve(contents, "MacOS/PocketShell");

test("the signed bundle contains the desktop with Devices and the original icon", async () => {
  const system = await Bun.file(resolve(contents, "Resources/pocket-desktop.system.plan.json")).json();
  expect(system.systemUI.plan.viewport.logical).toEqual([1024, 768]);
  const nativeOutputs = system.applications.filter((app: any) => app.plan.hostExtension?.kind === "desktop-native").flatMap((app: any) => [`${app.plan.app.output}.js`, `${app.plan.app.output}.pak`]);
  expect(readdirSync(resolve(contents, "Resources/dist")).sort()).toEqual([
    "cards-main.js", "cards-main.pak", "motions-main.js", "motions-main.pak",
    "pocket-desktop-system-ui.js", "pocket-desktop-system-ui.pak", "stats-main.js", "stats-main.pak",
    ...nativeOutputs,
  ].sort());
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
  const fixture = mkdtempSync(resolve(tmpdir(), "pocket-files-"));
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
    async function files(message: object, request: number) {
      const body = Buffer.from(JSON.stringify(message));
      const frame = Buffer.alloc(8); frame[0] = 0x10; frame.writeUInt32LE(body.length, 4);
      socket.write(Buffer.concat([frame, body]));
      while (true) {
        const header = await bytes(8);
        const payload = JSON.parse((await bytes(header.readUInt32LE(4))).toString());
        if (payload.t === "files" && payload.request === request) return payload;
        expect(payload.t).toBe("devices");
      }
    }
    for (let i = 0; i < 70; i++) await Bun.write(resolve(fixture, `File ${String(i).padStart(2, "0")}.txt`), "real file");
    await Bun.write(resolve(fixture, ".hidden"), "hidden");
    const first = await files({ t: "files-list", request: 1, path: fixture }, 1);
    expect(first.entries).toHaveLength(32);
    expect(first.total).toBe(70);
    expect(first.done).toBe(false);
    // Pagination is a stable host snapshot even if a file disappears mid-read.
    unlinkSync(resolve(fixture, "File 00.txt"));
    const second = await files({ t: "files-list", request: 1, path: fixture, offset: 32 }, 1);
    expect(second.entries[0].name).toBe("File 32.txt");
    const last = await files({ t: "files-list", request: 1, path: fixture, offset: 64 }, 1);
    expect(last.entries).toHaveLength(6);
    expect(last.done).toBe(true);
    const hidden = await files({ t: "files-list", request: 2, path: fixture, hidden: true }, 2);
    expect(hidden.entries.some((e: { name: string }) => e.name === ".hidden")).toBe(true);
    expect((await files({ t: "files-list", request: 3, path: "relative/path" }, 3)).error).toBe("Invalid file path");
    expect((await files({ t: "files-open", request: 4, path: resolve(fixture, "missing.app") }, 4)).error).toContain("no longer exists");
    let offset = 0;
    const apps: { name: string; path: string; kind: string; icon: string }[] = [];
    while (true) {
      const page = await files({ t: "files-list", request: 5, path: "native-apps", offset }, 5);
      expect(page.error).toBeUndefined();
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(26000);
      apps.push(...page.entries);
      if (page.done) break;
      offset = page.next;
    }
    expect(apps.some(a => a.name === "Finder")).toBe(true);
    expect(apps.some(a => a.name === "Calculator")).toBe(true);
    expect(apps.every(a => a.path.startsWith("/") && a.kind === "application")).toBe(true);
    for (const name of ["Finder", "Calculator"]) {
      const icon = Buffer.from(apps.find(a => a.name === name)!.icon, "base64");
      expect(icon.length).toBe(4096);
      const alpha = Array.from({ length: 1024 }, (_, i) => icon[i * 4 + 3]);
      expect(alpha.some(a => a > 0 && a < 255)).toBe(true);
      expect(alpha.some(a => a === 0)).toBe(true);
    }
    expect(apps.find(a => a.name === "Finder")!.icon).not.toBe(apps.find(a => a.name === "Calculator")!.icon);
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
    rmSync(fixture, { recursive: true, force: true });
  }
}, 20000);
