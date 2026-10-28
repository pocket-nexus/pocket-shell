// SPDX-License-Identifier: GPL-3.0-only
import { beforeAll, describe, expect, test } from "bun:test";
import { createTextEngine } from "../../../vendor/pocketjs/platforms/web/text-engine.js";
import { createWasmUi } from "../../../vendor/pocketjs/platforms/web/wasm-ops.js";
import { createTextLayout } from "@pocketjs/framework/text-layout";
import { runServicePumps } from "../../../vendor/pocketjs/framework/src/services.ts";
import {
  connectOffloadUsbProvider,
  usbPacket,
  usbSlot,
  USB_MAGIC,
  usbHash,
} from "../../../vendor/pocketjs/tools/offload-usb-provider.ts";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const wasmPath = resolve(root, "../../vendor/pocketjs/platforms/web/pocket_text.wasm");
const pakPath = resolve(
  root,
  "../../vendor/pocketjs/dist/pocket-desktop-system-ui.pak",
);
let engine: Awaited<ReturnType<typeof createTextEngine>>,
  wasm: ArrayBuffer,
  pak: ArrayBuffer;
let sequence = 0;
const call = (method: string, data: unknown) => {
  const reply = JSON.parse(
    engine.request(
      JSON.stringify({
        v: 1,
        id: ++sequence,
        method,
        payload: JSON.stringify(data),
      }),
    ),
  );
  if (reply.error) throw Error(reply.error);
  return JSON.parse(reply.payload);
};
beforeAll(async () => {
  wasm = await Bun.file(wasmPath).arrayBuffer();
  pak = await Bun.file(pakPath).arrayBuffer();
  engine = await createTextEngine(wasm, pak);
});
function upload(
  key: string,
  text: string,
  revision = 1,
  width: number | null = 80,
) {
  call("text.open", { key, revision, slot: 19, width, length: text.length });
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(text.length, offset + 512);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    call("text.append", {
      key,
      revision,
      offset,
      text: text.slice(offset, end),
    });
    offset = end;
  }
}
describe("portable Rust text service", () => {
  test("uses the package atlas and matches WASM core line breaks at two widths", async () => {
    const ui = await createWasmUi(
      await Bun.file(
        resolve(root, "../../vendor/pocketjs/platforms/web/pocketjs.wasm"),
      ).arrayBuffer(),
    );
    ui.ops.loadFontAtlas!(
      new Uint8Array(
        await Bun.file(
          resolve(root, "src/system-ui/fonts/w95fa-19.bin"),
        ).arrayBuffer(),
      ),
    );
    for (const width of [60, 140]) {
      const source =
        "word wrap stays stable across native and wasm workers\n\nemoji 😀 and combining e\u0301";
      upload("parity", source, 1, width);
      let offset = 0,
        rows: any[] = [];
      for (;;) {
        const page = call("text.layout", {
          key: "parity",
          revision: 1,
          offset,
        });
        rows.push(...page.rows);
        if (page.next === null) break;
        offset = page.next;
      }
      const expected = source.split("\n").flatMap((line, row) => {
        const breaks = [0, ...ui.ops.wrapText!(line, 19, width), line.length];
        return breaks.slice(1).map((to, i) => ({ row, from: breaks[i], to }));
      });
      expect(rows).toEqual(expected);
      call("text.close", { key: "parity", revision: 1 });
    }
  });
  test("rejects missing fonts, oversize documents, incomplete input and stale revisions", () => {
    expect(() =>
      call("text.open", {
        key: "bad",
        revision: 1,
        slot: 31,
        width: 80,
        length: 1,
      }),
    ).toThrow("Font capability unavailable");
    expect(() =>
      call("text.open", {
        key: "bad",
        revision: 1,
        slot: 19,
        width: 80,
        length: 65537,
      }),
    ).toThrow();
    call("text.open", {
      key: "fence",
      revision: 2,
      slot: 19,
      width: 80,
      length: 3,
    });
    expect(() =>
      call("text.open", {
        key: "fence",
        revision: 1,
        slot: 19,
        width: 80,
        length: 3,
      }),
    ).toThrow("Stale");
    expect(() =>
      call("text.layout", { key: "fence", revision: 2, offset: 0 }),
    ).toThrow("incomplete");
    expect(() =>
      call("text.append", {
        key: "fence",
        revision: 1,
        offset: 0,
        text: "old",
      }),
    ).toThrow("Stale");
    call("text.close", { key: "fence", revision: 2 });
  });
  test("paginates source coordinates without exceeding io.offload reply budgets", () => {
    upload("pages", Array(120).fill("hello world").join("\n"));
    let offset = 0,
      total = 0;
    for (;;) {
      const p = call("text.layout", { key: "pages", revision: 1, offset });
      expect(p.rows.length).toBeLessThanOrEqual(32);
      expect(JSON.stringify(p).length).toBeLessThanOrEqual(2500);
      total += p.rows.length;
      if (p.next === null) break;
      offset = p.next;
    }
    expect(total).toBeGreaterThanOrEqual(120);
    call("text.close", { key: "pages", revision: 1 });
    upload("row-limit", "\n".repeat(4096));
    expect(() =>
      call("text.layout", { key: "row-limit", revision: 1, offset: 0 }),
    ).toThrow("row budget");
    call("text.close", { key: "row-limit", revision: 1 });
  });
  test("OpenType shaping and coverage use supplied font bytes without system fonts", async () => {
    engine = await createTextEngine(wasm, pak, [
      await Bun.file(
        resolve(root, "../../vendor/pocketjs/assets/fonts/Inter-Regular.ttf"),
      ).arrayBuffer(),
    ]);
    const req = {
      text: "office e\u0301 😀",
      family: "Inter",
      size: 14,
      width: 180,
      offset: 0,
      y: 0,
    };
    const shaped = call("text.shape", req);
    expect(shaped.total).toBeGreaterThan(0);
    expect(shaped.glyphs.some((g: number[]) => g[2] - g[1] > 1)).toBe(true);
    const raster = call("text.raster", req);
    expect(raster.width).toBe(180);
    expect(raster.height).toBe(16);
    expect(Buffer.from(raster.coverage, "base64").some((v) => v !== 0)).toBe(
      true,
    );
    expect(() =>
      call("text.shape", { ...req, family: "Uninstalled system font" }),
    ).toThrow("unavailable");
    expect(
      JSON.stringify(call("text.raster", { ...req, width: 448 })).length,
    ).toBeLessThanOrEqual(2500);
    expect(() => call("text.raster", { ...req, width: 449 })).toThrow(
      "record budget",
    );
  });
});

