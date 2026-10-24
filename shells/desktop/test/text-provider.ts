// SPDX-License-Identifier: GPL-3.0-only
import { createTextEngine } from "../../../vendor/pocketjs/platforms/web/text-engine.js";
import { resolve } from "node:path";
/** Deterministic test scheduler: the actual Rust WASM provider runs BETWEEN
 * guest frames. Production uses a Worker; no capability executes in an op. */
export async function testTextProvider() {
  const root = resolve(import.meta.dir, "..");
  const engine = await createTextEngine(
    await Bun.file(
      resolve(root, "../../vendor/pocketjs/platforms/web/pocket_text.wasm"),
    ).arrayBuffer(),
    await Bun.file(
      resolve(root, "../../vendor/pocketjs/dist/pocket-desktop-system-ui.pak"),
    ).arrayBuffer(),
  );
  const requests: string[] = [],
    replies: string[] = [];
  return {
    ops: {
      session: () => 1,
      submit(record: string) {
        if (requests.length + replies.length >= 8) return false;
        requests.push(record);
        return true;
      },
      take: () => replies.shift(),
    },
    betweenFrames() {
      const record = requests.shift();
      if (record) replies.push(engine.request(record));
    },
  };
}
