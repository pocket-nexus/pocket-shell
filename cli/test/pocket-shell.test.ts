// SPDX-License-Identifier: GPL-3.0-or-later
// cli/test/pocket-shell.test.ts — the command line (cli/pocket-shell.ts) as a
// process: `check` and `compile` of the launcher for the 3DS host, what a
// refused app contract prints and returns, and a command forwarded to
// PocketJS's CLI with the same arguments, directory and exit code.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { THREE_DS_PROFILE, resolve3dsBuildPlan } from "../../devices/3ds/tools/profile.ts";
import { readPocketManifest } from "../../runtime/manifest/load.ts";
import { canonicalJson } from "../../runtime/manifest/plan.ts";
import { admissionHost, selectVariant } from "../../runtime/spec/admission.ts";
import { decodeIdentity, decodePocketPackage, findSection, POCKET_SECTION } from "../../runtime/spec/pocket-package.ts";
import { hashPocketProfile } from "@pocketjs/framework/profile";

const ROOT = resolve(import.meta.dir, "../..");
const CLI = resolve(ROOT, "cli/pocket-shell.ts");
const POCKETJS_CLI = resolve(ROOT, "vendor/pocketjs/tools/pocket.ts");
const LAUNCHER = resolve(ROOT, "shells/3ds/shell/pocket.app.json");
const LAUNCHER_ROOT = resolve(ROOT, "shells/3ds");
const HOST_CONFIG_3DS = resolve(ROOT, "devices/3ds/pocket.host.config.ts");
const HOST_CONTRACT_3DS = resolve(ROOT, "devices/3ds/pocket.host.json");

const TMP = realpathSync(mkdtempSync(join(tmpdir(), "pocket-shell-cli-")));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

// Bun colors console.error under FORCE_COLOR; the assertions read plain text.
const { FORCE_COLOR: _forceColor, ...ENV } = process.env;