test("framework delivery is bounded, latest-revision wins and reconnect restarts upload", async () => {
  let generation = 0;
  const requests: string[] = [],
    replies: string[] = [],
    states: any[] = [];
  (globalThis as any).offload = {
    session: () => generation,
    submit(record: string) {
      requests.push(record);
      return true;
    },
    take: () => replies.shift(),
  };
  const doc = createTextLayout((state) => states.push(state));
  let malformed = false;
  const step = () => {
    const record = requests.shift();
    if (record) {
      const reply = JSON.parse(engine.request(record));
      if (malformed && reply.payload && JSON.parse(reply.payload).rows) {
        const page = JSON.parse(reply.payload);
        page.rows[0].row = 9999;
        reply.payload = JSON.stringify(page);
      }
      replies.push(JSON.stringify(reply));
    }
    runServicePumps();
  };
  doc.update("before pairing", { slot: 19, width: 80 });
  for (let i = 0; i < 5; i++) step();
  expect(requests.length).toBe(0);
  expect(states.at(-1).status).toBe("companion-required");
  generation = 1;
  step(); // Replace while the worker reply is still in flight.
  doc.update("latest 😀 value", { slot: 19, width: 100 });
  for (let i = 0; i < 30; i++) step();
  expect(states.at(-1).status).toBe("ready");
  expect(
    states.filter((s) => s.status === "ready").map((s) => s.revision),
  ).toEqual([2]);
  doc.update("reconnect document", { slot: 19, width: 70 });
  step();
  generation = 0;
  for (let i = 0; i < 10; i++) step();
  engine = await createTextEngine(wasm, pak);
  requests.length = 0;
  replies.length = 0;
  generation = 2;
  for (let i = 0; i < 40; i++) step();
  expect(states.at(-1).status).toBe("ready");
  expect(states.at(-1).revision).toBe(3);
  doc.update("\u0001".repeat(512) + "😀\nend", { slot: 19, width: 100 });
  for (let i = 0; i < 100; i++) step();
  expect(states.at(-1).status).toBe("ready");
  malformed = true;
  doc.update("bounded result validation", { slot: 19, width: 100 });
  for (let i = 0; i < 30; i++) step();
  expect(states.at(-1).status).toBe("error");
  expect(states.at(-1).error).toBe("Invalid layout row");
  doc.dispose();
  for (let i = 0; i < 5; i++) step();
});

test("paired USB companion executes Rust in a real Worker and fences epochs", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "pocket-text-usb-"));
  const provider = connectOffloadUsbProvider({
    directory,
    app: "test.text",
    worker: new URL(
      "../../../vendor/pocketjs/tools/text-provider-worker.ts",
      import.meta.url,
    ),
    data: { wasm: wasmPath, pak: pakPath },
  });
  const waitFor = async (path: string) => {
    for (let i = 0; i < 200; i++) {
      if (existsSync(path)) return readFileSync(path);
      await Bun.sleep(10);
    }
    throw Error("USB provider timeout");
  };
  try {
    const ready = await waitFor(resolve(provider.root, "ready"));
    expect(ready.readUInt32LE(0)).toBe(USB_MAGIC);
    expect(provider.root.endsWith(usbSlot("test.text"))).toBe(true);
    const request = Buffer.from(
      JSON.stringify({
        v: 1,
        id: 7,
        method: "text.capabilities",
        payload: "{}",
      }),
    );
    const epoch = ready.readUInt32LE(4);
    writeFileSync(
      resolve(provider.root, "req0"),
      usbPacket(epoch ^ 1, 1, 1, 7, request),
    );
    await Bun.sleep(60);
    expect(existsSync(resolve(provider.root, "res0"))).toBe(false);
    writeFileSync(
      resolve(provider.root, "req0"),
      usbPacket(epoch, 1, 2, 7, request),
    );
    const result = await waitFor(resolve(provider.root, "res0"));
    expect(result.readUInt32LE(12)).toBe(2);
    expect(result.readUInt32LE(36)).toBe(usbHash(result.subarray(64)));
    const reply = JSON.parse(result.subarray(64).toString());
    expect(reply.id).toBe(7);
    expect(JSON.parse(reply.payload).layout).toBe(true);
  } finally {
    provider.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
