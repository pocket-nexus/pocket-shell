// SPDX-License-Identifier: GPL-3.0-or-later
// runtime/test/manifest-resolve.test.ts — the app contract's schema
// (runtime/spec/pocket-manifest.ts, runtime/manifest/validate.ts) and its
// resolution against a host contract into a build plan
// (runtime/manifest/resolve.ts): viewport policy, capabilities, auxiliary
// surfaces, the rate, and the checks on the registry a plan resolves against.
// From PocketJS tests/platform-contracts.test.ts; the cases on PocketJS's own
// host contracts, its demo apps and Pocket System manifests stay there.

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { POCKET_BINDING_GENERATION } from "../../vendor/pocketjs/contracts/spec/binding-generation.ts";
import {
  defineCapabilityRegistry,
  definePlatformContractRegistry,
  defineTargetRegistry,
  POCKET_CAPABILITIES,
  POCKET_PLATFORM_CONTRACTS,
  POCKET_TARGETS,
  type CapabilityId,
  type TargetId,
  type TargetProfile,
} from "../../vendor/pocketjs/contracts/spec/platforms.ts";
import { profileRegistry } from "../../vendor/pocketjs/tools/profile-resolver.ts";
import { POCKET_PROFILES } from "@pocketjs/framework/hosts";
import { readPocketManifest } from "../manifest/load.ts";
import {
  resolveBuildPlan,
  validateAndResolveBuildPlan,
  validatePlatformContractRegistry,
} from "../manifest/resolve.ts";
import { validatePocketManifest, validateSchema, type ContractDiagnostic } from "../manifest/validate.ts";
import { cadenceFor } from "../spec/admission.ts";
import {
  POCKET_MANIFEST_SCHEMA_ID,
  pocketManifestV2Schema,
  type PocketManifestV2,
} from "../spec/pocket-manifest.ts";

const fixtureUrl = (name: string) => new URL(`./fixtures/manifests/${name}.json`, import.meta.url);
const portableInput: unknown = await Bun.file(fixtureUrl("portable-psp")).json();
const invalidExtraInput: unknown = await Bun.file(fixtureUrl("invalid-extra-field")).json();
const touchInput: unknown = await Bun.file(fixtureUrl("requires-touch")).json();
/** The loaded manifest of a fixture, as `pocket-shell compile` reads one. */
const loadedFixture = (name: string) => readPocketManifest(fileURLToPath(fixtureUrl(name))).manifest;

