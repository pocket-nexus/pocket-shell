// SPDX-License-Identifier: GPL-3.0-or-later
// bun run shot [--host <ip>] [--out media/hw-x.png] [--eval "<js>"] — one
// screenshot of a running console, both screens in one PNG.
//
// `probe` asks for the tree as well, and a deep UI can push that dump past the
// runtime's outgoing control budget, so probe waits on something that never
// arrives while the console is perfectly healthy. This asks for the screenshot
// alone, and optionally evaluates an expression in the guest first —
// `globalThis.__pocketShell` is the live shell store, so a state worth
// photographing can be set up without pressing anything:
//
//   bun run shot --eval "const s=globalThis.__pocketShell; s.open('term'); s.open('clock')"
//   bun run shot --eval "globalThis.__pocketShell.setLatchL(true)" --out media/hw-chords.png

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  PocketRuntimeClient,
  parsePocketRuntimeToken,
} from "../../../vendor/pocketjs/tools/3ds-runtime-client.ts";
import { ROOT } from "./paths.ts";

const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  if (at >= 0) return args[at + 1];
  return args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
};

const host = value("host") ?? process.env.POCKET_SHELL_HOST;
if (!host) {
  console.error("bun run shot --host <ip> [--out <file>] [--eval <js>] [--settle <ms>]");
  process.exit(2);
}
const out = resolve(ROOT, value("out") ?? "dist/shot.png");
const code = value("eval");
const settle = Number(value("settle") ?? 900);

const keyPath = resolve(ROOT, `.pocket/devices/${host}-8131.key`);
const token = parsePocketRuntimeToken(readFileSync(keyPath, "utf8"));
const open = async () => {
  const connection = new PocketRuntimeClient({ host, token, timeoutMs: 20_000 });
  await connection.connect();
  return connection;
};
let client = await open();

if (code) {
  const id = `shot-${Date.now()}`;
  const result = client.waitForCtrl((message) => message.t === "evalResult" && message.id === id);
  await client.sendCtrl({ t: "eval", id, code });
  const evaluated = await result;
  if (evaluated.error) throw new Error(`eval failed on the console: ${String(evaluated.error)}`);
  // Settle disconnected: while a client is attached the guest sends DevTools
  // snapshots, and their cost shows up in the picture (top's fps, for one).
  client.close();
  await Bun.sleep(settle);
  client = await open();
}

const pending = client.waitForScreenshot(20_000);
await client.sendCtrl({ t: "screenshot" });
const screenshot = await pending;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, screenshot.png);
console.log(`pocket-shell: ${out} (frame ${screenshot.frame})`);
process.exit(0);
