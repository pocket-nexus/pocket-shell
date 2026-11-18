// SPDX-License-Identifier: GPL-3.0-or-later
// devices/3ds/build.ts <app> [cargo args…] — build the app JS+pak (PocketJS
// tools/build.ts), the Rust core staticlib, QuickJS, and the .3dsx for the
// "3ds-dev" host contract (pocket.host.json, tools/profile.ts).
//
//   bun devices/3ds/build.ts --plan=<resolved-plan.json> --project-root=<dir>
//   bun devices/3ds/build.ts 3ds-demo              (a PocketJS demo, from vendor/pocketjs)
//   bun devices/3ds/build.ts 3ds-demo --capture    (e2e frame-dump build)
//   bun devices/3ds/build.ts 3ds-demo --cia        (also emit an installable CIA)
//
// The toolchain spans two environments. The Rust half compiles on the build
// machine: armv6k-nintendo-3ds is a built-in rustc target, so -Z build-std
// works host-side with no devkitARM present. The C half compiles inside the
// devkitpro/devkitarm container, which owns arm-none-eabi-gcc, libctru,
// citro3d, picasso and 3dsxtool. The container sees two bind mounts: PocketJS
// (vendor/pocketjs) at /repo, the first mount of PocketJS's native step, and
// this repository at /external1, which holds the product, the host services
// and the outputs. A path under vendor/pocketjs translates through /repo.
//
//   1. PocketJS tools/build.ts -> <outdir>/<output>.js + <outdir>/<output>.pak
//   1b. pocket-package.ts      -> dist/3ds/<output>.pocket (also ROMFS recovery)
//   2. cargo rustc --release   -> .pocket-build/native/3ds/product/armv6k-nintendo-3ds/release/
//                                 libpocketjs_3ds_core.a   (build machine, from core/)
//   3. QuickJS                 -> vendor/pocketjs/dist/3ds/quickjs/libquickjs.a  (container, cached)
//   3b. makerom (--cia)        -> dist/3ds/makerom/bin/makerom    (container, cached)
//   4. devices/3ds/Makefile    -> dist/3ds/<output>.3dsx          (container)
//                                 dist/3ds/<output>.cia  under --cia
//
// <output> is the resolved plan's app.output, not the bare app argument.
//
// dist/3ds/ at this repository's root is the target's output tree. QuickJS is
// the one exception: PocketJS's native step compiles and caches it in its own
// ignored dist/3ds/quickjs.
//
// ---------------------------------------------------------------------------
// The contract with devices/3ds/Makefile
// ---------------------------------------------------------------------------
// The Makefile runs in the container with CWD devices/3ds and receives all
// paths as container paths. It gets the variables hostBuildEnvironment()
// emits, of which it reads POCKETJS_TARGET and POCKETJS_HOST_ABI: the values
// the host must publish as ui.__host / ui.__hostAbi, so the C compile derives
// -DPOCKETJS_TARGET_ID and -DPOCKETJS_HOST_ABI from them rather than from
// literals. Plus:
//
//   POCKETJS_ROOT          the PocketJS checkout (vendor/pocketjs): platform,
//                          renderer, facade, worker, guest and contract headers
//   POCKETJS_CORE_LIB      absolute path to libpocketjs_3ds_core.a
//   POCKETJS_QUICKJS_DIR   directory holding quickjs.h and libquickjs.a
//   POCKETJS_APP_POCKET    target-thinned recovery guest to embed
//   POCKETJS_BUILD_DIR     scratch directory for objects, .shbin and the .elf
//   POCKETJS_OUT_3DSX      the .3dsx path to write
//   POCKETJS_SMDH_TITLE    application title  (3dsxtool --smdh metadata)
//   POCKETJS_SMDH_AUTHOR   application id
//   POCKETJS_SMDH_DESC     application description
//   POCKETJS_CAPTURE       "1" under --capture, "" otherwise
//   POCKETJS_CAPTURE_INPUT scripted input tape ("frame:mask,…"), baked in
//   POCKETJS_CAPTURE_TOUCH scripted bottom-screen touch tape, baked in
//   POCKETJS_CAP_START     first frame to dump
//   POCKETJS_CAP_N         how many frames to dump
//
// and, only under --cia, the five the CIA goal needs:
//
//   POCKETJS_OUT_CIA       the .cia path to write ("" disables the goal)
//   POCKETJS_MAKEROM       the makerom binary built by ensureMakerom()
//   POCKETJS_CIA_TITLE     exheader process name, the manifest title cut to 8 B
//   POCKETJS_CIA_PRODUCT   CTR-P-XXXX product code
//   POCKETJS_CIA_UNIQUE_ID title id unique part, e.g. 0xFF3D0
//
// The default goal must produce POCKETJS_OUT_3DSX and nothing outside
// POCKETJS_BUILD_DIR and dist/3ds/.
//
// The viewport, the raster density and the application's state slot on the
// SD card are not among them: the host reads all three at boot from the plan
// and identity of romfs:/app.pocket. Apart from --capture, io.offload and
// media.playback builds, the code segments are therefore the same for every
// app, and they are the ones the generic runtime carries.