function manifest(input: unknown): PocketManifestV2 {
  const result = validatePocketManifest(input);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

const SYNTHETIC_CAPABILITIES = defineCapabilityRegistry([...POCKET_CAPABILITIES] as const);

type SyntheticCapabilityId = CapabilityId<typeof SYNTHETIC_CAPABILITIES>;

const syntheticTargetDefinitions = {
  psp: POCKET_TARGETS.psp,
  "vita-test": {
    cadences: [60],
    hostAbi: POCKET_BINDING_GENERATION,
    platform: "vita",
    form: "takeover",
    display: {
      physicalViewport: [960, 544],
      logicalViewports: [[480, 272]],
      presentations: ["integer-fit"],
      rasterDensity: 2,
      animation: "composited",
    },
    capabilities: [
      "input.analog.left",
      "input.buttons",
      "input.touch",
      "text.glyphs.baked",
    ],
  },
  "dual-test": {
    cadences: [60],
    hostAbi: POCKET_BINDING_GENERATION,
    platform: "dual-test",
    form: "takeover",
    display: {
      physicalViewport: [400, 240],
      logicalViewports: [[400, 240]],
      presentations: ["native"],
      rasterDensity: 1,
      animation: "repaint",
      auxiliary: {
        physicalViewport: [320, 240],
        logicalViewports: [[320, 240]],
        presentations: ["native"],
        rasterDensity: 1,
      },
    },
    capabilities: [
      "input.buttons",
      "input.touch.auxiliary",
      "display.auxiliary",
      "text.glyphs.baked",
    ],
  },
} as const satisfies Readonly<Record<string, TargetProfile>>;

const SYNTHETIC_TARGETS = defineTargetRegistry<
  string,
  typeof syntheticTargetDefinitions
>(syntheticTargetDefinitions);

type SyntheticTargetId = TargetId<typeof SYNTHETIC_TARGETS>;
const SYNTHETIC_CONTRACTS = definePlatformContractRegistry(
  SYNTHETIC_CAPABILITIES,
  SYNTHETIC_TARGETS,
);

describe("pocket.app.json v2 schema", () => {
  test("uses the schema path deployed by pocketjs.dev", () => {
    expect(POCKET_MANIFEST_SCHEMA_ID).toBe("https://pocketjs.dev/schema/pocket-2.json");
  });

  test("accepts the portable PSP fixture", () => {
    expect(validatePocketManifest(portableInput).ok).toBe(true);
  });

  test("rejects unknown fields at their exact JSON Pointer", () => {
    const result = validatePocketManifest(invalidExtraInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual({
      code: "schema.additionalProperty",
      path: "/app/target",
      message: "unknown property",
    });
  });

  test("accepts only relative entries and string capability ids", () => {
    const bad = structuredClone(portableInput) as Record<string, any>;
    bad.app.entry = "../outside.tsx";
    bad.engine.capabilities.requires[0] = { id: "input.buttons", version: 1 };
    const result = validatePocketManifest(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((item) => [item.code, item.path])).toEqual(expect.arrayContaining([
      ["schema.pattern", "/app/entry"],
      ["schema.type", "/engine/capabilities/requires/0"],
    ]));
  });

  test("rejects packaging fields until a backend consumes them", () => {
    const bad = structuredClone(portableInput) as Record<string, any>;
    bad.packages = { psp: { title: "unused" } };
    const result = validatePocketManifest(bad);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual({
      code: "schema.additionalProperty",
      path: "/packages",
      message: "unknown property",
    });
  });

  test("identity carries author and icon; name and execution classes are not fields", () => {
    const authored = structuredClone(portableInput) as Record<string, any>;
    authored.author = "Pocket Nexus";
    authored.icon = "assets/icon.png";
    expect(validatePocketManifest(authored).ok).toBe(true);
    for (const [field, value] of [["name", "telemetry"], ["execution", { classes: ["guest"] }]] as const) {
      const removed = structuredClone(portableInput) as Record<string, any>;
      removed[field] = value;
      const result = validatePocketManifest(removed);
      expect(result.ok, field).toBe(false);
      if (!result.ok) expect(result.diagnostics).toContainEqual({ code: "schema.additionalProperty", path: `/${field}`, message: "unknown property" });
    }
    for (const icon of ["/abs/icon.png", "../icon.png", "icon.svg"]) {
      expect(validatePocketManifest({ ...authored, icon }).ok, icon).toBe(false);
    }
  });

  test("the published schema takes app.theme as a path; the loaded form carries content", () => {
    const withContent = structuredClone(portableInput) as Record<string, any>;
    withContent.app.theme = { keyframes: { fade: { from: { opacity: 0 }, to: { opacity: 1 } } } };
    const published: ContractDiagnostic[] = [];
    validateSchema(withContent, pocketManifestV2Schema, "", published);
    expect(published.map(item => item.path)).toEqual(["/app/theme"]);
    expect(validatePocketManifest(withContent).ok).toBe(true);
  });

  test("accepts a fixed auxiliary surface and rejects undeclared fields", () => {
    const dual = structuredClone(portableInput) as Record<string, any>;
    dual.app.surfaces = {
      auxiliary: { fixed: { logical: [320, 240], presentation: "native" } },
    };
    expect(validatePocketManifest(dual).ok).toBe(true);

    dual.app.surfaces.auxiliary.panel = "bottom";
    const result = validatePocketManifest(dual);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual({
      code: "schema.additionalProperty",
      path: "/app/surfaces/auxiliary/panel",
      message: "unknown property",
    });
  });
});

describe("the registry a plan resolves against", () => {
  test("profiles cannot select a legacy binding generation", () => {
    for (let hostAbi = 1; hostAbi < POCKET_BINDING_GENERATION; hostAbi++) {
      const registry = definePlatformContractRegistry(POCKET_CAPABILITIES, { psp: { ...POCKET_TARGETS.psp, hostAbi } });
      expect(validatePlatformContractRegistry(registry)).toContainEqual({
        code: "registry.bindingGeneration", path: "/targets/psp/hostAbi",
        message: `target must use binding generation ${POCKET_BINDING_GENERATION}`,
      });
    }
  });

  test("TargetId and capability registries extend without changing the resolver", () => {
    const ids: SyntheticTargetId[] = ["psp", "vita-test"];
    expect(ids).toEqual(["psp", "vita-test"]);
    expect(validatePlatformContractRegistry(SYNTHETIC_CONTRACTS)).toEqual([]);
  });

  test("rejects invalid target raster densities at the registry boundary", () => {
    const invalid = structuredClone(SYNTHETIC_CONTRACTS) as any;
    invalid.targets["vita-test"].display.rasterDensity = 1.5;
    expect(validatePlatformContractRegistry(invalid)).toContainEqual({
      code: "registry.invalidRasterDensity",
      path: "/targets/vita-test/display/rasterDensity",
      message: "target rasterDensity must be an integer from 1 through 255",
    });
  });

  test("reports a missing dynamic range instead of throwing during resolution", async () => {
    const invalid = structuredClone(POCKET_PLATFORM_CONTRACTS) as any;
    delete invalid.targets["macos-widget"].display.dynamicViewport;
    const note = loadedFixture("dynamic-note") as any;
    const result = validateAndResolveBuildPlan(note, { target: "macos-widget" }, invalid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual({
      code: "registry.dynamicViewportMissing",
      path: "/targets/macos-widget/display",
      message: "widget-form targets must declare display.dynamicViewport",
    });
  });

});

describe("semantic resolution", () => {
  test("the note resolves runtime glyphs and companions for browser and widget hosts", async () => {
    // Portable hosts never advertise OS text layout. Async text is explicit.
    const note = loadedFixture("dynamic-note") as any;
    const onApp = validateAndResolveBuildPlan(note, { target: "web-app" });
    expect(onApp.ok).toBe(true);
    if (!onApp.ok) return;
    expect(onApp.plan.features["text.layout.native"]).toBe(false);
    expect(onApp.plan.features["text.glyphs.runtime"]).toBe(true);
    expect(onApp.plan.target.hostAbi).toBe(POCKET_BINDING_GENERATION);

    const onWidget = validateAndResolveBuildPlan(note, { target: "macos-widget" });
    expect(onWidget.ok).toBe(true);
    if (!onWidget.ok) return;
    expect(onWidget.plan.features["text.layout.native"]).toBe(false);
    expect(onWidget.plan.features["text.glyphs.runtime"]).toBe(true);

    // The companion adapter is PLAN data now (issue #295): hosts build
    // their svc allowlist and adapter wiring from this list, never from
    // app-name conventions; the viewport policy rides along so hosts
    // derive size-locking from the plan too.
    expect(onApp.plan.companions).toEqual(["note"]);
    expect(onApp.plan.viewport.policy).toBe("dynamic");
    const hero = await Bun.file(fixtureUrl("fixed-and-dynamic-hero")).json();
    const heroOnApp = validateAndResolveBuildPlan(hero, { target: "web-app" });
    expect(heroOnApp.ok).toBe(true);
    if (!heroOnApp.ok) return;
    expect(heroOnApp.plan.companions).toEqual([]);
    expect(heroOnApp.plan.viewport.policy).toBe("dynamic");
    const heroOnPsp = validateAndResolveBuildPlan(hero, { target: "psp" });
    expect(heroOnPsp.ok).toBe(true);
    if (!heroOnPsp.ok) return;
    expect(heroOnPsp.plan.viewport.policy).toBe("fixed");
  });

  test("a fixed viewport takes the first listed or in-range size the target lists", () => {
    const withLogical = (logical: unknown) => {
      const input = structuredClone(portableInput) as Record<string, any>;
      input.app.viewport = { fixed: { logical, presentation: "integer-fit" } };
      return input;
    };
    const logical = (input: unknown, target: string) => {
      const result = validateAndResolveBuildPlan(input, { target });
      return result.ok ? result.plan.viewport.logical : result.diagnostics.map(item => item.code);
    };
    expect(logical(withLogical([[320, 240], [480, 272]]), "psp")).toEqual([480, 272]);
    expect(logical(withLogical({ min: [400, 200], max: [500, 300] }), "psp")).toEqual([480, 272]);
    expect(logical(withLogical([[320, 240]]), "psp")).toContain("viewport.logicalUnsupported");
    expect(logical(withLogical({ min: [100, 100], max: [200, 200] }), "psp")).toEqual(["viewport.logicalUnsupported"]);
    expect(validatePocketManifest(withLogical([])).ok).toBe(false);
  });

  test("one clear manifest resolves the four clear targets to their sizes", () => {
    const clear = loadedFixture("fixed-list-clear");
    const viewport = (target: keyof typeof POCKET_PROFILES) => {
      const result = validateAndResolveBuildPlan(clear, { target }, profileRegistry(POCKET_PROFILES[target]));
      if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
      return [result.plan.viewport.logical, result.plan.viewport.policy];
    };
    expect(viewport("ipodtouch4-dev")).toEqual([[320, 480], "fixed"]);
    expect(viewport("symbian-e7-dev")).toEqual([[360, 640], "dynamic"]);
  });

  test("resolves a small PSP build plan", () => {
    const result = validateAndResolveBuildPlan(portableInput, { target: "psp" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.target).toEqual({ id: "psp", hostAbi: POCKET_BINDING_GENERATION });
    expect(result.plan.app).toEqual({
      id: "dev.pocket-nexus.telemetry",
      title: "Pocket Telemetry",
      version: "0.1.0",
      entry: "app/main.tsx",
      output: "main",
      framework: "solid",
    });
    expect(result.plan.viewport).toEqual({
      logical: [480, 272],
      physical: [480, 272],
      presentation: "integer-fit",
      rasterDensity: 1,
      policy: "fixed",
    });
    expect(result.plan.features).toEqual({
      "input.analog.left": true,
      "input.buttons": true,
      "text.glyphs.baked": true,
    });
  });

  test("the application states its rate; the target must present it at a whole divisor", () => {
    const withRate = (tickHz?: number) => {
      const input = structuredClone(portableInput) as { app: Record<string, unknown> };
      if (tickHz !== undefined) input.app.tickHz = tickHz;
      return input;
    };
    const rate = (tickHz: number | undefined, target: string) => {
      const result = validateAndResolveBuildPlan(withRate(tickHz), { target });
      return result.ok ? result.plan.profile.tickHz : result.diagnostics.map(item => item.code);
    };
    expect(rate(undefined, "psp")).toBe(60);
    expect(rate(30, "psp")).toBe(30);
    expect(rate(20, "psp")).toBe(20);
    // Vita presents at 60 only; 30 is not a whole multiple of 60.
    expect(rate(30, "vita")).toEqual(["app.tickHz"]);
    // PocketBook presents at 30; the default 60 runs two core ticks per frame.
    expect(cadenceFor(60, POCKET_PROFILES.pocketbook.cadences)).toBe(30);
    for (const tickHz of [0, 61, 2.5]) {
      expect(validatePocketManifest(withRate(tickHz)).ok, String(tickHz)).toBe(false);
    }
  });

  test("desktop-widget capabilities are first-class: PSP admission refuses them", () => {
    // A widget-only app REQUIRES the desktop surface — a PSP plan must be
    // rejected at resolve time, not discovered broken at runtime.
    const widgetOnly = structuredClone(portableInput) as any;
    widgetOnly.engine.capabilities.requires = ["text.glyphs.baked", "input.text", "input.pointer"];
    const onPsp = validateAndResolveBuildPlan(widgetOnly, { target: "psp" });
    expect(onPsp.ok).toBe(false);
    if (onPsp.ok) return;
    const codes = onPsp.diagnostics.map((d) => d.code);
    expect(codes).toContain("capability.unavailable");
  });

  test("resolves the note's dynamic manifest and an explicit fixed variant", async () => {
    const manifest = loadedFixture("dynamic-note") as any;
    const result = validateAndResolveBuildPlan(manifest, { target: "macos-widget" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.target).toEqual({ id: "macos-widget", hostAbi: POCKET_BINDING_GENERATION });
    // Dynamic-viewport native presentation: density from the profile.
    expect(result.plan.viewport.rasterDensity).toBe(2);
    expect(result.plan.viewport.logical).toEqual([420, 560]);
    // requires are on; enhances resolve to available on this target.
    expect(result.plan.features["input.text"]).toBe(true);
    expect(result.plan.features["input.ime"]).toBe(true);
    expect(result.plan.features["host.clipboard"]).toBe(true);
    expect(result.plan.features["display.viewport.live"]).toBe(true);
    expect(result.plan.features["text.glyphs.runtime"]).toBe(true);

    // The source has a read-only fallback, but its current dynamic-only
    // manifest does not admit on PSP. Adding an explicit fixed variant makes
    // that fallback admissible; the desktop-only enhances then resolve off.
    const onPsp = validateAndResolveBuildPlan(
      { ...manifest, app: { ...manifest.app, viewport: { logical: [480, 272], presentation: "integer-fit" } } },
      { target: "psp" },
    );
    expect(onPsp.ok).toBe(true);
    if (!onPsp.ok) return;
    expect(onPsp.plan.features["input.text"]).toBe(false);
    expect(onPsp.plan.features["input.pointer"]).toBe(false);
  });

  test("dynamic viewport admits in-range sizes and rejects out-of-range", async () => {
    const manifest = loadedFixture("dynamic-note") as any;
    const tiny = structuredClone(manifest) as any;
    tiny.app.viewport.dynamic.default = [100, 100];
    const rejected = validateAndResolveBuildPlan(tiny, { target: "macos-widget" });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.diagnostics.map((d) => d.code)).toContain("viewport.logicalUnsupported");

    const roomy = structuredClone(manifest) as any;
    roomy.app.viewport.dynamic.default = [800, 600];
    expect(validateAndResolveBuildPlan(roomy, { target: "macos-widget" }).ok).toBe(true);
  });

  test("a System UI package resolves with the capabilities the target gives that role", async () => {
    const systemUI = await Bun.file(fixtureUrl("system-ui")).json();
    expect(
      validateAndResolveBuildPlan(systemUI, {
        target: "web-app",
        role: "systemUI",
      }).ok,
    ).toBe(true);
  });

  test("portable text admission requires its offload transport declaration", async () => {
    const manifest = await Bun.file(fixtureUrl("text-offload")).json();
    manifest.engine.capabilities.requires = manifest.engine.capabilities.requires.filter((cap: string) => cap !== "io.offload");
    for (const target of ["psp", "web-app"] as const) {
      expect(validateAndResolveBuildPlan(manifest, { target }).ok).toBe(false);
    }
  });

  test("viewport policy: legacy shorthand, dynamic-required, fixed-unhosted", async () => {
    // The bare {logical, presentation} spelling is shorthand for {fixed}.
    const legacy = structuredClone(portableInput) as any;
    legacy.app.viewport = { logical: [480, 272], presentation: "integer-fit" };
    expect(validateAndResolveBuildPlan(legacy, { target: "psp" }).ok).toBe(true);

    // A dynamic-only app is refused by fixed-screen forms…
    const note = loadedFixture("dynamic-note") as any;
    const onPsp = validateAndResolveBuildPlan(note, { target: "psp" });
    expect(onPsp.ok).toBe(false);
    if (onPsp.ok) return;
    expect(onPsp.diagnostics.map((d) => d.code)).toContain("viewport.fixedRequired");
  });

  test("widget form does not host fixed-viewport apps (acceptsFixed off)", () => {
    const fixedOnly = structuredClone(portableInput) as any;
    fixedOnly.engine.capabilities.requires = ["text.glyphs.baked", "input.buttons"];
    const result = validateAndResolveBuildPlan(fixedOnly, { target: "macos-widget" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((d) => d.code)).toContain("viewport.fixedUnhosted");
  });

  test("diagnostics point into an explicit fixed viewport variant", () => {
    const fixed = structuredClone(portableInput) as any;
    fixed.app.viewport = {
      fixed: { logical: [320, 240], presentation: "stretch" },
    };
    const result = validateAndResolveBuildPlan(fixed, { target: "psp" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(
      expect.arrayContaining([
        "/app/viewport/fixed/logical",
        "/app/viewport/fixed/presentation",
      ]),
    );
  });

  test("portable PSP baseline resolves to a native-density Vita plan", async () => {
    const result = validateAndResolveBuildPlan(portableInput, { target: "vita" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.target).toEqual({ id: "vita", hostAbi: POCKET_BINDING_GENERATION });
    expect(result.plan.viewport).toEqual({
      logical: [480, 272],
      physical: [960, 544],
      presentation: "integer-fit",
      rasterDensity: 2,
      policy: "fixed",
    });
    expect(result.plan.features).toEqual({
      "input.analog.left": true,
      "input.buttons": true,
      "text.glyphs.baked": true,
    });
  });

  test("feature resolution is independent of capability order and package identity", () => {
    const changed = structuredClone(portableInput) as Record<string, any>;
    changed.engine.capabilities.requires.reverse();
    changed.id = "dev.pocket-nexus.renamed";
    changed.title = "Renamed App";
    changed.version = "9.0.0";
    const left = validateAndResolveBuildPlan(portableInput, { target: "psp" });
    const right = validateAndResolveBuildPlan(changed, { target: "psp" });
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect(left.plan.features).toEqual(right.plan.features);
  });

  test("reports unknown targets and missing hard requirements", () => {
    const unknownTarget = validateAndResolveBuildPlan(portableInput, { target: "switch" });
    expect(unknownTarget.ok).toBe(false);
    if (!unknownTarget.ok) expect(unknownTarget.diagnostics[0]?.code).toBe("target.unknown");

    const needsTouch = structuredClone(portableInput) as Record<string, any>;
    needsTouch.engine.capabilities.requires.push("input.touch");
    const unavailable = resolveBuildPlan(manifest(needsTouch), { target: "psp" }, SYNTHETIC_CONTRACTS);
    expect(unavailable.ok).toBe(false);
    if (!unavailable.ok) {
      expect(unavailable.diagnostics.some((item) => item.code === "capability.unavailable")).toBe(true);
    }
  });

  test("rejects duplicate requires/enhances declarations", () => {
    const bad = structuredClone(portableInput) as Record<string, any>;
    bad.engine.capabilities.enhances = ["input.buttons"];
    const result = validateAndResolveBuildPlan(bad, { target: "psp" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.some((item) => item.code === "capability.duplicate")).toBe(true);
  });

  test("a PSP baseline resolves unchanged for a higher-resolution Vita host", () => {
    const result = resolveBuildPlan(manifest(portableInput), { target: "vita-test" }, SYNTHETIC_CONTRACTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.viewport).toEqual({
      logical: [480, 272],
      physical: [960, 544],
      presentation: "integer-fit",
      rasterDensity: 2,
      policy: "fixed",
    });
    expect(Object.values(result.plan.features).every(Boolean)).toBe(true);
  });

  test("enhancements record target availability without gating resolution", () => {
    const adaptive = structuredClone(portableInput) as Record<string, any>;
    adaptive.engine.capabilities.enhances = ["input.touch"];
    const parsed = manifest(adaptive);

    const psp = resolveBuildPlan(parsed, { target: "psp" }, SYNTHETIC_CONTRACTS);
    const vita = resolveBuildPlan(parsed, { target: "vita-test" }, SYNTHETIC_CONTRACTS);
    expect(psp.ok && vita.ok).toBe(true);
    if (!psp.ok || !vita.ok) return;
    expect(psp.plan.features["input.touch"]).toBe(false);
    expect(vita.plan.features["input.touch"]).toBe(true);
  });

  test("production Vita resolves the implemented touch contract", () => {
    const result = validateAndResolveBuildPlan(touchInput, { target: "vita" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.target.hostAbi).toBe(POCKET_BINDING_GENERATION);
    expect(result.plan.features["input.touch"]).toBe(true);
  });

  test("resolves auxiliary display and touch as separate capabilities", () => {
    const dual = structuredClone(portableInput) as Record<string, any>;
    dual.app.viewport.logical = [400, 240];
    dual.app.viewport.presentation = "native";
    dual.app.surfaces = {
      auxiliary: { fixed: { logical: [320, 240], presentation: "native" } },
    };
    dual.engine.capabilities.requires = [
      "input.buttons",
      "text.glyphs.baked",
      "display.auxiliary",
      "input.touch.auxiliary",
    ];

    const result = resolveBuildPlan(manifest(dual), { target: "dual-test" }, SYNTHETIC_CONTRACTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.surfaces).toEqual({
      auxiliary: {
        logical: [320, 240],
        physical: [320, 240],
        presentation: "native",
        rasterDensity: 1,
      },
    });
    expect(result.plan.features).toEqual({
      "display.auxiliary": true,
      "input.buttons": true,
      "input.touch.auxiliary": true,
      "text.glyphs.baked": true,
    });
    expect(result.plan.features).not.toHaveProperty("input.touch");
  });

  test("enforces auxiliary surface declarations, dependencies and geometry", () => {
    const base = structuredClone(portableInput) as Record<string, any>;
    base.app.viewport.logical = [400, 240];
    base.app.viewport.presentation = "native";

    const missingSurface = structuredClone(base);
    missingSurface.engine.capabilities.requires.push("display.auxiliary");
    const missingResult = resolveBuildPlan(
      manifest(missingSurface),
      { target: "dual-test" },
      SYNTHETIC_CONTRACTS,
    );
    expect(missingResult.ok).toBe(false);
    if (!missingResult.ok) {
      expect(missingResult.diagnostics.map((item) => item.code)).toContain(
        "surface.auxiliaryDeclarationMismatch",
      );
    }

    const touchWithoutDisplay = structuredClone(base);
    touchWithoutDisplay.engine.capabilities.requires.push("input.touch.auxiliary");
    const dependencyResult = resolveBuildPlan(
      manifest(touchWithoutDisplay),
      { target: "dual-test" },
      SYNTHETIC_CONTRACTS,
    );
    expect(dependencyResult.ok).toBe(false);
    if (!dependencyResult.ok) {
      expect(dependencyResult.diagnostics.map((item) => item.code)).toContain(
        "capability.dependency",
      );
    }

    const wrongGeometry = structuredClone(base);
    wrongGeometry.engine.capabilities.requires.push("display.auxiliary");
    wrongGeometry.app.surfaces = {
      auxiliary: { fixed: { logical: [400, 240], presentation: "native" } },
    };
    const geometryResult = resolveBuildPlan(
      manifest(wrongGeometry),
      { target: "dual-test" },
      SYNTHETIC_CONTRACTS,
    );
    expect(geometryResult.ok).toBe(false);
    if (!geometryResult.ok) {
      expect(geometryResult.diagnostics.map((item) => item.code)).toEqual(
        expect.arrayContaining(["surface.logicalUnsupported", "surface.nativeMismatch"]),
      );
    }
  });

  test("rejects target profiles whose auxiliary facts and capabilities drift", () => {
    const missingFacts = definePlatformContractRegistry(
      SYNTHETIC_CAPABILITIES,
      defineTargetRegistry({
        broken: {
          ...syntheticTargetDefinitions["dual-test"],
          display: {
            physicalViewport: [400, 240],
            logicalViewports: [[400, 240]],
            presentations: ["native"],
            rasterDensity: 1,
            animation: "repaint",
          },
        },
      }),
    );
    expect(validatePlatformContractRegistry(missingFacts).map((item) => item.code)).toContain(
      "registry.auxiliaryDisplayMismatch",
    );

    const touchWithoutDisplay = definePlatformContractRegistry(
      SYNTHETIC_CAPABILITIES,
      defineTargetRegistry({
        broken: {
          ...syntheticTargetDefinitions["vita-test"],
          capabilities: ["input.touch.auxiliary"],
        },
      }),
    );
    expect(validatePlatformContractRegistry(touchWithoutDisplay).map((item) => item.code)).toContain(
      "registry.auxiliaryTouchWithoutDisplay",
    );
  });
});
