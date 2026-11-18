// tests/link-host.test.ts — the Tab5's side of Pocket Link 2
// (programs/m5stack-tab5/components/pocket_system/src/link2_host.c) and its
// route for the worker's requests to companion.pocket (companion.c): built
// with pocketjs's Pocket Link 2 client under ASan and UBSan by
// tests/link-host.c, against pocketjs's reference Hub in this process.
//
// A store Hub has not set up holds no pairing; after Hub's setup wrote the
// pairing files and the firmware started again, it links, reports its status
// and its installed applets, takes a launch and a removal from Hub, and sends
// each companion.pocket request as net.http for the app that runs. With the
// link down, a request fails with a message the app can show.
//
// A store no Hub has set up also pairs by a code the device shows (pocketjs
// docs/POCKET-LINK.md §3.11): the firmware writes the key file itself, links,
// and links again from that file at its next start.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createSocket } from "node:dgram";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HubDevice, LinkHub, MemoryStore, directoryStorage } from "../third_party/pocketjs/tools/pocket-link/v2/hub.ts";
import { LinkError } from "../third_party/pocketjs/tools/pocket-link/v2/peer.ts";

const ROOT = join(import.meta.dir, "..");
const SHARED = join(ROOT, "third_party/pocketjs/engine/host-services");
const SYSTEM = join(ROOT, "programs/m5stack-tab5/components/pocket_system/src");

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function until(what: () => unknown, label: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!what()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await pause(5);
  }
}

function freeUdpPort(): Promise<number> {
  return new Promise((done) => {
    const socket = createSocket("udp4");
    socket.bind(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => done(port));
    });
  });
}

/** The code a request of Hub's failed with, or its reply. */
async function outcome(request: Promise<unknown>): Promise<unknown> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof LinkError) return { error: error.code, ...(error.extra as object) };
    throw error;
  }
}