import { $ } from "bun";
import { readPocketManifest } from "../../vendor/pocketjs/framework/src/manifest/load.ts";
import { capture, prepareNative3ds, runNative3dsMake } from "../../vendor/pocketjs/tools/build/3ds/native.ts";
import type { PocketProfile } from "../../vendor/pocketjs/framework/src/profile.ts";
import type { RuntimeBuildContext } from "../../vendor/pocketjs/framework/src/host-config.ts";
import { ensureThreeDsProfileHeader, threeDsProfileHeader } from "./tools/contracts.ts";
import { containerPathFor, runContainer, type Mount } from "../../vendor/pocketjs/tools/3ds-toolchain.ts";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { encodePocketPackage } from "../../vendor/pocketjs/contracts/spec/pocket-package.ts";
import {
  extractHostBuildInputs,
  hostBuildEnvironment,
} from "../../vendor/pocketjs/framework/src/manifest/host-build-inputs.ts";
import {
  canonicalJson,
  verifyPlanHash,
  type ResolvedBuildPlan,
} from "../../vendor/pocketjs/framework/src/manifest/plan.ts";
import {
  THREE_DS_DEV_TARGET_ID,
  THREE_DS_PROFILE,
  resolve3dsBuildPlan,
} from "./tools/profile.ts";
import { makeVariant } from "../../vendor/pocketjs/tools/pocket-pack.ts";
const softwareProfile = THREE_DS_PROFILE;

/** This repository's root, with a trailing slash: outputs, plans and caches. */
const repository = new URL("../..", import.meta.url).pathname;
/** The pinned PocketJS: the guest compiler, the engine crates, the platform,
 *  the renderer and the QuickJS facade. */
const pocketjs = `${repository}vendor/pocketjs/`;
const hostDirectory = `${repository}devices/3ds/`;


/** The dev profile's target id; a plan for any other target is rejected. */
const TARGET_ID = THREE_DS_DEV_TARGET_ID;
// The toolchain pins are PocketJS's: the devkitARM image by digest
// (THREE_DS_CONTAINER_IMAGE) and the QuickJS revision (THREE_DS_QUICKJS_PIN)
// in tools/3ds-toolchain.ts, the build-std nightly (RUST_TOOLCHAINS.threeDs)
// in tools/build/toolchains/rust.ts. tools/build/3ds/native.ts applies them.

// makerom is what turns the ELF into an installable title. It ships in neither
// devkitPro nor Homebrew, so --cia clones and builds it: every dependency
// (mbedtls, blz, yaml) is vendored in the repository, so the clone is the only
// step that needs the network and the build runs in the same offline container
// as everything else.
const MAKEROM_REPOSITORY = "https://github.com/3DSGuy/Project_CTR";
/** Project_CTR revision used to package the hardware-tested CIA. */
export const MAKEROM_REVISION = "e8f5f529c54ff9b22a2491a480ffa69206bf7b19";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface ThreeDsArguments {
  /** Bare app name (apps/<app>/pocket.app.json under --project-root, else a
   *  PocketJS demo); empty when --plan is given. */
  readonly app: string;
  readonly planPath?: string;
  readonly manifestPath?: string;
  readonly projectRoot: string;
  /** Where PocketJS tools/build.ts writes <app>.js and <app>.pak (trailing slash). */
  readonly outputDir: string;
  /** Where the .3dsx lands. */
  readonly packageDir: string;
  readonly skipBuild: boolean;
  /** Build the target-thinned guest package without rebuilding the native runtime. */
  readonly pocketOnly: boolean;
  readonly capture: boolean;
  /** A product extension's directory (extension.mk), for a plan declaring system.extension. */
  readonly extensionDir?: string;
  /** The directory staged as romfs:/extension. */
  readonly extensionRomfs?: string;
  /** Also package the ELF as an installable CIA title. */
  readonly cia: boolean;
  /** Everything unrecognized, forwarded to cargo. */
  readonly cargoArgs: readonly string[];
}

