// SPDX-License-Identifier: GPL-3.0-or-later
// scripts/azahar.ts — run one tape in the emulator and hand back its frames.
//
// The console's capture build (`bun run 3ds --capture`) bakes a tape into the
// binary, dumps every frame of a window as a raw PICA200 readback onto the
// emulated SD card, and writes a `done` marker. This module owns that run:
// a throwaway emulator user directory so a previous run's frames can never
// satisfy this one, the settings a reproducible frame depends on, the launch,
// and the decode.
//
// Azahar has no headless mode, ignores SIGTERM and does not exit when the
// guest returns, so the driver owns its lifetime (SIGKILL on every path) and
// its $HOME. GUI-bound: it needs a logged-in session, not a CI runner.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { $ } from "bun";
import type { GoldenSpec } from "../../../vendor/pocketjs/tests/golden-specs.ts";
import { encodeThresholdInput, encodeTouchInput } from "../../../vendor/pocketjs/tests/golden-specs.ts";
import { DIST_FILM, ROOT } from "./paths.ts";

export const TOP_W = 400;
export const TOP_H = 240;
export const AUX_W = 320;
export const AUX_H = 240;

const APP = process.env.AZAHAR || "/Applications/Azahar.app";
const BINARY = `${APP}/Contents/MacOS/azahar`;
const SOURCE_CONFIG =
  process.env.AZAHAR_CONFIG || `${homedir()}/Library/Application Support/Azahar/config/qt-config.ini`;
const GRAPHICS_API = process.env.FILM_GRAPHICS_API ?? "0";
const TIMEOUT_MS = Number(process.env.FILM_TIMEOUT_MS ?? 240_000);
const LAUNCH_GRACE_MS = 20_000;

const FIXTURE = resolve(DIST_FILM, "home");
const USER_DIR = `${FIXTURE}/Library/Application Support/Azahar`;
const CONFIG = `${USER_DIR}/config/qt-config.ini`;
const DUMP = `${USER_DIR}/sdmc/pocketjs-captures`;
const CONSOLE_LOG = resolve(DIST_FILM, "azahar-console.log");

export function preflight(): void {
  if (process.platform !== "darwin") {
    throw new Error("the emulator driver is macOS-only (it launches Azahar through LaunchServices)");
  }
  if (!existsSync(BINARY)) throw new Error(`Azahar not found at ${APP} (set AZAHAR to the .app bundle)`);
  if (!existsSync(SOURCE_CONFIG)) {
    throw new Error(`Azahar config not found at ${SOURCE_CONFIG} (launch Azahar once, or set AZAHAR_CONFIG)`);
  }
  for (const tool of ["open", "pgrep", "pkill"]) {
    if (!Bun.which(tool)) throw new Error(`${tool} not found (required to launch and to reap the emulator)`);
  }
}

/** The emulator build a frame belongs to. Byte-exactness is promised for one
 *  build and one renderer, so it is recorded next to the goldens. */
export function buildStamp(): string {
  const version = Bun.spawnSync([BINARY, "--version"]).stdout.toString().trim();
  return `${version}, graphics_api=${GRAPHICS_API}`;
}

/** Clone the developer's settings, then pin the keys a reproducible frame
 *  depends on. Azahar ignores a value whose sibling `<key>\default=false`
 *  line is missing, so both lines are always written. */
function writeFixture(): void {
  rmSync(FIXTURE, { recursive: true, force: true });
  mkdirSync(`${USER_DIR}/config`, { recursive: true });
  mkdirSync(DUMP, { recursive: true });
  const sourceUserDir = SOURCE_CONFIG.replace(/\/config\/[^/]+$/, "");
  for (const directory of ["nand", "sysdata"]) {
    if (existsSync(`${sourceUserDir}/${directory}`)) {
      cpSync(`${sourceUserDir}/${directory}`, `${USER_DIR}/${directory}`, { recursive: true });
    }
  }

  let config = readFileSync(SOURCE_CONFIG, "utf8");
  const set = (key: string, value: string): void => {
    const assignment = new RegExp(`^${key}=.*$`, "gm");
    if ((config.match(assignment)?.length ?? 0) !== 1) {
      throw new Error(`qt-config.ini does not carry exactly one ${key} key`);
    }
    config = config.replace(new RegExp(`^${key}=.*$`, "m"), () => `${key}=${value}`);
    config = new RegExp(`^${key}\\\\default=.*$`, "m").test(config)
      ? config.replace(new RegExp(`^${key}\\\\default=.*$`, "m"), () => `${key}\\default=false`)
      : config.replace(new RegExp(`^${key}=.*$`, "m"), () => `${key}=${value}\n${key}\\default=false`);
  };
  // The renderers agree on the picture but not on every byte, so a frame
  // belongs to one backend and it is the software rasterizer — the one that
  // does not depend on this machine's GPU driver.
  set("graphics_api", GRAPHICS_API);
  // The capture transfers the render target itself; any internal upscale
  // changes what comes back.
  set("resolution_factor", "1");
  set("use_vsync", "false");
  set("frame_limit", "1000");
  set("use_disk_shader_cache", "false");
  set("check_for_update_on_start", "false");
  // The shell's bar and clock read the RTC, so the emulated clock is pinned
  // to 2000-01-01 00:00:00 instead of this machine's. It still advances with
  // emulated time, so a minute-resolution display is stable for the first
  // minute of a run. Azahar shifts that instant by its own time zone, which
  // runTape pins to UTC.
  set("init_clock", "1");
  set("init_time", "946684800");
  writeFileSync(CONFIG, config);
}

