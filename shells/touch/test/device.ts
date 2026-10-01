// SPDX-License-Identifier: GPL-3.0-or-later
// Runs against an already deployed Pocket Shell Touch and `bun run touch tunnel`.
// Events enter GraphicsServices -> UIKit -> PocketJS contacts, never guest state.
// These are injected device gestures; they do not certify human touch latency.
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createCanvas } from "@napi-rs/canvas";
import { APPS } from "../src/catalog.ts";
import { ipodtouch4SysrootPath } from "../../../vendor/pocketjs/tools/ipodtouch4-toolchain.ts";
import { shellQuote } from "../../../vendor/pocketjs/tools/ipodtouch4-installation.ts";

const root = resolve(import.meta.dir, "../../..");
const vendor = join(root, "vendor/pocketjs");
const descriptor = JSON.parse(readFileSync(join(root, "shells/touch/ipodtouch4.json"), "utf8"));
const output = resolve(process.env.POCKET_SHELL_TOUCH_OUTPUT ?? join(root, ".pocket-build/validation/touch", new Date().toISOString().replaceAll(":", "-")));
mkdirSync(output, { recursive: true });
const cache = join(homedir(), ".cache/pocket-nexus/ipodtouch4/ssh");
const port = process.env.POCKETJS_IPODTOUCH4_PORT ?? "2224";
const ssh = ["ssh", "-p", port, "-i", join(cache, "id_rsa"), "-o", `UserKnownHostsFile=${join(cache, "known_hosts")}`,
  "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlias=[127.0.0.1]:2224", "-o", "HostKeyAlgorithms=+ssh-rsa",
  "-o", "PubkeyAcceptedAlgorithms=+ssh-rsa", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
  "-o", "ControlMaster=auto", "-o", "ControlPersist=15",
  "-o", `ControlPath=/tmp/pocket-shell-touch-${process.pid}`, "root@127.0.0.1"];
async function run(args: string[]): Promise<string> {
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", cwd: root });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(`${args[0]} failed (${code}): ${stderr}`);
  return stdout.trim();
}
const remote = (command: string) => run([...ssh, command]);
const bundle = await remote(`/var/root/Library/PocketJS/ipodtouch4-installer user-path ${shellQuote(descriptor.bundleId)}`);
if (!/^\/private\/var\/mobile\/Applications\/[A-Fa-f0-9-]+\/PocketShellTouch.app$/.test(bundle) &&
    !/^\/var\/mobile\/Applications\/[A-Fa-f0-9-]+\/PocketShellTouch.app$/.test(bundle)) throw new Error("Unexpected Touch shell User container");