export interface ParseOptions {
  readonly repositoryRoot?: string;
  readonly workingDirectory?: string;
}

export function parse3dsArguments(
  argv: readonly string[],
  options: ParseOptions = {},
): ThreeDsArguments {
  const root = options.repositoryRoot ?? repository;
  let app = "";
  let planPath: string | undefined;
  let manifestPath: string | undefined;
  let projectRoot = options.workingDirectory ?? process.cwd();
  let outputDir = `${root}dist/3ds/guest/`;
  let packageDir = `${root}dist/3ds`;
  let skipBuild = false;
  let pocketOnly = false;
  let capture = false;
  let cia = false;
  let extensionDir: string | undefined;
  let extensionRomfs: string | undefined;
  const cargoArgs: string[] = [];

  for (const a of argv) {
    if (a === "--capture") capture = true;
    else if (a === "--cia") cia = true;
    else if (a === "--pocket-only") pocketOnly = true;
    else if (a === "--skip-build") skipBuild = true;
    else if (a.startsWith("--plan=")) planPath = resolvePath(a.slice("--plan=".length));
    else if (a.startsWith("--manifest=")) manifestPath = resolvePath(a.slice("--manifest=".length));
    else if (a.startsWith("--project-root=")) projectRoot = resolvePath(a.slice("--project-root=".length));
    else if (a.startsWith("--outdir=")) outputDir = resolvePath(a.slice("--outdir=".length)) + "/";
    else if (a.startsWith("--package-outdir=")) packageDir = resolvePath(a.slice("--package-outdir=".length));
    else if (a.startsWith("--extension=")) extensionDir = resolvePath(a.slice("--extension=".length));
    else if (a.startsWith("--extension-romfs=")) extensionRomfs = resolvePath(a.slice("--extension-romfs=".length));
    else if (a === "--config" || a.startsWith("--config=") || a === "--no-config") {
      throw new Error("PocketJS 3ds: application configuration belongs in pocket.app.json");
    } else if (!planPath && !app && !a.startsWith("-")) app = a;
    else cargoArgs.push(a);
  }

  return {
    app,
    planPath,
    manifestPath,
    projectRoot,
    outputDir,
    packageDir,
    skipBuild,
    pocketOnly,
    capture,
    extensionDir,
    extensionRomfs,
    cia,
    cargoArgs,
  };
}

const USAGE =
  "usage: bun devices/3ds/build.ts <app> [--plan=<resolved-plan.json>] [--project-root=<dir>] " +
  "[--outdir=<dir>] [--package-outdir=<dir>] [--extension=<dir>] [--extension-romfs=<dir>] [--skip-build] [--pocket-only] [--capture] [--cia] [cargo args…]   " +
  "e.g. bun devices/3ds/build.ts --plan=.pocket/plans/3ds/pocket-shell.3ds.plan.json --project-root=shells/3ds";

export interface CaptureDefines {
  readonly input: string;
  readonly touch: string;
  readonly start: string;
  readonly count: string;
}

/**
 * Validate the values compiled into a capture binary. Besides giving
 * direct `--capture` builds a complete 0..0 default window, the narrow grammar
 * keeps environment text from becoming C or shell syntax in the Makefile's
 * `-D` arguments.
 */
