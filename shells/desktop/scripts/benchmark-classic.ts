// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { $ } from "bun";
import { DIST, PLAN_DIR, POCKETJS_ROOT, ROOT } from "./system-plan.ts";

interface ProcessSample {
  elapsedMs: number;
  rssBytes: number;
  cpuPercent: number;
  processCount: number;
}

interface ProcessInfo {
  ppid: number;
  rssKb: number;
  cpuPercent: number;
}

interface ArtifactEntry {
  path: string;
  bytes: number;
}

const argv = process.argv.slice(2);
const quick = argv.includes("--quick");
const coldRuns = quick ? 3 : 10;
const settleMs = quick ? 2_000 : 20_000;
const memorySamples = quick ? 3 : 10;
const sampleIntervalMs = quick ? 500 : 2_000;
const binary = resolve(
  POCKETJS_ROOT,
  "hosts/desktop/target/release/pocket-desktop-host",
);
const systemPlanPath = resolve(PLAN_DIR, "pocket-desktop.system.plan.json");
// Measurements depend on this machine and run; promote a reviewed baseline
// into docs/bench explicitly instead of committing every invocation.
const reportDir = resolve(ROOT, ".pocket/bench/classic", new Date().toISOString().replaceAll(":", "-"));

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error("cannot take median of no samples");
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function relative(path: string): string {
  return path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path;
}