const container = bundle.slice(0, -"/PocketShellTouch.app".length);
const statusPath = `${container}/tmp/pocketjs.status`;
const capturePath = `${container}/tmp/pocketjs.capture`;
const framePath = `${container}/tmp/pocketjs.frame.rgba`;
async function status() {
  const raw = await remote(`cat ${shellQuote(statusPath)}`);
  const fields = Object.fromEntries(raw.split("\n").map(line => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
  if (fields.state !== "running" || fields.error) throw new Error(raw);
  return { raw, fields };
}
const initial = await status();
if (initial.fields.drawable_width !== "640" || initial.fields.drawable_height !== "960") throw new Error("Expected Retina drawable");
const runtime = join(vendor, ".pocket-build/ipodtouch4/touch/runtime");
const helper = join(output, "shell-touch-input");
const sdk = await run(["xcrun", "--sdk", "macosx", "--show-sdk-path"]);
await run(["xcrun", "clang", "-target", "armv7-apple-ios6.0", "-miphoneos-version-min=6.0", "-Os", "-fno-stack-protector",
  "-Wno-incompatible-sysroot", "-isysroot", sdk, `-DPOCKET_TEST_BUNDLE="${descriptor.bundleId}"`,
  "-c", join(vendor, "tools/ime/ipod-tap.c"), "-o", `${helper}.o`]);
await run(["xcrun", "ld-classic", "-arch", "armv7", "-syslibroot", ipodtouch4SysrootPath(), "-L/usr/lib",
  "-iphoneos_version_min", "6.0", "-no_pie", "-no_uuid", "-no_function_starts", "-no_data_in_code_info", "-no_source_version",
  "-no_compact_unwind", "-no_adhoc_codesign", "-no_encryption", "-e", "start", "-o", helper,
  join(runtime, "csu-start.o"), join(runtime, "csu-dyld-glue.o"), join(runtime, "crt_globals.o"), `${helper}.o`, "-lSystem", "-lgcc_s.1"]);
await run(["ldid", "-S", helper]);
const deviceHelper = "/private/var/tmp/pocket-shell-touch-input";
const copy = Bun.spawn([...ssh, `cat > ${deviceHelper} && chmod 755 ${deviceHelper}`], { stdin: Bun.file(helper), stdout: "pipe", stderr: "pipe" });
if (await copy.exited) throw new Error("Could not stage the test event sender");
type Point = readonly [number, number, number];
const icon = (index: number): Point[] => [[APPS[index].x + 28, APPS[index].y + 28, 120]];
const gesture = (points: readonly Point[]) => remote(`${deviceHelper} --path ${points.flat().join(" ")}`);
async function capture(name: string) {
  await remote(`rm -f ${shellQuote(framePath)}; /bin/su mobile -c ${shellQuote(`touch ${capturePath}`)}`);
  // The capture request is polled by the native host; wait for the complete
  // frame and the host clearing its request file after close(), instead of
  // relying on SSH handshake time to hide that latency.
  const deadline = Date.now() + 10_000;
  while (await remote(`if [ -s ${shellQuote(framePath)} ] && [ ! -e ${shellQuote(capturePath)} ]; then echo ready; else echo pending; fi`) !== "ready") {
    if (Date.now() >= deadline) throw new Error(`Timed out capturing ${name}`);
    await Bun.sleep(100);
  }
  const p = Bun.spawn([...ssh, `cat ${shellQuote(framePath)}`], { stdout: "pipe", stderr: "pipe" });
  const [raw, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), p.exited]);
  if (code || raw.byteLength !== 640 * 960 * 4) throw new Error(`Invalid capture ${name}: ${raw.byteLength}`);
  const canvas = createCanvas(640, 960), ctx = canvas.getContext("2d"), pixels = ctx.createImageData(640, 960);
  // Device frames are glReadPixels, bottom row first.
  const source = new Uint8Array(raw);
  for (let y = 0; y < 960; y++) pixels.data.set(source.subarray((959 - y) * 2560, (960 - y) * 2560), y * 2560);
  ctx.putImageData(pixels, 0, 0);
  await Bun.write(join(output, `${name}.png`), canvas.toBuffer("image/png"));
  const receipt = await status();
  await Bun.write(join(output, `${name}.status`), receipt.raw + "\n");
  return { ...receipt, hash: Bun.hash(raw).toString(16) };
}

// Per-journey captures interrupt rendering; only the continuous-motion samples measure cadence.
const results: { name: string; actions: number; postCaptureFps: number }[] = [];
async function journey(name: string, points: readonly Point[], action = true, intermediate?: { afterMs: number; name: string }) {
  const before = await status();
  const input = gesture(points);
  if (intermediate) { await Bun.sleep(intermediate.afterMs); await capture(intermediate.name); }
  await input; await Bun.sleep(850);
  const after = await capture(name);
  if (after.fields.build_id !== initial.fields.build_id) throw new Error("Device build changed during validation");
  if (+after.fields.completed_touch_sequences - +before.fields.completed_touch_sequences !== 1 ||
      +after.fields.touch_sequences - +before.fields.touch_sequences !== 1 || after.fields.touch_down !== "0") {
    throw new Error(`${name}: expected one completed UIKit contact; missing or concurrent input invalidates this journey`);
  }
  if (action && (after.fields.action_name !== descriptor.actionName || +after.fields.action_value <= +before.fields.action_value)) throw new Error(`${name}: no guest action`);
  const result = { name, actions: +after.fields.action_value, postCaptureFps: +after.fields.window_frames * 1e6 / +after.fields.window_us };
  results.push(result); console.log(JSON.stringify(result));
}