function run(script: string, args: string[], cwd = ROOT): { code: number; stdout: string; stderr: string } {
  const child = Bun.spawnSync([process.execPath, script, ...args], { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { code: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}
const cli = (args: string[], cwd?: string) => run(CLI, args, cwd);

/** An app contract in its own directory, with the entry it names. */
function project(name: string, manifest: Record<string, unknown>): string {
  const directory = join(TMP, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "pocket.app.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(directory, "main.tsx"), "export {};\n");
  return join(directory, "pocket.app.json");
}

const contract = (requires: string[], app: Record<string, unknown> = {}) => ({
  $schema: "https://pocketjs.dev/schema/pocket-2.json",
  pocket: 2,
  id: "dev.pocket-nexus.cli-test",
  title: "CLI test",
  version: "0.1.0",
  engine: { capabilities: { requires } },
  app: { entry: "main.tsx", framework: "solid", viewport: { fixed: { logical: [400, 240], presentation: "native" } }, ...app },
});

describe("check and compile", () => {
  const plan = resolve3dsBuildPlan(readPocketManifest(LAUNCHER).manifest);

  test("check resolves the launcher against the 3DS host config and type-checks it", () => {
    const result = cli(["check", "--manifest", LAUNCHER, "--project-root", LAUNCHER_ROOT, "--host-config", HOST_CONFIG_3DS]);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain("✓ pocket.app.json v2\n✓ 3ds-dev satisfies pocket.app.json capabilities\n✓ TypeScript (");
    // The plan is the one the 3DS scripts resolve (shells/3ds/scripts/apps.ts).
    expect(result.stdout).toContain(`✓ ResolvedBuildPlan ${plan.planHash}\n`);
    expect(result.stdout).not.toContain("Package:");
  }, 120_000);

  test("compile writes the plan, the depfile and a package the 3DS host admits", () => {
    const out = join(TMP, "compile");
    const output = join(out, "launcher.pocket");
    const result = cli([
      "compile", "--manifest", LAUNCHER, "--project-root", LAUNCHER_ROOT, "--target", HOST_CONTRACT_3DS,
      "--outdir", join(out, "build"), "--plan-dir", join(out, "plans"), "--output", output, "--depfile", join(out, "launcher.d"),
    ]);
    // The compiler's warnings go to standard error; only the exit code decides.
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`✓ Package: ${output}\n`);
    expect(JSON.parse(readFileSync(join(out, "plans/3ds-dev/plan.json"), "utf8"))).toEqual(plan);

    const bytes = new Uint8Array(readFileSync(output));
    const pkg = decodePocketPackage(bytes);
    // No theme module: the package embeds the app contract as written.
    expect(Buffer.from(pkg.manifest).equals(readFileSync(LAUNCHER))).toBe(true);
    expect(pkg.variants.map(variant => [variant.target, variant.hostAbi, variant.profileHash])).toEqual([["3ds-dev", plan.target.hostAbi, plan.profileHash]]);
    const variant = pkg.variants[0]!;
    expect(variant.sections.map(section => section.kind)).toEqual([POCKET_SECTION.identity, POCKET_SECTION.plan, POCKET_SECTION.js, POCKET_SECTION.pak]);
    expect(decodeIdentity(findSection(variant, POCKET_SECTION.identity)!)).toEqual({ output: "pocket-shell", id: "dev.pocket-nexus.shell", title: "Pocket" });
    expect(new TextDecoder().decode(findSection(variant, POCKET_SECTION.plan)!)).toBe(canonicalJson(plan));
    // The sections are the compiler's files; the JavaScript gains its NUL.
    const js = findSection(variant, POCKET_SECTION.js)!;
    expect(Buffer.from(js.subarray(0, js.length - 1)).equals(readFileSync(join(out, "build/pocket-shell.js")))).toBe(true);
    expect(js[js.length - 1]).toBe(0);
    expect(Buffer.from(findSection(variant, POCKET_SECTION.pak)!).equals(readFileSync(join(out, "build/pocket-shell.pak")))).toBe(true);
    const admission = selectVariant(pkg, admissionHost(THREE_DS_PROFILE, hashPocketProfile(THREE_DS_PROFILE)));
    expect(admission.ok && admission.timing).toEqual({ tickHz: 60, cadenceHz: 60 });

    // The depfile names the package and what it was made from: the app
    // contract, the host contract, the entry, this CLI, the resolver and the
    // compiler.
    const depfile = readFileSync(join(out, "launcher.d"), "utf8");
    expect(depfile.startsWith(`${output}: `)).toBe(true);
    for (const input of [
      LAUNCHER, HOST_CONTRACT_3DS, resolve(LAUNCHER_ROOT, "shell/main.tsx"), CLI,
      resolve(ROOT, "runtime/manifest/resolve.ts"), resolve(ROOT, "runtime/spec/pocket-package.ts"),
      resolve(ROOT, "vendor/pocketjs/tools/build.ts"),
    ]) expect([input, depfile.includes(` ${input} \\\n`) || depfile.endsWith(` ${input}\n`)]).toEqual([input, true]);
  }, 180_000);
});

describe("a refused app contract", () => {
  test("a capability the host lacks is reported by code and JSON pointer, with exit code 1", () => {
    const manifest = project("needs-pointer", contract(["text.glyphs.baked", "input.pointer"]));
    const result = cli(["check", "--manifest", manifest, "--target", HOST_CONTRACT_3DS]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("pocket-shell: capability.unavailable /engine/capabilities/requires/1: target 3ds-dev does not provide input.pointer\n");
  });

  test("every resolver diagnostic is printed, one per line, and compile writes nothing", () => {
    const manifest = project("two-faults", contract(["text.glyphs.baked", "input.pointer"], { viewport: { fixed: { logical: [480, 272], presentation: "native" } } }));
    const out = join(TMP, "two-faults-out");
    const result = cli(["compile", "--manifest", manifest, "--target", HOST_CONTRACT_3DS, "--outdir", out, "--plan-dir", join(out, "plans")]);
    expect(result.code).toBe(1);
    expect(result.stderr.split("\n").filter(Boolean).map(line => line.replace(/^pocket-shell: /, "").split(":")[0])).toEqual([
      "viewport.logicalUnsupported /app/viewport/fixed/logical",
      "viewport.nativeMismatch /app/viewport/fixed",
      "capability.unavailable /engine/capabilities/requires/1",
    ]);
    expect(existsSync(out)).toBe(false);
  });

  test("a property outside the schema is refused before resolution", () => {
    const fixture = resolve(ROOT, "runtime/test/fixtures/manifests/invalid-extra-field.json");
    const result = cli(["check", "--manifest", fixture, "--target", HOST_CONTRACT_3DS]);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(`pocket-shell: ${fixture}: schema.additionalProperty /app/target: unknown property\n`);
  });

  test("a missing manifest, an unknown option and --aot are usage errors", () => {
    const missing = cli(["check", "--manifest", join(TMP, "absent.json"), "--target", HOST_CONTRACT_3DS]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toStartWith(`pocket-shell: manifest not found: ${join(TMP, "absent.json")}\nusage: pocket-shell check|compile`);
    const unknown = cli(["check", "--manifest", LAUNCHER, "--all"]);
    expect([unknown.code, unknown.stderr.split("\n")[0]]).toEqual([1, "pocket-shell: unknown option --all"]);
    // AOT sources are PocketJS's to compile; the error names its CLI.
    const aot = cli(["compile", "--manifest", LAUNCHER, "--aot", "--out", join(TMP, "aot")]);
    expect(aot.code).toBe(1);
    expect(aot.stderr.split("\n")[0]).toContain("bun vendor/pocketjs/tools/pocket.ts compile --aot --out DIR");
    expect(existsSync(join(TMP, "aot"))).toBe(false);
  });
});

describe("commands PocketJS owns", () => {
  test("host export runs in PocketJS's CLI with the caller's directory and arguments", () => {
    // What the Tab5 firmware's CMake helpers run through devices/m5stack/tools/pocket.
    const config = resolve(ROOT, "devices/m5stack/programs/m5stack-tab5/pocket.host.config.ts");
    const args = (out: string) => ["host", "export", "--config", config, "--out", out, "--depfile", `${out}/pocket-profile.d`];
    const cwd = join(TMP, "export");
    mkdirSync(cwd, { recursive: true });
    const forwarded = cli(args("forwarded"), cwd);
    const direct = run(POCKETJS_CLI, args("direct"), cwd);
    expect([forwarded.code, forwarded.stderr]).toEqual([direct.code, direct.stderr]);
    expect(forwarded.code).toBe(0);
    expect(forwarded.stdout).toBe(direct.stdout.replaceAll(join(cwd, "direct"), join(cwd, "forwarded")));
    for (const file of ["pocket_profile.h", "pocket_profile.rs", "pocket.host.json"]) {
      expect([file, readFileSync(join(cwd, "forwarded", file), "utf8")]).toEqual([file, readFileSync(join(cwd, "direct", file), "utf8")]);
    }
    expect(existsSync(join(cwd, "forwarded/pocket-profile.d"))).toBe(true);
  }, 60_000);

  test("a forwarded command's output and exit code are PocketJS's", () => {
    const forwarded = cli(["catalog", "--json"]);
    const direct = run(POCKETJS_CLI, ["catalog", "--json"]);
    expect(forwarded).toEqual(direct);
    expect(JSON.parse(forwarded.stdout).map((row: { id: string }) => row.id)).toContain("3ds-runtime");
    // `host` without export or fetch is PocketJS's usage error.
    const failed = cli(["host"]);
    expect(failed).toEqual(run(POCKETJS_CLI, ["host"]));
    expect([failed.code, failed.stderr.includes("PocketJS: expected host export or host fetch")]).toEqual([1, true]);
  }, 60_000);

  test("no command prints this CLI's usage", () => {
    const none = cli([]);
    expect([none.code, none.stderr.startsWith("usage: pocket-shell check|compile")]).toEqual([1, true]);
    const help = cli(["--help"]);
    expect([help.code, help.stderr.includes("any other command runs PocketJS's CLI")]).toEqual([0, true]);
  });
});