export function captureDefines(
  environment: Readonly<Record<string, string | undefined>>,
): CaptureDefines {
  const input = environment.POCKETJS_CAPTURE_INPUT ?? "";
  const touch = environment.POCKETJS_CAPTURE_TOUCH ?? "";
  const start = environment.POCKETJS_CAP_START ?? "0";
  const count = environment.POCKETJS_CAP_N ?? "1";
  const integer = "(?:0[xX][0-9a-fA-F]+|[0-9]+)";
  const tape = new RegExp(`^(?:${integer}:${integer})(?:,${integer}:${integer})*$`);
  if (input !== "" && !tape.test(input)) {
    throw new Error(
      "PocketJS 3ds: POCKETJS_CAPTURE_INPUT must be frame:mask pairs separated by commas",
    );
  }
  const touchTape =
    /^(?:[0-9]+:(?:-|[0-9]+,[0-9]+,[0-9]+))(?:@[0-9]+:(?:-|[0-9]+,[0-9]+,[0-9]+))*$/;
  if (touch !== "" && !touchTape.test(touch)) {
    throw new Error(
      "PocketJS 3ds: POCKETJS_CAPTURE_TOUCH must be frame:- or frame:id,x,y entries separated by @",
    );
  }
  for (const entry of touch === "" ? [] : touch.split("@")) {
    const [frame, payload] = entry.split(":");
    boundedCaptureInteger("POCKETJS_CAPTURE_TOUCH frame", frame!, true);
    if (payload === "-") continue;
    const [id, x, y] = payload!.split(",");
    boundedCaptureInteger("POCKETJS_CAPTURE_TOUCH id", id!, true, 0xffn);
    boundedCaptureInteger("POCKETJS_CAPTURE_TOUCH x", x!, true, 319n);
    boundedCaptureInteger("POCKETJS_CAPTURE_TOUCH y", y!, true, 239n);
  }
  boundedCaptureInteger("POCKETJS_CAP_START", start, true);
  boundedCaptureInteger("POCKETJS_CAP_N", count, false);
  return { input, touch, start, count };
}

function boundedCaptureInteger(
  name: string,
  value: string,
  allowZero: boolean,
  maximum = 0xffff_ffffn,
): void {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`PocketJS 3ds: ${name} must be an unsigned decimal integer`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum || (!allowZero && parsed === 0n)) {
    throw new Error(`PocketJS 3ds: ${name} is outside its supported range`);
  }
}

// ---------------------------------------------------------------------------
// Container plumbing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// makerom (--cia)
// ---------------------------------------------------------------------------

/**
 * Clone and build makerom, and cache the binary. The stamp covers the checked
 * out revision and the container image, so a re-clone or a new devkitARM
 * release rebuilds and nothing else does.
 *
 * The clone happens on the build machine because the container runs with --network=none;
 * the build happens in the container because that is where this repository's
 * device toolchain lives. makerom vendors mbedtls, blz and yaml, so nothing
 * after the clone reaches the network.
 */
export async function ensureMakerom(
  cacheDirectory: string,
  imageId: string,
  mounts: readonly Mount[],
): Promise<string> {
  const checkout = join(cacheDirectory, "src");
  const project = join(checkout, "makerom");
  const binary = join(project, "bin", "makerom");
  const stampPath = join(cacheDirectory, ".stamp");

  const installedHead = existsSync(join(project, "makefile"))
    ? await capture("git", ["rev-parse", "HEAD"], checkout)
    : undefined;
  if (installedHead?.exitCode !== 0 || installedHead?.stdout.trim() !== MAKEROM_REVISION) {
    if (!Bun.which("git")) {
      throw new Error("PocketJS 3ds: --cia needs git on PATH to fetch makerom.");
    }
    mkdirSync(cacheDirectory, { recursive: true });
    rmSync(checkout, { recursive: true, force: true });
    console.log(`PocketJS 3ds: fetching makerom ${MAKEROM_REVISION} …`);
    const steps: ReadonlyArray<readonly [readonly string[], string]> = [
      [["init", checkout], repository],
      [["remote", "add", "origin", MAKEROM_REPOSITORY], checkout],
      [["fetch", "--depth", "1", "origin", MAKEROM_REVISION], checkout],
      [["checkout", "--detach", "FETCH_HEAD"], checkout],
    ];
    for (const [command, cwd] of steps) {
      const result = await capture("git", command, cwd);
      if (result.exitCode !== 0) {
        rmSync(checkout, { recursive: true, force: true });
        throw new Error(
          `PocketJS 3ds: could not fetch makerom ${MAKEROM_REVISION} into ${checkout}.\n` +
            (result.stderr.trim() || result.stdout.trim()) +
            "\nmakerom is the only tool that builds a CIA and ships in neither " +
            "devkitPro nor Homebrew. With no network, place that revision at " +
            `${checkout} and rerun; the build itself is offline.`,
        );
      }
    }
  }

  const head = await capture("git", ["rev-parse", "HEAD"], checkout);
  if (head.exitCode !== 0 || head.stdout.trim() !== MAKEROM_REVISION) {
    throw new Error(`PocketJS 3ds: makerom checkout is not pinned to ${MAKEROM_REVISION}`);
  }
  const stamp = `${imageId} ${MAKEROM_REVISION}`;
  if (
    existsSync(binary) &&
    existsSync(stampPath) &&
    readFileSync(stampPath, "utf8").trim() === stamp
  ) {
    console.log(`PocketJS 3ds: makerom cached (${binary})`);
    return binary;
  }

  console.log("PocketJS 3ds: building makerom …");
  await runContainer(
    ["make deps", `make -j${availableParallelism()}`].join("\n"),
    mounts,
    containerPathFor(project, mounts),
    {},
    "makerom build",
  );
  if (!existsSync(binary)) {
    throw new Error(`PocketJS 3ds: the makerom build did not produce ${binary}`);
  }
  writeFileSync(stampPath, `${stamp}\n`);
  return binary;
}