let motionContacts = 0;
async function sampleMotion(name: string, points: readonly Point[], count: number) {
  // Captures interrupt the native timing window; measure only while one
  // continuous injected contact is held and each status heartbeat advances.
  await Bun.sleep(2500);
  const before = await status();
  let heartbeat = +before.fields.heartbeat;
  const moving = gesture(points), samples: number[] = [];
  try {
    for (let i = 0; i < count; i++) {
      await Bun.sleep(1600);
      const sample = await status(), f = sample.fields;
      if (f.build_id !== initial.fields.build_id || +f.heartbeat <= heartbeat || f.touch_down !== "1" ||
          +f.touch_sequences !== +before.fields.touch_sequences + 1 ||
          +f.completed_touch_sequences !== +before.fields.completed_touch_sequences)
        throw new Error(`${name}: stale status, changed build or unexpected contact during motion`);
      heartbeat = +f.heartbeat;
      await Bun.write(join(output, `${name}-${i}.status`), sample.raw + "\n");
      samples.push(+f.window_frames * 1e6 / +f.window_us);
    }
  } finally { await moving; }
  motionContacts++;
  await Bun.sleep(850);
  const after = await status();
  if (+after.fields.completed_touch_sequences !== +before.fields.completed_touch_sequences + 1 ||
      +after.fields.touch_sequences !== +before.fields.touch_sequences + 1 || after.fields.touch_down !== "0")
    throw new Error(`${name}: motion contact did not complete alone`);
  return samples;
}

// Full and focused runs enter the stack with identical app order, scroll
// offsets and gesture history; an unscrolled neighborhood is a lighter scene.
async function prepareStack() {
  await journey("00b-open-today", icon(0));
  await journey("01-scroll", [[160, 389, 80], [160, 214, 350]]);
  await journey("02-detail", [[110, 230, 120]]);
  await journey("03-edge-back", [[4, 238, 80], [221, 238, 420]]);
  await journey("04-quick-switch-music", [[40, 466, 80], [220, 466, 450], [220, 466, 3500]], true,
    { afterMs: 800, name: "04a-equal-size-neighbor-before-release" });
  await journey("04b-quick-back-today", [[280, 466, 80], [80, 466, 450]]);
  await journey("05-ordinary-swipe-home", [[160, 466, 80], [160, 240, 1800]], true,
    { afterMs: 650, name: "05a-only-current-app-moving" });
  for (const index of [3, 4, 5]) {
    const name = APPS[index].name.toLowerCase();
    await journey(`06-${name}-open`, icon(index));
    await journey(`07-${name}-scroll`, [[160, 389, 80], [160, 214, 350]]);
    await journey(`08-${name}-home`, [[160, 466, 80], [160, 425, 300]]);
  }
  await journey("09-open-music", icon(1));
  await journey("10-short-swipe-home", [[160, 466, 80], [160, 425, 300]]);
  await journey("11-peek-reverse-home", [[160, 466, 80], [160, 406, 300], [160, 406, 3500], [160, 466, 350]], false,
    { afterMs: 750, name: "11a-small-held-peek" });
  await journey("12-home-bar-overview", [[160, 466, 80], [160, 66, 500], [160, 66, 3500]], true,
    { afterMs: 850, name: "12a-large-lift-small-left-peek" });
  await journey("13-browse-to-photos", [[160, 230, 80], [250, 230, 400], [250, 230, 150]]);
  await journey("14-parallax-reversal", [[160, 250, 80], [196, 250, 300], [196, 250, 3500], [160, 250, 300], [160, 250, 150]], true,
    { afterMs: 700, name: "14a-parallax-held" });
  await journey("15-horizontal-ignores-upward-motion", [[160, 250, 80], [185, 252, 160], [190, 145, 250], [190, 145, 150]]);
}

