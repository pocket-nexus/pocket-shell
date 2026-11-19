// SPDX-License-Identifier: GPL-3.0-or-later
// devices/psp/test/host.test.ts — the PSP program's Pocket Link and media
// code (../program/src: bindings.rs, link_record.rs, media_wire.rs) in
// ../host-test, built for this machine as PocketJS's
// tools/test-psp-runtime.ts builds tests/fixtures/psp-runtime: the program's
// profile (../pocket-shell-psp.host.json) is exported, the pinned QuickJS
// headers the PSP library builds against are found through Cargo's
// metadata, and `cargo test` runs with the stable compiler PocketJS pins.

import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { POCKET_BINDING_GENERATION } from "../../../vendor/pocketjs/contracts/spec/binding-generation.ts";
import { hashPocketProfile } from "../../../vendor/pocketjs/framework/src/profile.ts";
import { STABLE_RUST_TOOLCHAIN } from "../../../vendor/pocketjs/tools/build/toolchains/rust.ts";
import { exportProfile } from "../../../vendor/pocketjs/tools/profile-export.ts";
import { loadProfileDocument } from "../../../vendor/pocketjs/tools/profile-resolver.ts";

const DEVICE = resolve(import.meta.dir, "..");
const VENDOR = resolve(DEVICE, "../../vendor/pocketjs");
const HOST_TEST = join(DEVICE, "host-test");
/** Scratch below the repository's ignored .pocket-build. */
const VALIDATION = resolve(DEVICE, "../../.pocket-build/validation/psp-host-test");
const cargo = Bun.which("cargo");

test.skipIf(!cargo)("the program's link and media code passes its host tests", () => {
  mkdirSync(VALIDATION, { recursive: true });
  const profile = loadProfileDocument(join(DEVICE, "pocket-shell-psp.host.json"));
  const exported = exportProfile({ profile, profileHash: hashPocketProfile(profile), hostAbi: POCKET_BINDING_GENERATION, dependencies: [] }, join(VALIDATION, "profile"));
  const metadata = Bun.spawnSync([cargo!, `+${STABLE_RUST_TOOLCHAIN}`, "metadata", "--format-version=1", "--manifest-path", join(VENDOR, "programs/psp/Cargo.toml")], { stdout: "pipe", stderr: "pipe" });
  expect(metadata.success, metadata.stderr.toString()).toBe(true);
  const packages = JSON.parse(metadata.stdout.toString()).packages as { name: string; manifest_path: string; source: string | null; dependencies: { name: string; source: string | null }[] }[];
  const source = packages.find((p) => p.name === "pocketjs-psp")?.dependencies.find((p) => p.name === "libquickjs-sys")?.source;
  const quickjs = source ? packages.find((p) => p.name === "libquickjs-sys" && p.source?.startsWith(`${source}#`)) : undefined;
  expect(quickjs, "the PSP library's pinned QuickJS source").toBeDefined();
  const result = Bun.spawnSync([cargo!, `+${STABLE_RUST_TOOLCHAIN}`, "test", "--locked", "--manifest-path", join(HOST_TEST, "Cargo.toml"), "--", "--test-threads=1"], {
    env: { ...process.env, POCKETJS_PROFILE_RS: exported.module, POCKET_QJS_SOURCE: join(dirname(quickjs!.manifest_path), "embed/quickjs"), CARGO_TARGET_DIR: join(HOST_TEST, "target") },
    stdout: "pipe", stderr: "pipe",
  });
  const output = result.stdout.toString() + result.stderr.toString();
  writeFileSync(join(VALIDATION, `cargo-test-${Date.now()}.log`), output);
  expect(result.success, output).toBe(true);
  expect(output).toContain("test result: ok. 6 passed");
}, 600_000);
