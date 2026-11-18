// SPDX-License-Identifier: GPL-3.0-or-later
// The Hub's HTTP fetch for a worker's stream (link/fetch.ts performNet, which
// link/v2/cli.ts runs for net.http): the headers reach the sink before the
// body ends, and the sink's pace is the body's.
//
// This is one case of PocketJS tests/worker-http-stream.test.ts. Its stream
// credit case tests tools/pocket-link/stream-credit.ts and its native case
// compiles Pocket Link 1's link_http.c; both stay in PocketJS.

import { expect, test } from "bun:test";
import { performNet } from "../fetch.ts";

test("HTTP headers arrive before EOF and the consumer controls body progress", async () => {
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const web = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(new ReadableStream({
    async start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      await gate;
      controller.enqueue(new Uint8Array([4, 5]));
      controller.close();
    },
  })) });
  let headed = false;
  const chunks: number[] = [];
  try {
    const response = await performNet({ url: `http://127.0.0.1:${web.port}/`, method: "GET", headers: {}, body: new Uint8Array(), timeoutMs: 3000, maxBytes: 100 }, { allowPrivate: true }, {
      head: () => { headed = true; },
      chunk: async (bytes) => { expect(headed).toBe(true); chunks.push(...bytes); finish(); },
    });
    expect(chunks).toEqual([1, 2, 3, 4, 5]);
    expect(response.body.length).toBe(0);
  } finally { finish(); web.stop(true); }
});