// ---------------------------------------------------------------------------
// CIA identity
// ---------------------------------------------------------------------------

/** FNV-1a over the UTF-8 bytes; the hash this repository already stamps with. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The unique part of the title id, `0x0004000000<unique>00`.
 *
 * **Unique ids 0xFF000-0xFFFFF are the homebrew block**: no retail game and no
 * system title is assigned one, so an installed CIA cannot collide with a title
 * the console already has. The low 12 bits come from the manifest's app id, so
 * an app keeps its title id across rebuilds — an install replaces the previous
 * one instead of accumulating — and two apps get different ids without anyone
 * choosing a number by hand.
 */
export function ciaUniqueId(appId: string): string {
  return `0x${(0xff000 | (fnv1a32(appId) & 0xfff)).toString(16).toUpperCase()}`;
}

/**
 * Stable SD-card namespace for one application's mutable 3DS Runtime state.
 *
 * The complete manifest id is the authority. A fixed-length SHA-256 prefix
 * keeps every native path bounded while making unrelated HBL entries unable
 * to recover or hot-load one another's package.
 */
export function runtimeSlot(appId: string): string {
  return createHash("sha256").update(appId, "utf8").digest("hex").slice(0, 16);
}

/**
 * The full 64-bit title id as hex: category 0x00040000 (a CTR application),
 * then the unique id shifted up by the 8-bit variation, which is 0. It names
 * the directory the installed title lands in, on an SD card and in Azahar
 * alike: `Nintendo 3DS/<id>/<id>/title/00040000/<low 32 bits>/content/`.
 */
