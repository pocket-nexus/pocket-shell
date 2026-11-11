// SPDX-License-Identifier: GPL-3.0-or-later
// bun run shot [--host <ip>] [--out media/hw-x.png] [--eval "<js>"] — one
// screenshot of a running console, both screens in one PNG.
//
// The console sends it over the Pocket Link as runtime.screenshot (PocketJS
// tools/3ds-dev.ts shot, the reference Hub's command line). --eval evaluates
// an expression in the guest first, over the DevTools stream, so a state worth
// photographing can be set up without pressing anything:
//
//   bun run shot --eval "globalThis.agent.status()" --out dist/agent.png
//
// --host <ip> (or POCKET_SHELL_HOST) adds the console's address as a beacon
// target; without it the console finds this computer by broadcast.

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { $ } from "bun";
import { passThrough } from "../../../scripts/run.ts";
import { ROOT, VENDOR } from "./paths.ts";

const args = process.argv.slice(2);
/** Take `--name <value>` or `--name=<value>` out of the arguments. */
const take = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  if (at >= 0) return args.splice(at, 2)[1];
  const joined = args.findIndex((argument) => argument.startsWith(`--${name}=`));
  return joined >= 0 ? args.splice(joined, 1)[0]!.slice(name.length + 3) : undefined;
};

const host = take("host") ?? process.env.POCKET_SHELL_HOST;
const out = resolve(ROOT, take("out") ?? "dist/shot.png");
const code = take("eval");
const settle = Number(take("settle") ?? 900);
const target = host ? ["--host", host] : [];

if (code) {
  await passThrough($`bun ${VENDOR}/tools/3ds-dev.ts eval ${code} ${target} ${args}`.cwd(ROOT));
  // Let the state settle before the picture is taken.
  await Bun.sleep(settle);
}
mkdirSync(dirname(out), { recursive: true });
await passThrough($`bun ${VENDOR}/tools/3ds-dev.ts shot --out ${out} ${target} ${args}`.cwd(ROOT));