function running(): boolean {
  return Bun.spawnSync(["pgrep", "-f", BINARY], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

function kill(): void {
  Bun.spawnSync(["pkill", "-9", "-f", BINARY], { stdout: "ignore", stderr: "ignore" });
}

/** Build the capture binary for one tape. The tape and the dump window are
 *  baked in: the guest never reads them off the emulator's filesystem. */
export async function buildCapture(tape: GoldenSpec, frames: number): Promise<string> {
  const build = await $`bun ${resolve(import.meta.dir, "3ds.ts")} --capture`
    .cwd(ROOT)
    .env({
      ...process.env,
      POCKETJS_CAPTURE_INPUT: encodeThresholdInput({ ...tape, capture: [frames - 1] }),
      // The generic host tape uses semicolons; the 3DS build flag uses @ so
      // the baked value stays one shell argument through Make.
      POCKETJS_CAPTURE_TOUCH: encodeTouchInput({ ...tape, capture: [frames - 1] }).replaceAll(";", "@"),
      POCKETJS_CAP_START: "0",
      POCKETJS_CAP_N: String(frames),
    })
    .quiet()
    .nothrow();
  if (build.exitCode !== 0) {
    throw new Error(`capture build failed\n${build.stdout.toString()}${build.stderr.toString()}`);
  }
  const rom = resolve(ROOT, "dist/3ds/pocketshell-main.3dsx");
  if (!existsSync(rom)) throw new Error(`the capture build produced no ${rom}`);
  return rom;
}

/** Boot a capture .3dsx and wait for the guest's own completion marker. */
export async function runTape(rom: string): Promise<string> {
  writeFixture();
  const done = `${DUMP}/done`;
  const failure = `${DUMP}/error.txt`;
  rmSync(DUMP, { recursive: true, force: true });
  mkdirSync(DUMP, { recursive: true });
  kill();

  // LaunchServices, not a direct exec: Azahar only reaches the window server —
  // and only then advances the guest — when it is launched into the user's GUI
  // session. `--env` carries the fixture $HOME across the hand-off, plus TZ:
  // Azahar converts the pinned clock with its time zone, so without it every
  // top-screen golden depends on the recording machine's zone. `-n` refuses to
  // reuse an instance that is already up.
  const launch = Bun.spawnSync(
    ["open", "-n", "-a", APP, "--env", `HOME=${FIXTURE}`, "--env", "TZ=UTC",
      "--stdout", CONSOLE_LOG, "--stderr", CONSOLE_LOG, "--args", rom],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (launch.exitCode !== 0) throw new Error(`could not launch Azahar: ${launch.stderr.toString().trim()}`);

  const started = Date.now();
  let seenRunning = false;
  try {
    while (Date.now() - started < TIMEOUT_MS) {
      if (existsSync(failure)) throw new Error(readFileSync(failure, "utf8").trim());
      if (existsSync(done)) return DUMP;
      if (running()) seenRunning = true;
      else if (seenRunning) throw new Error("Azahar exited before the guest finished");
      else if (Date.now() - started > LAUNCH_GRACE_MS) throw new Error("Azahar never started");
      await Bun.sleep(100);
    }
    throw new Error(`timed out after ${TIMEOUT_MS} ms without the guest's done marker (see ${CONSOLE_LOG})`);
  } finally {
    kill();
  }
}

/** The display transfer keeps the screen's rotated orientation: the buffer is
 *  height-major and each RGBA8 word is stored A,B,G,R. Decoding it as a plain
 *  landscape image mismatches every pixel while looking almost right. */
export function decodeScreen(raw: Uint8Array, width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const source = (x * height + (height - 1 - y)) * 4;
      const destination = (y * width + x) * 4;
      rgba[destination] = raw[source + 3]!;
      rgba[destination + 1] = raw[source + 2]!;
      rgba[destination + 2] = raw[source + 1]!;
      rgba[destination + 3] = 255; // the target's own alpha is never presented
    }
  }
  return rgba;
}

export interface Frame {
  index: number;
  top: Uint8Array;
  auxiliary: Uint8Array;
}

/** One dumped frame, decoded. Throws when the file is missing or short: a
 *  truncated readback must never reach a golden or an animation. */
export function readFrame(dump: string, index: number): Frame {
  const read = (prefix: string, width: number, height: number): Uint8Array => {
    const path = `${dump}/${prefix}f${String(index).padStart(4, "0")}.raw`;
    if (!existsSync(path)) throw new Error(`frame ${index}: no ${path}`);
    const raw = readFileSync(path);
    const expected = width * height * 4;
    if (raw.byteLength !== expected) {
      throw new Error(`frame ${index}: expected ${expected} bytes (${width}x${height} RGBA8), got ${raw.byteLength}`);
    }
    return decodeScreen(raw, width, height);
  };
  return { index, top: read("", TOP_W, TOP_H), auxiliary: read("aux-", AUX_W, AUX_H) };
}

/** Both screens stacked the way the console is held: the 400 px top screen
 *  above the 320 px touch screen, centred, on black. */
export function stackFrame(frame: Frame): Uint8Array {
  const width = TOP_W;
  const height = TOP_H + AUX_H;
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255;
  rgba.set(frame.top, 0);
  const inset = Math.floor((TOP_W - AUX_W) / 2);
  for (let row = 0; row < AUX_H; row++) {
    const source = row * AUX_W * 4;
    const destination = ((TOP_H + row) * width + inset) * 4;
    rgba.set(frame.auxiliary.subarray(source, source + AUX_W * 4), destination);
  }
  return rgba;
}

export const STACK_W = TOP_W;
export const STACK_H = TOP_H + AUX_H;
