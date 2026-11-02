// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/net.test.ts — the applets' network on its own: the worker
// entry (ui/net-worker.ts) on PocketJS's worker runtime with a host whose
// http node is scripted here, and the glyph atlas split into requests that
// fit one descriptor and merged back (ui/glyphs.ts). The sims run the UI side
// (ui/net.ts) against test/net-fake.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bindWorker, FactKind, ResourceStatus, type HostFact, type WorkerHost } from "@pocketjs/framework/worker";
import { atlasFont, packAtlas, tofuCell, TOFU_CODEPOINT, type GlyphCell } from "../../../vendor/pocketjs/tools/companion/glyphs.ts";
import { atlasBodies, GLYPH_ATLAS_URL, GLYPH_TEXT, mergeAtlases } from "../ui/glyphs.ts";
import { DESCRIPTOR_BYTES, requestBytes } from "../ui/net.ts";
import { Answer, ANSWER_BYTES, decodeAnswer, decodeEnd, encodeRequest, NET_WORKER, text, utf8 } from "../ui/net-wire.ts";

const global = globalThis as Record<string, unknown>;
const opened: { handle: number; config: string }[] = [];
const submitted: number[] = [];
const closed: number[] = [];
const published: Uint8Array[] = [];
let accept = true;
let ringFull = false;
let handles = 0;
let sequence = 0;
let now = 1_000;

const host: WorkerHost = {
  open: (_kind, _node, config) => {
    opened.push({ handle: ++handles, config: text(config) });
    return handles;
  },
  submit: (handle) => {
    submitted.push(handle);
    return accept ? 100 + handle : -1;
  },
  cancel: () => 0,
  close: (handle) => {
    closed.push(handle);
    return 0;
  },
  write: () => 0,
  publish: (_channel, data) => {
    if (ringFull) return ResourceStatus.busy;
    published.push(data.slice());
    return 0;
  },
  timer: () => 0,
  declareChannel: () => 0,
};

const fact = (overrides: Partial<HostFact>): HostFact => ({
  kind: FactKind.complete, handle: 0, request: 0, status: 0, offset: 0, data: new Uint8Array(0), timer: 0, channel: 0, deadline: 0, missed: 0, ...overrides,
});
/** One turn of the worker, then its Promise jobs. */
async function turn(facts: HostFact[] = [], advance = 0): Promise<void> {
  now += advance;
  (global.__pocketWorkerTurn as (context: object, facts: HostFact[]) => void)({ generation: 1, sequence: ++sequence, nowMicros: now }, facts);
  for (let i = 0; i < 4; i++) await new Promise<void>((done) => setTimeout(done, 0));
}
const ask = (id: number, descriptor: object) => fact({ kind: FactKind.channel, channel: 1, data: encodeRequest(id, utf8(JSON.stringify(descriptor))) });
const answers = () => published.splice(0).map(decodeAnswer);

beforeAll(async () => {
  global.__pocketWorker = host;
  bindWorker(NET_WORKER as never);
  await import("../ui/net-worker.ts");
  await turn();
});
afterAll(() => {
  delete global.__pocketWorker;
  delete global.__pocketWorkerTurn;
});