try {
  // A fresh process makes this named journey reproducible.
  await remote(`/usr/bin/killall PocketShellTouch 2>/dev/null || true`);
  await remote("/bin/su mobile -c '/usr/bin/uiopen pocketjs-shell-touch://launch'");
  await Bun.sleep(1600);
  const restarted = await capture("00-home");
  if (restarted.fields.touch_sequences !== "0") throw new Error("Fresh process received input before validation");
  await prepareStack();
  if (process.argv.includes("--motion-only")) {
    const points: Point[] = [[160, 250, 80]];
    for (let i = 0; i < 12; i++) points.push([235, 250, 320], [90, 250, 320]);
    points.push([160, 250, 300], [160, 250, 150]);
    const samples: number[] = [];
    for (let round = 0; round < 2; round++) samples.push(...await sampleMotion(`stack-repeat-${round}`, points, 4));
    await capture("motion-final-stack");
    await journey("motion-leave-home", [[310, 425, 120]]);
    const final = await status();
    if (+final.fields.touch_sequences !== results.length + motionContacts ||
        +final.fields.completed_touch_sequences !== results.length + motionContacts || final.fields.touch_down !== "0") {
      throw new Error("Unexpected input during the repeated stack gestures");
    }
    await Bun.write(join(output, "results.json"), JSON.stringify({ build: initial.fields.build_id,
      input: "GraphicsServices injected touch", results, stackFps: samples }, null, 2) + "\n");
    console.log(`Repeated stack FPS: ${samples.map(n => n.toFixed(2)).join(", ")}`);
    if (samples.some(fps => !Number.isFinite(fps) || fps < 55)) throw new Error("Repeated stack rendering fell below 55 FPS");
  } else {
    const stackMotion: Point[] = [[160, 250, 80]];
    for (let i = 0; i < 12; i++) stackMotion.push([235, 250, 320], [90, 250, 320]);
    stackMotion.push([160, 250, 300], [160, 250, 150]);
    const stackFps = await sampleMotion("stack-motion", stackMotion, 3);
    await capture("16-after-stack-motion");
    await journey("17-open-photos", [[160, 220, 120]]);
    await journey("18-quick-switch-music", [[40, 466, 80], [220, 466, 450]]);
    await journey("19-quick-back-photos", [[280, 466, 80], [80, 466, 450]]);
    const quickMotion: Point[] = [[40, 466, 80]];
    for (let i = 0; i < 12; i++) quickMotion.push([240, 466, 320], [55, 466, 320]);
    quickMotion.push([40, 466, 300], [40, 466, 150]);
    const quickFps = await sampleMotion("quick-motion", quickMotion, 3);
    await capture("20-after-quick-motion");
    await journey("21-home", [[160, 466, 80], [160, 425, 300]]);
    await journey("22-open-music", icon(1));
    await journey("23-lift-hold-overview", [[160, 466, 80], [160, 425, 300], [160, 425, 280]]);
    for (const name of ["music", "photos", "notes", "weather", "today", "places", ...APPS.slice(6).map(app => app.name.toLowerCase())]) {
      await journey(`24-close-${name}`, [[160, 250, 80], [160, 90, 350]]);
    }
    await journey("25-empty-to-home", [[160, 220, 120]]);
    await journey("26-reopen-music", icon(1));
    await journey("27-only-music-in-deck", [[160, 466, 80], [160, 425, 300], [160, 425, 280]]);
    await journey("28-open-only-music", [[160, 220, 120]]);
    await journey("29-home-page-one", [[160, 466, 80], [160, 425, 300]]);
    await journey("30-page-two", [[280, 200, 80], [140, 200, 300], [140, 200, 3500], [40, 200, 300]], true,
      { afterMs: 750, name: "30a-home-pages-follow-finger" });
    await journey("31-second-page-edge", [[250, 220, 80], [30, 220, 350]]);
    await journey("32-page-one", [[40, 200, 80], [280, 200, 450]]);
    await journey("33-page-reversal", [[280, 200, 80], [80, 200, 350], [280, 200, 350], [280, 200, 200]]);
    await journey("34-vertical-home-drag", [[200, 310, 80], [200, 210, 350]], false);
    // All new mockups launch from their actual icons and retain the originating page.
    for (let index = 6; index < APPS.length; index++) {
      if (index === 12) await journey("35-page-two-again", [[280, 200, 80], [40, 200, 400]]);
      const name = APPS[index].name.toLowerCase();
      await journey(`36-${name}-open`, icon(index));
      await journey(`37-${name}-scroll`, [[160, 389, 80], [160, 214, 350]]);
      await journey(`38-${name}-home`, [[160, 466, 80], [160, 425, 300]]);
    }
    await journey("39-dock-music-on-page-two", icon(1));
    await journey("40-dock-return-to-page-two", [[160, 466, 80], [160, 425, 300]]);
    await journey("41-page-two-overview", [[160, 466, 80], [160, 365, 350]]);
    await journey("42-page-two-open-recent", [[160, 220, 120]]);
    await journey("43-return-to-page-two", [[160, 466, 80], [160, 425, 300]]);
    await journey("44-page-one", [[40, 200, 80], [280, 200, 450]]);
    const homeMotion: Point[] = [[280, 210, 80]];
    for (let i = 0; i < 12; i++) homeMotion.push([40, 210, 320], [280, 210, 320]);
    homeMotion.push([280, 210, 150]);
    const homeFps = await sampleMotion("home-motion", homeMotion, 3);
    await capture("45-home-after-paging");
    await journey("46-home-reveals-recent-music", [[160, 466, 80], [160, 365, 350]]);
    await journey("47-browse-calculator-without-opening", [[160, 230, 80], [250, 230, 400], [250, 230, 150]]);
    await journey("48-exit-browsed-deck", [[310, 425, 120]]);
    await journey("49-home-reveals-music-again", [[160, 466, 80], [160, 365, 350]]);
    await journey("50-browse-calculator", [[160, 230, 80], [250, 230, 400], [250, 230, 150]]);
    await journey("51-open-calculator-from-page-one", [[160, 220, 120]]);
    await journey("52-off-page-app-minimizes-on-page-one", [[160, 466, 80], [160, 425, 300]], true,
      { afterMs: 570, name: "52a-off-page-app-shrinks-inside-current-page" });
    await journey("53-home-reveals-recent-calculator", [[160, 466, 80], [160, 365, 350]]);
    await journey("54-leave-on-home-page-one", [[310, 425, 120]]);
    const final = await status();
    if (+final.fields.touch_sequences !== results.length + motionContacts ||
        +final.fields.completed_touch_sequences !== results.length + motionContacts || final.fields.touch_down !== "0") {
      throw new Error("Unexpected input during the continuous-motion gestures");
    }
    await Bun.write(join(output, "results.json"), JSON.stringify({ build: initial.fields.build_id, input: "GraphicsServices injected touch", results, quickFps, stackFps, homeFps }, null, 2) + "\n");
    console.log(`Quick switch FPS: ${quickFps.map(n => n.toFixed(2)).join(", ")}`);
    console.log(`Stack parallax FPS: ${stackFps.map(n => n.toFixed(2)).join(", ")}`);
    console.log(`Home paging FPS: ${homeFps.map(n => n.toFixed(2)).join(", ")}`);
    if ([...quickFps, ...stackFps, ...homeFps].some(fps => !Number.isFinite(fps) || fps < 55)) throw new Error("Continuous gesture rendering fell below 55 FPS");
    console.log(`Validated ${results.length} journeys; captures and receipts: ${output}`);
  }
} finally {
  await remote(`rm -f ${deviceHelper}`);
  await run([...ssh.slice(0, -1), "-O", "exit", ssh[ssh.length - 1]]);
}
