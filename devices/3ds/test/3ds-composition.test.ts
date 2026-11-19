// SPDX-License-Identifier: GPL-3.0-or-later
// devices/3ds/test/3ds-composition.test.ts — the product archive
// (devices/3ds/core, libpocketjs_3ds_core.a) built for this machine and
// linked with the product's instance.c (fixtures/composition/instance.c
// includes it) and the `.pocket` reader (devices/services/pocket_container.c):
// the archive's inspection admits the variant the package source states and
// reads its surfaces, features and slot, the archive registers no output of
// its own, the package source and the product's op provider attach before
// boot, and a frame's buttons, analog lanes and auxiliary touch reach the
// guest exactly.
//
// This is the composition half of PocketJS tests/pica-driver.test.ts; the
// PICA driver's own half stays there. It also proves that the crate builds
// from its own manifest and lockfile, with the stable compiler PocketJS pins.

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { POCKET_BINDING_GENERATION } from "../../../vendor/pocketjs/contracts/spec/binding-generation.ts";
import { encodeIdentity, encodePocketPackage } from "../../../runtime/spec/pocket-package.ts";
import { hashPocketProfile } from "../../../vendor/pocketjs/framework/src/profile.ts";
import { STABLE_RUST_TOOLCHAIN } from "../../../vendor/pocketjs/tools/build/toolchains/rust.ts";
import { THREE_DS_PROFILE } from "../tools/profile.ts";

/** devices/3ds: the product's sources, headers and archive crate. */
const product = resolve(import.meta.dir, "..");
/** devices/services: launcher.h and link2.h, which instance.c includes. */
const services = resolve(import.meta.dir, "../../services");
/** PocketJS: the generated contracts, the native program header and the platform's hooks. */
const pocketjs = resolve(import.meta.dir, "../../../vendor/pocketjs");
const fixtures = join(import.meta.dir, "fixtures/composition");
/** Scratch below the repository's ignored .pocket-build. */
const validation = resolve(import.meta.dir, "../../../.pocket-build/validation/3ds-composition");
const runDir = join(validation, `${Date.now()}-${process.pid}`);
const cc = Bun.which(process.env.CC || "cc");

function run(args: string[], env = process.env): string {
  const result = Bun.spawnSync(args, { cwd: product, env, stdout: "pipe", stderr: "pipe" });
  const output = result.stdout.toString() + result.stderr.toString();
  writeFileSync(join(runDir, `${args[0]!.split("/").at(-1)}-${Date.now()}.log`), output);
  expect(result.success, `${args.join(" ")} (exit=${result.exitCode}, signal=${result.signalCode})\n${output}`).toBe(true);
  return output;
}

test.skipIf(!cc)("the product archive admits a package, attaches the product's providers and delivers exact input", () => {
  mkdirSync(runDir, { recursive: true });
  const target = join(validation, "cargo-target");
  const encoder = new TextEncoder();
  const packageBytes = encodePocketPackage({ manifest: new Uint8Array(), variants: [{ target: THREE_DS_PROFILE.id, hostAbi: POCKET_BINDING_GENERATION, profileHash: hashPocketProfile(THREE_DS_PROFILE), sections: [
    { kind: 1, bytes: encodeIdentity({ output: "fixture", id: "test.3ds", title: "3DS composition" }) },
    { kind: 2, bytes: encoder.encode('{"animation":"composited","app":{"id":"test.3ds"},"profile":{"tickHz":60},"viewport":{"logical":[400,240],"presentation":"native","rasterDensity":1},"surfaces":{"auxiliary":{"logical":[320,240],"rasterDensity":1}},"features":{"data.fs":true,"display.auxiliary":true}}') },
    { kind: 3, bytes: encoder.encode("test\0") },
  ] }] });
  const slot = createHash("sha256").update("test.3ds").digest("hex").slice(0, 16);
  writeFileSync(join(runDir, "package_fixture.h"), `static const uint8_t package_bytes[] = {${[...packageBytes].join(",")}};\n#define FIXTURE_SLOT "${slot}"\n`);
  // The product archive: pocket-archive, the 3DS package inspection and the
  // native program without built-in outputs or hooks, as the .3dsx links it.
  run(["cargo", `+${STABLE_RUST_TOOLCHAIN}`, "rustc", "--lib", "--crate-type", "staticlib", "--locked", "--manifest-path", join(product, "core/Cargo.toml"),
    "-p", "pocketjs-3ds-core", "--no-default-features", "--release", "--target-dir", target], { ...process.env, RUSTFLAGS: "-C panic=abort" });
  const instance = join(runDir, "instance");
  run([cc!, "-std=c11", "-Wall", "-Wextra", "-Werror", "-Wno-unused-variable", `-DPOCKETJS_HOST_ABI=${POCKET_BINDING_GENERATION}`,
    "-I", fixtures, "-I", join(product, "include"),
    "-I", join(pocketjs, "contracts/generated"), "-I", join(pocketjs, "programs/native/runtime/include"), "-I", join(pocketjs, "platforms/3ds"), "-I", services, "-I", runDir,
    join(fixtures, "instance.c"), join(services, "pocket_container.c"), join(pocketjs, "platforms/3ds/hooks.c"), join(pocketjs, "platforms/3ds/input_source.c"), join(target, "release/libpocketjs_3ds_core.a"), "-lm", "-o", instance]);
  expect(run([instance])).toContain("3DS runtime composition: package, auxiliary metadata, providers and exact input passed");
}, 300_000);