describe("the applets' worker", () => {
  test("a request opens io.http with the UI's descriptor and streams the head, the body and the end", async () => {
    const descriptor = { url: "https://hacker-news.firebaseio.com/v0/topstories.json", timeoutMs: 20000, maxBytes: 262144 };
    await turn([ask(7, descriptor)]);
    expect(opened.at(-1)!.config).toBe(JSON.stringify(descriptor));
    const handle = opened.at(-1)!.handle;
    const head = utf8(JSON.stringify({ status: 200, url: descriptor.url, headers: { etag: "\"abc\"" } }));
    const body = Uint8Array.from({ length: 2500 }, (_, i) => i & 0xff);
    await turn([
      fact({ kind: FactKind.headers, handle, data: head }),
      fact({ kind: FactKind.data, handle, offset: 0, data: body.subarray(0, 1024) }),
      fact({ kind: FactKind.data, handle, offset: 1024, data: body.subarray(1024, 2048) }),
      fact({ kind: FactKind.data, handle, offset: 2048, data: body.subarray(2048) }),
      fact({ kind: FactKind.end, handle, status: ResourceStatus.ok, offset: 2500 }),
      fact({ kind: FactKind.complete, handle, request: 100 + handle, status: ResourceStatus.ok }),
    ]);
    const records = answers();
    expect(records.every((record) => record.id === 7 && record.payload.length <= ANSWER_BYTES)).toBe(true);
    expect(text(Uint8Array.from(records.filter((r) => r.kind === Answer.head).flatMap((r) => [...r.payload])))).toBe(text(head));
    expect(Uint8Array.from(records.filter((r) => r.kind === Answer.body).flatMap((r) => [...r.payload]))).toEqual(body);
    expect(records.at(-1)!.kind).toBe(Answer.end);
    expect(decodeEnd(records.at(-1)!.payload)).toEqual({ status: ResourceStatus.ok, failure: "" });
    expect(closed).toContain(handle);
  });

  test("the node runs two requests at once and the third waits for one to end", async () => {
    const before = opened.length;
    await turn([ask(10, { url: "https://example.com/a" }), ask(11, { url: "https://example.com/b" }), ask(12, { url: "https://example.com/c" })]);
    expect(opened.length - before).toBe(2);
    const first = opened[before]!.handle;
    await turn([fact({ kind: FactKind.end, handle: first, status: ResourceStatus.ok }), fact({ kind: FactKind.complete, handle: first, request: 100 + first })]);
    expect(opened.length - before).toBe(3);
    expect(JSON.parse(opened.at(-1)!.config).url).toBe("https://example.com/c");
    for (const { handle } of opened.slice(before + 1)) await turn([fact({ kind: FactKind.complete, handle, request: 100 + handle })]);
    // A completion without an end fact ends the request a turn later, when its
    // stream has been read.
    await turn();
    expect(answers().filter((r) => r.kind === Answer.end).map((r) => r.id)).toEqual([10, 11, 12]);
  });

  test("a request the node does not start ends unavailable; a failure ends with its code", async () => {
    accept = false;
    await turn([ask(20, { url: "https://companion.pocket/x/timeline" })]);
    accept = true;
    const refused = answers().at(-1)!;
    expect([refused.id, decodeEnd(refused.payload).status, decodeEnd(refused.payload).failure.split(":")[0]]).toEqual([20, ResourceStatus.busy, "unavailable"]);
    await turn([ask(21, { url: "https://companion.pocket/x/timeline" })]);
    const handle = opened.at(-1)!.handle;
    await turn([
      fact({ kind: FactKind.error, handle, data: utf8("timeout: no answer within 20000 ms") }),
      fact({ kind: FactKind.end, handle, status: ResourceStatus.unknown }),
      fact({ kind: FactKind.complete, handle, request: 100 + handle, status: ResourceStatus.unknown }),
    ]);
    const failed = answers().at(-1)!;
    expect([failed.id, decodeEnd(failed.payload)]).toEqual([21, { status: ResourceStatus.unknown, failure: "timeout: no answer within 20000 ms" }]);
  });

  test("a full response ring holds the records until it has room", async () => {
    ringFull = true;
    await turn([ask(30, { url: "https://example.com/full" })]);
    const handle = opened.at(-1)!.handle;
    await turn([fact({ kind: FactKind.headers, handle, data: utf8('{"status":200,"url":"https://example.com/full","headers":{}}') }), fact({ kind: FactKind.end, handle, status: 0 })]);
    expect(published).toHaveLength(0);
    ringFull = false;
    await turn([fact({ kind: FactKind.timer, timer: 1 })], 20_000);
    expect(answers().map((r) => r.kind)).toEqual([Answer.head, Answer.end]);
    await turn([fact({ kind: FactKind.complete, handle, request: 100 + handle })]);
    expect(closed).toContain(handle);
  });
});

describe("glyph atlases in requests that fit", () => {
  test("every atlas body's request fits one descriptor, with room for an app queue's own", () => {
    const codepoints = Array.from({ length: 900 }, (_, i) => 0x4e00 + i);
    const bodies = atlasBodies(GLYPH_TEXT, codepoints);
    expect(bodies.length).toBeGreaterThan(2);
    const sent = bodies.flatMap((body) => [...(JSON.parse(body) as { text: string }).text].map((ch) => ch.codePointAt(0)!));
    expect(sent).toEqual(codepoints);
    for (const body of bodies) {
      const bytes = requestBytes(GLYPH_ATLAS_URL, { method: "POST", headers: { "content-type": "application/json" }, body, timeoutMs: 20_000, maxBytes: 256 * 1024 });
      expect(bytes).toBeLessThanOrEqual(DESCRIPTOR_BYTES - 64);
    }
    expect(atlasBodies(GLYPH_TEXT, [])).toEqual([JSON.stringify({ px: 13, bold: false, slot: 21, text: "" })]);
  });

  test("the parts merge into the atlas one request for all of them would have answered", () => {
    const font = atlasFont(13);
    const cell = (cp: number): GlyphCell => ({ advance: 6 + (cp % 7), xoff: cp % 2, coverage: new Uint8Array(font.cellW * font.cellH).fill(cp & 0xff) });
    const ascii = Array.from({ length: 95 }, (_, i) => 0x20 + i);
    const atlas = (cps: number[]) => packAtlas(new Map([...ascii, ...cps].map((cp) => [cp, cell(cp)])), font, 21, false);
    const a = [0x4e2d, 0x6587, 0x1f600];
    const b = [0x65e5, 0x672c, 0x4e2d];
    const merged = mergeAtlases([atlas(a), atlas(b)]);
    expect(merged).toEqual(atlas([...a, ...b.filter((cp) => !a.includes(cp))]));
    expect(mergeAtlases([atlas(a)])).toEqual(atlas(a));
    expect(mergeAtlases([atlas(a), packAtlas(new Map([[0x41, cell(0x41)]]), atlasFont(16), 21, false)])).toBeNull();
    expect(TOFU_CODEPOINT).toBe(0xfffd);
    expect(tofuCell(font).coverage.length).toBe(font.cellW * font.cellH);
  });
});
