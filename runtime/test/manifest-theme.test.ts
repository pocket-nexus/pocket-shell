// SPDX-License-Identifier: GPL-3.0-or-later
// The app contract's theme and icon (runtime/manifest/load.ts): a theme
// module is loaded before resolution, the plan and the native build inputs
// carry its content, PocketJS's compiler bakes the plan's copy, and the
// committed JSON schema is the schema object of runtime/spec/pocket-manifest.ts.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeStyleTable } from "../../vendor/pocketjs/contracts/spec/spec.ts";
import { KEY_STYLES, unpack } from "../../vendor/pocketjs/framework/compiler/pak.ts";
import { encodePNG } from "../../vendor/pocketjs/tools/png.ts";
import { extractHostBuildInputs } from "../manifest/host-build-inputs.ts";
import { readAuthoredManifest, readPocketManifest } from "../manifest/load.ts";
import { validateAndResolveBuildPlan } from "../manifest/resolve.ts";
import { validatePocketManifest } from "../manifest/validate.ts";
import { pocketManifestV2Schema } from "../spec/pocket-manifest.ts";

const ROOT = resolve(import.meta.dir, "../..");
/** PocketJS's compiler: a resolved plan in, a bundle and an asset pack out. */
const COMPILER = resolve(ROOT, "vendor/pocketjs/tools/build.ts");
const PORTABLE = resolve(import.meta.dir, "fixtures/manifests/portable-psp.json");
/** This run's scratch, ignored by Git and removed afterwards. */
const SCRATCH = resolve(ROOT, ".pocket-build/validation/manifest-theme", String(process.pid));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const baseline = JSON.parse(readFileSync(PORTABLE, "utf8"));
const theme = {
  keyframes: { glide: { from: { translateX: 0 }, to: { translateX: 12 } } },
  animation: { glide: { value: "glide 2s linear both", loop: "3s" } },
};
const application = { ...baseline, app: { ...baseline.app, entry: "main.tsx", theme } };

test("manifest theme enters the resolved plan and native build inputs", () => {
  const result = validateAndResolveBuildPlan(application, { target: "psp" });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.plan.app.theme).toEqual(theme);
  expect(extractHostBuildInputs(result.plan).app.theme).toEqual(theme);
  for (const invalid of [
    { keyframes: { glide: { from: { opacity: true } } } },
    { animation: { glide: { loop: 2 } } },
    { animation: { glide: { value: "glide 2s", platform: "psp" } } },
  ]) {
    expect(validatePocketManifest({ ...application, app: { ...application.app, theme: invalid } }).ok).toBe(false);
  }
});