async function text(command: string[]): Promise<string> {
  const child = Bun.spawn(command, {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${command.join(" ")} failed (${code}): ${stderr.trim()}`);
  }
  return stdout.trim();
}

async function processSnapshot(): Promise<Map<number, ProcessInfo>> {
  const output = await text(["ps", "-axo", "pid=,ppid=,rss=,pcpu="]);
  const processes = new Map<number, ProcessInfo>();
  for (const line of output.split("\n")) {
    const [pid, ppid, rssKb, cpuPercent] = line
      .trim()
      .split(/\s+/)
      .map(Number);
    if (Number.isFinite(pid) && pid > 0) {
      processes.set(pid, { ppid, rssKb, cpuPercent });
    }
  }
  return processes;
}

function processTree(
  snapshot: Map<number, ProcessInfo>,
  rootPid: number,
): number[] {
  const result = [rootPid];
  for (let index = 0; index < result.length; index += 1) {
    const parent = result[index];
    for (const [pid, info] of snapshot) {
      if (info.ppid === parent && !result.includes(pid)) result.push(pid);
    }
  }
  return result;
}

async function sampleProcessTree(
  rootPid: number,
  startedAt: number,
): Promise<ProcessSample> {
  const snapshot = await processSnapshot();
  const pids = processTree(snapshot, rootPid);
  let rssKb = 0;
  let cpuPercent = 0;
  for (const pid of pids) {
    const info = snapshot.get(pid);
    if (!info) continue;
    rssKb += info.rssKb;
    cpuPercent += info.cpuPercent;
  }
  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    rssBytes: rssKb * 1024,
    cpuPercent: Number(cpuPercent.toFixed(2)),
    processCount: pids.filter((pid) => snapshot.has(pid)).length,
  };
}

async function physicalFootprintBytes(rootPid: number): Promise<number> {
  const snapshot = await processSnapshot();
  const pids = processTree(snapshot, rootPid).map(String);
  const output = await text([
    "footprint",
    "-f",
    "bytes",
    "--noCategories",
    ...pids,
  ]);
  const values = [...output.matchAll(/^\s*phys_footprint:\s+(\d+)\s+B$/gim)].map(
    (match) => Number(match[1]),
  );
  if (values.length === 0) {
    throw new Error("footprint did not report phys_footprint");
  }
  return values.reduce((sum, value) => sum + value, 0);
}

function spawnSystem(): Bun.Subprocess<"ignore", "pipe", "pipe"> {
  return Bun.spawn(
    [binary, "--system-plan", systemPlanPath, "--announce-ready"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        POCKETJS_DIST: DIST,
        RUST_LOG: "warn",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

async function waitForReady(
  child: Bun.Subprocess<"ignore", "pipe", "pipe">,
  timeoutMs = 60_000,
): Promise<void> {
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  const deadline = performance.now() + timeoutMs;
  let buffer = "";
  try {
    while (performance.now() < deadline) {
      const remaining = Math.max(1, deadline - performance.now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("timed out waiting for first-painted-frame READY")),
          remaining,
        );
      });
      const chunk = await Promise.race([reader.read(), timeout]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (/^READY \d+$/m.test(buffer)) return;
    }
  } finally {
    reader.releaseLock();
  }
  const stderr = await new Response(child.stderr).text();
  throw new Error(`host exited before READY: ${stderr.trim()}`);
}

async function stopSystem(
  child: Bun.Subprocess<"ignore", "pipe", "pipe">,
): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    child.exited.then(() => true),
    sleep(2_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await child.exited;
  }
}

async function launchToReady(): Promise<{
  child: Bun.Subprocess<"ignore", "pipe", "pipe">;
  startedAt: number;
  readyMs: number;
}> {
  const startedAt = performance.now();
  const child = spawnSystem();
  await waitForReady(child);
  return {
    child,
    startedAt,
    readyMs: Number((performance.now() - startedAt).toFixed(2)),
  };
}

function artifact(path: string): ArtifactEntry {
  return { path: relative(path), bytes: statSync(path).size };
}

function sumBytes(entries: ArtifactEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}

function mib(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2);
}

if (process.platform !== "darwin") {
  throw new Error("the classic baseline protocol currently requires macOS footprint");
}
for (const path of [binary, systemPlanPath]) {
  if (!existsSync(path)) {
    throw new Error(`missing ${relative(path)}; run bun run build first`);
  }
}

const lockProbe = await $`swift -e ${
  'import CoreGraphics\nlet d = CGSessionCopyCurrentDictionary() as? [String: Any]\nprint(d?["CGSSessionScreenIsLocked"] ?? "unlocked")'
}`.quiet().nothrow().text();
if (lockProbe.includes("1")) {
  throw new Error("the macOS session is locked; unlock it before measuring");
}

const systemPlan = await Bun.file(systemPlanPath).json();
if (systemPlan.applications.length === 0) {
  throw new Error("The classic baseline requires the historical desktop showcase. It must not label a Devices build as the classic desktop; use the revision recorded in docs/bench.");
}
const packageOutputs: string[] = [
  systemPlan.systemUI.plan.app.output,
  ...systemPlan.applications.map(
    (application: { plan: { app: { output: string } } }) =>
      application.plan.app.output,
  ),
];
const packageArtifacts = packageOutputs.flatMap((output) => [
  artifact(resolve(DIST, `${output}.js`)),
  artifact(resolve(DIST, `${output}.pak`)),
]);
const systemUiOutput = systemPlan.systemUI.plan.app.output as string;
const systemUiArtifacts = packageArtifacts.filter((entry) =>
  basename(entry.path).startsWith(`${systemUiOutput}.`),
);
const applicationArtifacts = packageArtifacts.filter(
  (entry) => !systemUiArtifacts.includes(entry),
);
const hostArtifact = artifact(binary);
const planArtifact = artifact(systemPlanPath);
const artifactSizes = {
  hostExecutable: hostArtifact,
  systemUi: {
    files: systemUiArtifacts,
    bytes: sumBytes(systemUiArtifacts),
  },
  installedApplications: {
    count: systemPlan.applications.length as number,
    files: applicationArtifacts,
    bytes: sumBytes(applicationArtifacts),
  },
  resolvedSystemPlan: planArtifact,
  installedRuntimeBytes:
    hostArtifact.bytes + sumBytes(packageArtifacts) + planArtifact.bytes,
};

const caffeinate = Bun.spawn(["caffeinate", "-dimsu"], {
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
});
try {
  console.log("warmup launch (not recorded)");
  const warmup = await launchToReady();
  await stopSystem(warmup.child);
  await sleep(1_000);

  const coldStartMs: number[] = [];
  for (let run = 0; run < coldRuns; run += 1) {
    const launch = await launchToReady();
    coldStartMs.push(launch.readyMs);
    console.log(`cold ${run + 1}/${coldRuns}: ${launch.readyMs.toFixed(2)} ms`);
    await stopSystem(launch.child);
    await sleep(1_000);
  }

  console.log(`idle memory: settle ${settleMs / 1000} s`);
  const idle = await launchToReady();
  await sleep(settleMs);
  const memory: ProcessSample[] = [];
  for (let sample = 0; sample < memorySamples; sample += 1) {
    const value = await sampleProcessTree(idle.child.pid, idle.startedAt);
    memory.push(value);
    console.log(
      `memory ${sample + 1}/${memorySamples}: ${mib(value.rssBytes)} MiB RSS, ${value.processCount} process(es)`,
    );
    if (sample + 1 < memorySamples) await sleep(sampleIntervalMs);
  }
  const footprintBytes = await physicalFootprintBytes(idle.child.pid);
  await stopSystem(idle.child);

  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const productCommit = await text(["git", "rev-parse", "HEAD"]);
  const pocketJsCommit = await text([
    "git",
    "-C",
    POCKETJS_ROOT,
    "rev-parse",
    "HEAD",
  ]);
  const cpu = await text(["sysctl", "-n", "machdep.cpu.brand_string"]);
  const machineMemoryBytes = Number(await text(["sysctl", "-n", "hw.memsize"]));
  const osVersion = await text(["sw_vers", "-productVersion"]);
  const osBuild = await text(["sw_vers", "-buildVersion"]);
  const summary = {
    coldStartMsMedian: Number(median(coldStartMs).toFixed(2)),
    idleRssMiBMedian: Number(
      (median(memory.map((item) => item.rssBytes)) / 1024 / 1024).toFixed(2),
    ),
    idlePhysicalFootprintMiB: Number((footprintBytes / 1024 / 1024).toFixed(2)),
    idleProcessCountMax: Math.max(...memory.map((item) => item.processCount)),
    installedRuntimeMiB: Number(mib(artifactSizes.installedRuntimeBytes)),
    hostExecutableMiB: Number(mib(hostArtifact.bytes)),
  };
  const report = {
    schemaVersion: 1,
    label: "Pocket Shell Desktop classic baseline",
    measuredAt: now.toISOString(),
    quick,
    source: { productCommit, pocketJsCommit },
    machine: {
      cpu,
      memoryBytes: machineMemoryBytes,
      osVersion,
      osBuild,
    },
    protocol: {
      target: "macos-app release",
      coldStart:
        "one unrecorded warmup, then process-cold/cache-warm spawn to first painted frame",
      coldRuns,
      memory: `launch to first frame, settle ${settleMs} ms, then ${memorySamples} process-tree samples every ${sampleIntervalMs} ms`,
      rss: "ps RSS summed over the process tree",
      physicalFootprint: "macOS footprint phys_footprint summed over the process tree",
      size: "logical file bytes; debug symbols and source files excluded",
    },
    summary,
    artifactSizes,
    raw: { coldStartMs, memory, footprintBytes },
  };

  mkdirSync(reportDir, { recursive: true });
  const base = resolve(reportDir, `classic-${date}`);
  await Bun.write(`${base}.json`, JSON.stringify(report, null, 2) + "\n");
  const markdown = `# Pocket Shell Desktop classic baseline (${date})

**Measured source:** Pocket Shell Desktop \`${productCommit}\`, PocketJS \`${pocketJsCommit}\`
**Machine:** ${cpu}, ${(machineMemoryBytes / 1024 / 1024 / 1024).toFixed(0)} GiB, macOS ${osVersion} (${osBuild})

| Metric | Result |
|---|---:|
| Native host executable | ${mib(hostArtifact.bytes)} MiB |
| System UI JS + PAK | ${mib(artifactSizes.systemUi.bytes)} MiB |
| ${artifactSizes.installedApplications.count} installed app JS + PAK artifacts | ${mib(artifactSizes.installedApplications.bytes)} MiB |
| Complete installed runtime | ${mib(artifactSizes.installedRuntimeBytes)} MiB |
| Cold start to first painted frame, median of ${coldRuns} | ${summary.coldStartMsMedian.toFixed(2)} ms |
| Settled idle RSS, median of ${memorySamples} | ${summary.idleRssMiBMedian.toFixed(2)} MiB |
| Settled physical footprint | ${summary.idlePhysicalFootprintMiB.toFixed(2)} MiB |
| Maximum idle process-tree count | ${summary.idleProcessCountMax} |

## Protocol

The release build contains the classic System UI and all ${artifactSizes.installedApplications.count}
installed Pocket applications. Size values are logical file bytes. The complete
installed runtime is the native host, every resolved package's JS and PAK, and
the resolved System plan; build intermediates, source files and debug symbols
are excluded.

Cold start is measured from process spawn to the host's first-painted-frame
\`READY\` marker. One warmup launch is excluded, so these are **process-cold,
cache-warm** launches rather than disk-cold boots. The recorded samples are:
${coldStartMs.map((value) => value.toFixed(2)).join(", ")} ms.

For memory, the System reaches its first frame, remains hands-off for
${settleMs / 1000} seconds, and is then sampled ${memorySamples} times at
${sampleIntervalMs / 1000}-second intervals. RSS comes from \`ps\` over the
whole process tree. Physical footprint comes from macOS \`footprint\` after
the RSS samples. **The process-tree count pins the one-native-process System
architecture; AppInstances are isolated JavaScript realms, not OS child
processes.** Raw samples and per-file sizes are in
\`classic-${date}.json\`.

Reproduce on an unlocked macOS desktop:

\`\`\`sh
bun run build
bun run benchmark:classic
\`\`\`
`;
  await Bun.write(`${base}.md`, markdown);
  console.log(`wrote ${relative(base)}.{json,md}`);
  console.log(summary);
} finally {
  if (caffeinate.exitCode === null) caffeinate.kill("SIGTERM");
  await caffeinate.exited;
}