export function ciaTitleId(appId: string): string {
  const unique = 0xff000 | (fnv1a32(appId) & 0xfff);
  return `00040000${((unique << 8) >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * The product code, `CTR-P-XXXX`. Nintendo assigns retail codes; homebrew
 * invents its own, so the four characters are the app id's last dotted segment
 * reduced to A-Z0-9, extended from the id's hash when it is shorter than four.
 * The shape is the one makerom validates even without `FreeProductCode`.
 */
export function ciaProductCode(appId: string): string {
  const segment = appId.split(".").pop() || appId;
  const letters = segment.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const filler = fnv1a32(appId).toString(36).toUpperCase();
  return `CTR-P-${`${letters}${filler}`.slice(0, 4)}`;
}

/**
 * The exheader's process name, which is **8 bytes** — makerom truncates a
 * longer BasicInfo.Title to it silently, so the cut happens here where it is
 * visible. Characters that would end the RSF's quoted scalar or start another
 * substitution are dropped first. The title HOME Menu shows is the SMDH's, not
 * this one, and keeps the manifest string whole.
 */
export function ciaProcessName(title: string, appId: string): string {
  const printable = title.replace(/[^\x20-\x7e]/g, "").replace(/["\\$]/g, "");
  const cut = printable.slice(0, 8).trim();
  return cut || `PJ${(fnv1a32(appId) & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Build plan
// ---------------------------------------------------------------------------

function assert3dsPlan(plan: ResolvedBuildPlan, origin: string): ResolvedBuildPlan {
  if (!verifyPlanHash(plan) || plan.target.id !== TARGET_ID) {
    throw new Error(`PocketJS 3ds: invalid ${TARGET_ID} ResolvedBuildPlan at ${origin}`);
  }
  return plan;
}

async function loadBuildPlan(
  args: ThreeDsArguments,
): Promise<{ plan: ResolvedBuildPlan; planPath: string; manifestPath: string }> {
  if (args.planPath) {
    const plan = (await Bun.file(args.planPath).json()) as ResolvedBuildPlan;
    const checked = assert3dsPlan(plan, args.planPath);
    const entry = resolvePath(args.projectRoot, checked.app.entry);
    let directory = dirname(entry);
    let manifestPath = args.manifestPath ?? "";
    const boundary = resolvePath(args.projectRoot);
    while (!manifestPath) {
      const candidate = join(directory, "pocket.app.json");
      if (existsSync(candidate)) {
        manifestPath = candidate;
        break;
      }
      if (directory === boundary || dirname(directory) === directory) break;
      directory = dirname(directory);
    }
    if (!manifestPath) {
      throw new Error(
        `PocketJS 3ds: ${args.planPath} needs its source pocket.app.json between ${dirname(entry)} and ${boundary}; ` +
          "the runtime package carries the admitted manifest verbatim",
      );
    }
    const manifestPlan = resolve3dsBuildPlan(readPocketManifest(manifestPath).manifest);
    if (canonicalJson(manifestPlan) !== canonicalJson(checked)) {
      throw new Error(
        `PocketJS 3ds: ${args.planPath} has drifted from ${manifestPath}; regenerate the resolved plan before packaging`,
      );
    }
    return { plan: checked, planPath: args.planPath, manifestPath };
  }
  // An app is named relative to --project-root; a PocketJS demo
  // (vendor/pocketjs/apps/<app>) builds with --project-root=vendor/pocketjs.
  const candidates = [
    ...new Set([
      join(args.projectRoot, "apps", args.app, "pocket.app.json"),
      `${pocketjs}apps/${args.app}/pocket.app.json`,
    ]),
  ];
  const manifest = candidates.find((path) => existsSync(path));
  if (!manifest) {
    throw new Error(
      `PocketJS 3ds: no manifest for "${args.app}" (looked in ${candidates.join(", ")}). ` +
        "A 3DS app declares its own 400x240 native viewport; the stock " +
        "integer-fit demos cannot be admitted.",
    );
  }
  const plan = assert3dsPlan(
    resolve3dsBuildPlan(readPocketManifest(manifest).manifest),
    manifest,
  );
  const planPath = `${repository}.pocket/3ds/${plan.app.output}.plan.json`;
  mkdirSync(resolvePath(planPath, ".."), { recursive: true });
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return { plan, planPath, manifestPath: manifest };
}

// ---------------------------------------------------------------------------
// Native steps
// ---------------------------------------------------------------------------

/** The Rust archive's manifest. The crate is its own workspace (core/Cargo.toml). */
const CORE_MANIFEST = `${hostDirectory}core/Cargo.toml`;

/**
 * PocketJS's native step (tools/build/3ds/native.ts) checks the container
 * image and the pinned build-std nightly, runs `cargo rustc --locked --release
 * -p <package> --no-default-features --lib --crate-type staticlib` for
 * armv6k-nintendo-3ds with panic=abort and LTO, compiles QuickJS in the
 * container and returns the mounts. It runs Cargo from the PocketJS checkout
 * and selects a package of that workspace by name; `--manifest-path`, which
 * reaches Cargo through `cargoArgs`, makes Cargo resolve `-p` in
 * devices/3ds/core's own workspace and lockfile instead. This repository's
 * root is the first root, so one mount covers the product, the host services
 * and every output below it.
 */
export async function prepare3dsNative(options: {
  cargoArgs: readonly string[]; roots: readonly string[]; context?: RuntimeBuildContext;
}) {
  ensureThreeDsProfileHeader();
  const native = await prepareNative3ds({ ...options, packageName: "pocketjs-3ds-core",
    archiveName: "libpocketjs_3ds_core.a", targetDirectory: join(repository, ".pocket-build/native/3ds/product"),
    cargoArgs: ["--manifest-path", CORE_MANIFEST, ...options.cargoArgs],
    roots: [repository, ...options.roots] });
  return { ...native, coreLibrary: native.library };
}
export async function run3dsMake(
  environment: Readonly<Record<string, string>>, mounts: readonly Mount[],
  _notes: readonly string[] = [], selectedProfile: PocketProfile = softwareProfile,
  context?: RuntimeBuildContext,
): Promise<void> {
  await runNative3dsMake({ directory: hostDirectory, environment, mounts, profile: selectedProfile, context });
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export async function build3ds(argv: readonly string[], context?: RuntimeBuildContext): Promise<string> {
  const args = parse3dsArguments(argv);
  if (!args.app && !args.planPath) throw new Error(USAGE);
  if (!existsSync(hostDirectory)) {
    throw new Error(`PocketJS 3ds: the host is absent at ${hostDirectory}`);
  }

  if (args.pocketOnly && (args.capture || args.cia)) {
    throw new Error("PocketJS 3ds: --pocket-only cannot be combined with --capture or --cia");
  }
  if (context && !context.application) throw new Error("3DS native build requires an admitted package");
  const { plan, planPath, manifestPath } = context?.application ?? await loadBuildPlan(args);
  const inputs = extractHostBuildInputs(plan, { expectedTarget: TARGET_ID });
  const capture = args.capture
    ? captureDefines(process.env)
    : { input: "", touch: "", start: "", count: "" };

  // 1. guest bundle + pak
  console.log(`PocketJS 3ds: building app "${plan.app.output}" (${plan.app.framework})`);
  mkdirSync(args.outputDir, { recursive: true });
  if (!context && !args.skipBuild) {
    await $`bun tools/build.ts --plan=${planPath} --project-root=${args.projectRoot} --outdir=${args.outputDir}`
      .cwd(pocketjs);
  }
  const guestJavaScript = join(args.outputDir, `${inputs.appOutput}.js`);
  const guestPack = join(args.outputDir, `${inputs.appOutput}.pak`);
  for (const artifact of [guestJavaScript, guestPack]) {
    if (!existsSync(artifact)) {
      throw new Error(`PocketJS 3ds: the guest build did not produce ${artifact}`);
    }
  }

  // A 3DS application update is a normal target-thinned `.pocket`: admitted
  // manifest, resolved plan, compiled guest and target-flavoured pak. The same
  // artifact is embedded as the runtime's immutable recovery guest and written
  // beside the native binary for SD-card deployment.
  mkdirSync(args.packageDir, { recursive: true });
  const manifestBytes = new Uint8Array(readFileSync(manifestPath));
  const guestPackage = context ? new Uint8Array(readFileSync(context.application!.packagePath)) : encodePocketPackage({
    manifest: manifestBytes,
    variants: [
      makeVariant({
        target: TARGET_ID,
        hostAbi: plan.target.hostAbi,
        planJson: canonicalJson(plan),
        identity: {
          output: plan.app.output,
          id: plan.app.id,
          title: plan.app.title,
        },
        js: new Uint8Array(readFileSync(guestJavaScript)),
        workerJs: plan.domains?.worker ? new Uint8Array(readFileSync(join(args.outputDir, `${inputs.appOutput}.worker.js`))) : undefined,
        pak: new Uint8Array(readFileSync(guestPack)),
      }),
    ],
  });
  const pocketOutput = join(args.packageDir, `${inputs.appOutput}.pocket`);
  writeFileSync(pocketOutput, guestPackage);
  console.log(`output: ${pocketOutput} (${guestPackage.length} bytes, ${TARGET_ID} abi ${plan.target.hostAbi})`);
  const appRuntimeSlot = runtimeSlot(plan.app.id);
  console.log(
    `runtime: /pocketjs/runtime/apps/${appRuntimeSlot} (${plan.app.id})`,
  );
  if (args.pocketOnly) return pocketOutput;

  // 2-3. the Rust core staticlib (macOS) and QuickJS (container)
  const { imageId, coreLibrary, quickJsDirectory, mounts } = await prepare3dsNative({
    context,
    cargoArgs: args.cargoArgs,
    roots: [args.outputDir, args.packageDir, args.projectRoot, ...(args.extensionDir ? [args.extensionDir] : []), ...(args.extensionRomfs ? [args.extensionRomfs] : [])],
  });

  // 4. everything else that needs devkitARM
  const distributionRoot = `${repository}dist/3ds`;
  // C objects, romfs staging and SMDH metadata are cacheable only within one
  // resolved output. A shared directory can package app B with app A's older
  // romfs files when their mtimes happen to precede the staging targets.
  const buildDirectory = context ? join(context.outdir, "native") : join(distributionRoot, "build", inputs.appOutput);
  mkdirSync(buildDirectory, { recursive: true });
  writeFileSync(join(buildDirectory, "pocket_profile.h"), threeDsProfileHeader(context?.profile ?? softwareProfile));

  const makerom = args.cia
    ? await ensureMakerom(join(distributionRoot, "makerom"), imageId, mounts)
    : "";

  const extension = plan.features["system.extension"] ? args.extensionDir : undefined;
  if (plan.features["system.extension"] && !extension) {
    throw new Error("PocketJS 3ds: the plan declares system.extension; pass --extension=<dir>");
  }
  const output = join(args.packageDir, `${inputs.appOutput}.3dsx`);
  const ciaOutput = join(args.packageDir, `${inputs.appOutput}.cia`);
  const makeEnvironment: Record<string, string> = {
    ...hostBuildEnvironment(inputs, {
      outputDirectory: containerPathFor(args.outputDir, mounts),
      embedApp: true,
    }),
    POCKETJS_ROOT: containerPathFor(pocketjs, mounts),
    POCKETJS_PICA_INCLUDE: containerPathFor(join(pocketjs, "devices/3ds/pocket-3ds-pica/include"), mounts),
    POCKETJS_CORE_LIB: containerPathFor(coreLibrary, mounts),
    POCKETJS_QUICKJS_DIR: containerPathFor(quickJsDirectory, mounts),
    POCKETJS_APP_POCKET: containerPathFor(pocketOutput, mounts),
    POCKETJS_BUILD_DIR: containerPathFor(buildDirectory, mounts),
    POCKETJS_OUT_3DSX: containerPathFor(output, mounts),
    POCKETJS_OFFLOAD: plan.features["io.offload"] ? "1" : "",
    POCKETJS_MEDIA: plan.features["media.playback"] ? "1" : "",
    POCKETJS_EXTENSION: extension ? containerPathFor(extension, mounts) : "",
    POCKETJS_EXTENSION_ROMFS: extension && args.extensionRomfs ? containerPathFor(args.extensionRomfs, mounts) : "",
    POCKETJS_OFFLOAD_SLOT: createHash("sha256").update(plan.app.id).digest("hex").slice(0, 16),
    POCKETJS_SMDH_TITLE: plan.app.title,
    POCKETJS_SMDH_AUTHOR: plan.app.id,
    POCKETJS_SMDH_DESC: `PocketJS ${plan.app.title}`,
    POCKETJS_CAPTURE: args.capture ? "1" : "",
    // Explicit so a previous run's tape never lingers in the object cache.
    POCKETJS_CAPTURE_INPUT: capture.input,
    POCKETJS_CAPTURE_TOUCH: capture.touch,
    POCKETJS_CAP_START: capture.start,
    POCKETJS_CAP_N: capture.count,
    // The CIA goal is off unless POCKETJS_OUT_CIA names a file. Title, product
    // code and unique id are all derived from the resolved plan.
    POCKETJS_OUT_CIA: args.cia ? containerPathFor(ciaOutput, mounts) : "",
    POCKETJS_MAKEROM: args.cia ? containerPathFor(makerom, mounts) : "",
    POCKETJS_CIA_TITLE: ciaProcessName(plan.app.title, plan.app.id),
    POCKETJS_CIA_PRODUCT: ciaProductCode(plan.app.id),
    POCKETJS_CIA_UNIQUE_ID: ciaUniqueId(plan.app.id),
  };

  const notes = [args.capture ? "capture" : "", args.cia ? "cia" : ""].filter(Boolean);
  await run3dsMake(makeEnvironment, mounts, notes, context?.profile ?? softwareProfile, context);
  if (!existsSync(output)) {
    throw new Error(`PocketJS 3ds: the container build did not produce ${output}`);
  }
  console.log(`output: ${output}`);
  if (args.cia) {
    if (!existsSync(ciaOutput)) {
      throw new Error(`PocketJS 3ds: the container build did not produce ${ciaOutput}`);
    }
    console.log(
      `output: ${ciaOutput} (title id ${ciaTitleId(plan.app.id)}, install with \`azahar -i\`)`,
    );
  }
  return output;
}

if (import.meta.main) {
  try {
    await build3ds(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