test("the compiler bakes the frozen plan theme after the source manifest changes", () => {
  const directory = resolve(SCRATCH, "compiler");
  mkdirSync(directory, { recursive: true });
  const result = validateAndResolveBuildPlan(application, { target: "psp" });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  writeFileSync(resolve(directory, "plan.json"), JSON.stringify(result.plan));
  writeFileSync(resolve(directory, "pocket.app.json"), JSON.stringify({ ...application, app: { ...application.app, theme: {} } }));
  writeFileSync(resolve(directory, "main.tsx"), [
    'import { mount } from "@pocketjs/framework/solid";',
    'import { View } from "@pocketjs/framework/solid/components";',
    'mount(() => <View class="animate-glide" />);',
  ].join("\n"));
  const run = Bun.spawnSync([
    process.execPath, COMPILER, `--plan=${directory}/plan.json`, `--project-root=${directory}`, `--outdir=${directory}/out`,
    "--strict-classes",
  ], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  expect(run.success, run.stderr.toString()).toBe(true);
  const styles = unpack(readFileSync(resolve(directory, "out", result.plan.app.output + ".pak")))
    .find(item => item.key === KEY_STYLES)!;
  const decoded = decodeStyleTable(styles.data);
  expect(decoded.anims).toHaveLength(1);
  expect(decoded.anims[0]!.periodFrames).toBe(120);
  expect(decoded.styles.some(record => record.animation?.loopFrames === 180)).toBe(true);
});

test("the committed JSON schema is the manifest schema", () => {
  expect(JSON.parse(readFileSync(resolve(ROOT, "runtime/schema/pocket-2.json"), "utf8"))).toEqual(pocketManifestV2Schema);
});

test("app.theme names a module whose export resolves like inline content", () => {
  const directory = resolve(SCRATCH, "module");
  mkdirSync(resolve(directory, "motion"), { recursive: true });
  writeFileSync(resolve(directory, "motion/ease.ts"), 'export const LINEAR = "linear";\nexport const LOOP = "3s";\n');
  writeFileSync(resolve(directory, "theme.ts"), [
    'import { LINEAR, LOOP } from "./motion/ease.ts";',
    "const stops = (property: string, values: number[]) => Object.fromEntries(values.map((value, index) => [index === 0 ? \"from\" : \"to\", { [property]: value }]));",
    "export default { keyframes: { glide: stops(\"translateX\", [0, 12]) }, animation: { glide: { value: `glide 2s ${LINEAR} both`, loop: LOOP } } };",
  ].join("\n"));
  const reference = { ...application, app: { ...application.app, theme: "./theme.ts" } };
  writeFileSync(resolve(directory, "pocket.app.json"), JSON.stringify(reference, null, 2) + "\n");
  // The document is valid with the reference; the resolver takes content only.
  expect(validatePocketManifest(reference).ok).toBe(true);
  const unresolved = validateAndResolveBuildPlan(reference, { target: "psp" });
  expect(unresolved.ok).toBe(false);
  if (!unresolved.ok) expect(unresolved.diagnostics.map(item => item.code)).toContain("app.themeUnresolved");

  const loaded = readPocketManifest(resolve(directory, "pocket.app.json"));
  expect((loaded.manifest as typeof application).app.theme).toEqual(theme);
  expect(loaded.inputs).toEqual([resolve(directory, "pocket.app.json"), resolve(directory, "theme.ts"), resolve(directory, "motion/ease.ts")]);
  const inline = validateAndResolveBuildPlan(application, { target: "psp" });
  const fromModule = validateAndResolveBuildPlan(loaded.manifest, { target: "psp" });
  if (!inline.ok || !fromModule.ok) throw new Error("plans did not resolve");
  expect(fromModule.plan.planHash).toBe(inline.plan.planHash);
  // A package embeds the loaded manifest, so admission re-resolves the same plan without the module.
  const embedded = JSON.parse(new TextDecoder().decode(loaded.embedded));
  expect(embedded.app.theme).toEqual(theme);
  const fromPackage = validateAndResolveBuildPlan(embedded, { target: "psp" });
  if (!fromPackage.ok) throw new Error("embedded manifest did not resolve");
  expect(fromPackage.plan.planHash).toBe(inline.plan.planHash);
  // Content stays byte-for-byte as written.
  const inlineLoad = readPocketManifest(PORTABLE);
  expect(inlineLoad.embedded).toEqual(new Uint8Array(readFileSync(PORTABLE)));
  expect(inlineLoad.inputs).toEqual([PORTABLE]);
});

test("a theme module that is missing or exports the wrong shape is refused by path", () => {
  const directory = resolve(SCRATCH, "invalid");
  mkdirSync(directory, { recursive: true });
  const write = (theme: string) => {
    writeFileSync(resolve(directory, "pocket.app.json"), JSON.stringify({ ...application, app: { ...application.app, theme } }));
    return resolve(directory, "pocket.app.json");
  };
  expect(() => readPocketManifest(write("./absent.ts"))).toThrow(/absent\.ts, which is not a file/);
  writeFileSync(resolve(directory, "wrong.ts"), "export default { animation: { glide: { loop: 2 } } };\n");
  expect(() => readPocketManifest(write("./wrong.ts"))).toThrow(/wrong\.ts: \/app\/theme/);
  writeFileSync(resolve(directory, "named.ts"), "export const theme = {};\n");
  expect(() => readPocketManifest(write("./named.ts"))).toThrow(/named\.ts has no default export/);
  writeFileSync(resolve(directory, "theme.json"), JSON.stringify(theme));
  expect((readPocketManifest(write("./theme.json")).manifest as typeof application).app.theme).toEqual(theme);
});

test("an authored manifest names its theme and icon by path", () => {
  const directory = resolve(SCRATCH, "authored");
  mkdirSync(directory, { recursive: true });
  const write = (manifest: unknown) => {
    writeFileSync(resolve(directory, "pocket.app.json"), JSON.stringify(manifest));
    return resolve(directory, "pocket.app.json");
  };
  // Inline content is the loaded form; an authored file names a module.
  expect(() => readAuthoredManifest(write(application))).toThrow("/app/theme");
  writeFileSync(resolve(directory, "theme.json"), JSON.stringify(theme));
  const square = new Uint8Array(encodePNG(new Uint8Array(4 * 4 * 4), 4, 4));
  writeFileSync(resolve(directory, "icon.png"), square);
  const loaded = readAuthoredManifest(write({ ...application, icon: "icon.png", app: { ...application.app, theme: "./theme.json" } }));
  expect((loaded.manifest as typeof application).app.theme).toEqual(theme);
  expect(loaded.icon).toEqual(square);
  expect(loaded.inputs).toContain(resolve(directory, "icon.png"));
  writeFileSync(resolve(directory, "wide.png"), encodePNG(new Uint8Array(4 * 2 * 4), 4, 2));
  expect(() => readAuthoredManifest(write({ ...application, icon: "wide.png", app: { ...application.app, theme: "./theme.json" } }))).toThrow("square PNG");
});