describe("the Tab5 on Pocket Link 2", () => {
  let scratch = "";
  let binary = "";
  let hub: LinkHub | null = null;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "pocket-m5-link-"));
    binary = join(scratch, "link-host");
    const compile = Bun.spawnSync([
      process.env.CC ?? "cc", "-std=gnu11", "-O1", "-g", "-Wall", "-Wextra", "-Werror",
      "-fsanitize=address,undefined", "-fno-sanitize-recover=undefined",
      `-I${SYSTEM}`, `-I${SHARED}`,
      `-I${join(ROOT, "third_party/pocketjs/engine/worker/include")}`,
      `-I${join(ROOT, "platforms/esp-idf/pocket_http_esp/include")}`,
      join(ROOT, "tests/link-host.c"), join(SYSTEM, "link2_host.c"), join(SYSTEM, "companion.c"),
      ...["link2.c", "link2_bsd.c", "link2_guest.c", "link2_http.c", "link2_proto.c", "launcher.c", "jscan.c", "sha256.c"].map((file) => join(SHARED, file)),
      "-o", binary,
    ]);
    expect(compile.exitCode, compile.stderr.toString()).toBe(0);
  });

  afterAll(() => {
    hub?.stop();
    rmSync(scratch, { recursive: true, force: true });
  });

  test("links from the pairing files Hub's setup wrote, serves Hub's runtime requests and routes companion.pocket", async () => {
    const store = join(scratch, "console");
    const linkDir = join(store, "link");
    const beaconPort = await freeUdpPort();
    const requests: { app: string; url: string }[] = [];
    hub = new LinkHub({
      name: "Test Mac",
      port: 0,
      host: "127.0.0.1",
      store: new MemoryStore("00000000000000aa"),
      beaconTargets: [{ address: "127.0.0.1", port: beaconPort }],
      // Hub answers companion.pocket itself, for the app the device names; a
      // /slow request never answers, so it is still open when the link closes.
      fetch: async (request) => {
        requests.push({ app: request.app, url: request.url });
        const path = new URL(request.url).pathname;
        if (path === "/slow") return new Promise(() => {});
        const [status, body] = path.startsWith("/x/") ? [200, { app: request.app }] : [404, { error: `no service named ${path.split("/")[1]}` }];
        return { status, url: request.url, headers: [["content-type", "application/json"]], body: new TextEncoder().encode(JSON.stringify(body)) };
      },
    });
    await hub.listen();
    hub.start(20);

    const slow = "https://companion.pocket/slow";
    const run = Bun.spawn([binary, "setup", store, String(beaconPort), slow], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:abort_on_error=0", UBSAN_OPTIONS: "halt_on_error=1" },
    });
    const answer = () => {
      run.stdin.write("done\n");
      run.stdin.flush();
    };
    const linked = async (): Promise<HubDevice> => {
      await until(() => hub?.devices.size === 1, "the device at Hub");
      return [...(hub as LinkHub).devices.values()][0];
    };

    let deviceId = "";
    let keyFile = "";
    let statusAtHub: unknown = null;
    let appsAtHub: unknown = null;
    const runtime: Record<string, unknown> = {};
    const lines: string[] = [];
    const reader = run.stdout.getReader();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += new TextDecoder().decode(value);
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        lines.push(line);
        if (line === "wait setup") {
          // The first start made device.txt; Hub's setup keeps that id and
          // writes its key file beside it (pocketjs docs/POCKET-LINK.md §3.2).
          deviceId = readFileSync(join(linkDir, "device.txt"), "utf8").trim();
          const setup = await hub.setup(directoryStorage(linkDir), { kind: "card", addresses: ["127.0.0.1"] });
          expect(setup.failed).toBe(false);
          keyFile = readFileSync(join(linkDir, "companions", `${hub.id}.txt`), "utf8");
          answer();
        } else if (line === "wait runtime") {
          const device = await linked();
          await until(() => device.status?.app?.id === "dev.pocket-nexus.shell", "the launcher in runtime.status");
          await until(() => device.apps.length === 2, "the installed set");
          statusAtHub = await device.runtimeStatus();
          appsAtHub = device.apps.map((app) => ({ ...app }));
          runtime.identity = { id: device.id, name: device.name, model: device.model, target: device.target, hostAbi: device.hostAbi };
          runtime.features = [...device.peer.peerFeatures].sort();
          runtime.unknownLaunch = await outcome(device.launch({ app: "nothing" }));
          runtime.launch = await outcome(device.launch({ app: "hn" }));
          runtime.push = await outcome(device.push(new Uint8Array(64), "00000000000000ff"));
          runtime.removeHome = await outcome(device.remove("dev.pocket-nexus.shell"));
          runtime.remove = await outcome(device.remove("dev.pocket-nexus.hn"));
          await until(() => device.apps.length === 1, "the set without the removed applet");
          runtime.appsAfter = device.apps.map((app) => app.id);
          answer();
        } else if (line === "wait stop") {
          await until(() => requests.some((request) => request.url === slow), "the slow request at Hub");
          hub.stop();
          answer();
        }
      }
    }
    const exitCode = await run.exited;
    const stderr = await new Response(run.stderr).text();
    expect(exitCode, `${stderr}\n${lines.join("\n")}`).toBe(0);

    // Before the setup: no pairing.
    expect(lines).toContain("start https://companion.pocket/x/status error unavailable: no Mac is paired");
    expect(deviceId).toMatch(/^[0-9a-f]{16}$/);
    // The device read the key file and never wrote it. Hub's name, address
    // and port are the ones the setup wrote, so the link left no .last file.
    expect(readFileSync(join(linkDir, "companions", `${hub.id}.txt`), "utf8")).toBe(keyFile);
    expect(readdirSync(join(linkDir, "companions"))).toEqual([`${hub.id}.txt`]);
    expect(existsSync(join(linkDir, "device.txt"))).toBe(true);
    expect(lines).toContain("status linked");

    // The handshake's identity and the groups the firmware lists.
    expect(runtime.identity).toEqual({ id: deviceId, name: "Harness", model: "M5Stack Tab5", target: "tab5-home", hostAbi: 7 });
    expect(runtime.features).toEqual(["apps", "catalog", "install", "net.http", "runtime", "runtime.remove"]);

    // Each request is net.http for the app that runs: the applet, then the launcher.
    const fetches = lines.filter((line) => line.startsWith("fetch "));
    expect(fetches).toEqual([
      'fetch https://companion.pocket/nothing/here 404 0 {"error":"no service named nothing"}',
      'fetch https://companion.pocket/x/status 200 0 {"app":"dev.pocket-nexus.hn"}',
      'fetch https://companion.pocket/x/status 200 0 {"app":"dev.pocket-nexus.shell"}',
    ]);

    // runtime.status: the launcher runs; no generations and no last good package.
    expect(statusAtHub).toMatchObject({
      phase: "booted",
      target: "tab5-home",
      hostAbi: 7,
      address: "127.0.0.1",
      generation: 0,
      active: "8877665544332211",
      lastGood: "0000000000000000",
      running: "8877665544332211",
      app: { id: "dev.pocket-nexus.shell", output: "pocket-shell", title: "Pocket Shell" },
    });
    // runtime.apps: the launcher's row, then the launcher's table.
    expect(appsAtHub).toEqual([
      { id: "dev.pocket-nexus.shell", output: "pocket-shell", version: "0.1.1", hash: "8877665544332211", home: true },
      { id: "dev.pocket-nexus.hn", output: "hn", version: "1.2.0", hash: "1122334455667788" },
    ]);
    // runtime.launch switches to an installed applet; a push is not served.
    expect(runtime.unknownLaunch).toMatchObject({ error: "not_found" });
    expect(runtime.launch).toMatchObject({ phase: "switching", output: "hn" });
    expect(lines).toContain("switch hn");
    expect(runtime.push).toMatchObject({ error: "unsupported" });
    // runtime.remove: never the launcher; an installed applet leaves the set.
    expect(runtime.removeHome).toMatchObject({ error: "rejected", reason: "home" });
    expect(runtime.remove).not.toHaveProperty("error");
    expect(runtime.appsAfter).toEqual(["dev.pocket-nexus.shell"]);

    // The link closed under an open request, then took none.
    expect(lines).toContain(`end ${slow} -3 unavailable: the Pocket Link closed`);
    expect(lines).toContain("status not linked");
    expect(lines).toContain("start https://companion.pocket/x/status error unavailable: the paired Mac is not connected");
    hub.stop();
    hub = null;
  }, 60_000);

  test("pairs by a code it shows, writes the key file itself and links from it at the next start", async () => {
    const store = join(scratch, "unpaired");
    const linkDir = join(store, "link");
    const beaconPort = await freeUdpPort();
    const memory = new MemoryStore("00000000000000bb");
    const asked: string[] = [];
    hub = new LinkHub({
      name: "Test Mac",
      port: 0,
      host: "127.0.0.1",
      store: memory,
      beaconTargets: [{ address: "127.0.0.1", port: beaconPort }],
      onPairRequest: (request) => asked.push(request.device),
      fetch: async (request) => ({ status: 200, url: request.url, headers: [["content-type", "application/json"]], body: new TextEncoder().encode(JSON.stringify({ app: request.app })) }),
    });
    await hub.listen();
    hub.start(20);

    const run = Bun.spawn([binary, "pair", store, String(beaconPort), hub.id], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0:abort_on_error=0", UBSAN_OPTIONS: "halt_on_error=1" },
    });
    const lines: string[] = [];
    let recordsBeforeCode = -1;
    const reader = run.stdout.getReader();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += new TextDecoder().decode(value);
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        lines.push(line);
        if (line === "wait code") {
          // The device asked this Hub; its owner types the code the device shows.
          await until(() => asked.length === 1, "the request at Hub");
          recordsBeforeCode = memory.list().length;
          const code = lines.find((shown) => shown.startsWith("code "))?.slice(5) ?? "";
          await hub.pair(asked[0], code);
          run.stdin.write("done\n");
          run.stdin.flush();
        }
      }
    }
    const exitCode = await run.exited;
    const stderr = await new Response(run.stderr).text();
    expect(exitCode, `${stderr}\n${lines.join("\n")}`).toBe(0);

    const deviceId = readFileSync(join(linkDir, "device.txt"), "utf8").trim();
    expect(asked).toEqual([deviceId]);
    // A Hub is asked only while a pairing is open, and holds no record before the code.
    expect(lines.slice(0, 4)).toEqual(["ask closed refused", "hub listed", expect.stringMatching(/^code \d{6}$/), "ask open taken"]);
    expect(recordsBeforeCode).toBe(0);
    expect(memory.list().map((record) => record.id)).toEqual([deviceId]);
    // The firmware wrote the key file; the link carries a request; the next start links from the file.
    expect(readdirSync(join(linkDir, "companions")).filter((name) => name.endsWith(".txt"))).toEqual([`${hub.id}.txt`]);
    expect(lines.slice(5)).toEqual([
      "status linked",
      "pair paired",
      'fetch https://companion.pocket/x/status 200 0 {"app":"dev.pocket-nexus.shell"}',
      "status linked",
      "pair idle",
    ]);
  }, 60_000);
});
