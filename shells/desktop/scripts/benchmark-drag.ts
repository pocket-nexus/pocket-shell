// SPDX-License-Identifier: GPL-3.0-only
// Native Aqua drag trace. Run after `bun run build` in an unlocked session.
import { mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { cpus, release } from "node:os";
import { DIST, PLAN_DIR, POCKETJS_ROOT, ROOT } from "./system-plan.ts";

const options = process.argv.slice(2);
const value = (name: string, fallback: string) => options.find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const host = resolve(value("--host", resolve(POCKETJS_ROOT, "hosts/desktop/target/release/pocket-desktop-host")));
const directory = resolve(value("--out", ".pocket/bench/drag"));
const planPath = resolve(PLAN_DIR, "pocket-desktop.system.plan.json");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
if (plan.applications.length === 0) {
  throw new Error("This historical drag tape requires the desktop showcase, not the macOS Devices app. Replay it at the revision recorded in docs/bench.");
}
const viewport = plan.systemUI.plan.viewport;
if (viewport.logical[0] !== 800 || viewport.logical[1] !== 600) throw new Error("This tape requires the default 800x600 System plan");
mkdirSync(directory, { recursive: true });
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], {cwd}).stdout.toString().trim();
const identities = [ROOT, POCKETJS_ROOT].map(cwd => ({
  revision: git(cwd, "rev-parse", "HEAD"),
  diffSha256: sha(git(cwd, "diff", "HEAD")),
}));
const artifacts = [planPath, host, ...[plan.systemUI, ...plan.applications].flatMap(entry => [
  resolve(DIST, `${entry.plan.app.output}.js`), resolve(DIST, `${entry.plan.app.output}.pak`),
])].map(file => ({file, sha256: sha(readFileSync(file))}));
const command = [host, "--system-plan", planPath, "--trace-frames", "--quit-after", "510", "--key", "cmd+sh+t@20", "--key", "cmd+sh+t@40", "--mouse", "200,40,d@119"];
for (let i = 0; i < 360; i++) {
  const x = 200 + 140 * (1 - Math.cos(2 * Math.PI * i / 180));
  const y = 40 + 70 * (1 - Math.cos(2 * Math.PI * i / 120));
  command.push("--mouse", `${x.toFixed(3)},${y.toFixed(3)},m@${120 + i}`);
}
command.push("--mouse", "200,40,u@480");
console.log("Replaying Aqua drag at 800x600. Keep the host focused while the tape runs.");
const child = Bun.spawn(command, {cwd: ROOT, env: {...process.env, POCKETJS_DIST: DIST, RUST_LOG: "info"}, stdout: "pipe", stderr: "pipe"});
const timeout = setTimeout(() => child.kill(), 30_000);
const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
clearTimeout(timeout);
await Bun.write(resolve(directory, "native.log"), stderr);
await Bun.write(resolve(directory, "native.stdout"), stdout);
type Sample = {tick: number; wallUs: number; durationMs: number};
const samples: Record<string, Sample[]> = {};
for (const line of stderr.split("\n")) {
  if (!line.startsWith("FRAME_TRACE,")) continue;
  const [, stage, tick, wall, duration] = line.split(",");
  if (+tick < 131 || +tick > 470) continue;
  (samples[stage] ??= []).push({tick: +tick, wallUs: +wall, durationMs: +duration / 1000});
}
const stats = (input: number[]) => {
  const xs = input.toSorted((a,b) => a-b);
  const percentile = (p: number) => xs[Math.round((xs.length - 1) * p)] ?? null;
  return {count: xs.length, median: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: xs.at(-1) ?? null};
};
const stages = Object.fromEntries(Object.entries(samples).map(([stage, rows]) => [stage, {
  durationMs: stats(rows.map(row => row.durationMs)),
  intervalMs: stats(rows.slice(1).map((row,i) => (row.wallUs - rows[i].wallUs)/1000)),
}]));
const errors: string[] = [];
if (exitCode !== 0) errors.push(`Native host exited ${exitCode}`);
if ((samples["present-submit"]?.length ?? 0) < 320) errors.push("Fewer than 320/340 drag frames were presented; the tape may have been interrupted");
// Opt-in CPU budgets depend on the acceptance machine. No GPU or panel-latency claim.
for (const [stage, flag] of [["work", "--max-work-ms"], ["render-submit", "--max-render-ms"], ["present-submit", "--max-present-ms"]]) {
  const budget = Number(value(flag, "Infinity"));
  if (!(budget > 0)) throw new Error(`${flag} must be positive`);
  if ((stages[stage]?.durationMs.p95 ?? Infinity) > budget) errors.push(`${stage} p95 exceeds ${budget} ms`);
}
const report = {date: new Date().toISOString(), platform: process.platform, osRelease: release(), cpu: cpus()[0]?.model, viewport, identities, artifacts, command, exitCode, stages, errors,
  measurement: "CPU tick, render submission and presentation submission; excludes GPU completion and mouse-to-panel latency."};
await Bun.write(resolve(directory, "report.json"), JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({stages, errors, report: resolve(directory,"report.json")},null,2));
if (errors.length) process.exit(1);
