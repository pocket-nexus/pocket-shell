// SPDX-License-Identifier: GPL-3.0-or-later
// runtime/test/applet.test.ts — the Pocket Applet rules (runtime/spec/applet.ts,
// runtime/package/applet-check.ts): the manifest rules at plan resolution, the
// source rules over an applet's import graph, the bundle budgets, and one
// applet checked from its files (test/fixtures/applets/feed). The applets the
// launcher installs are pocket-nexus/applets, which checks each of them.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve3dsBuildPlan } from "../../devices/3ds/tools/profile.ts";
import { readPocketManifest } from "../manifest/load.ts";
import { validateAndResolveBuildPlan } from "../manifest/resolve.ts";
import { validatePocketManifest } from "../manifest/validate.ts";
import { checkApplet, checkAppletBundle, checkAppletSources } from "../package/applet-check.ts";
import { APPLET_BUDGET, appletManifestDiagnostics, type AppletDeclaration } from "../spec/applet.ts";
import type { PocketManifestV2 } from "../spec/pocket-manifest.ts";

/** The fixture applet's project root, laid out as pocket-nexus/applets is:
 *  an applet's directory (feed/) beside a directory its modules share (lib/). */
const FIXTURES = new URL("./fixtures/applets/", import.meta.url).pathname;
const TMP = mkdtempSync(join(tmpdir(), "pocket-applet-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function manifest(overrides: Record<string, unknown> = {}, capabilities?: { requires?: string[]; enhances?: string[] }): PocketManifestV2 {
  return {
    $schema: "https://pocketjs.dev/schema/pocket-2.json",
    pocket: 2,
    id: "dev.example.notes",
    title: "Notes",
    version: "0.1.0",
    applet: { version: 1 },
    engine: {
      capabilities: {
        requires: capabilities?.requires ?? ["text.glyphs.baked", "input.buttons", "display.auxiliary", "input.touch.auxiliary"],
        enhances: capabilities?.enhances ?? ["system.agent"],
      },
    },
    app: {
      entry: "notes/main.tsx",
      output: "notes-main",
      framework: "solid",
      surfaces: { auxiliary: { fixed: { logical: [320, 240], presentation: "native" } } },
      viewport: { fixed: { logical: [400, 240], presentation: "native" } },
    },
    ...overrides,
  } as PocketManifestV2;
}

const codes = (m: PocketManifestV2) => appletManifestDiagnostics(m).map((d) => d.code);

describe("manifest rules", () => {
  test("a minimal applet passes, and an app without the section is not checked", () => {
    expect(codes(manifest())).toEqual([]);
    const app = manifest({ applet: undefined }, { requires: ["input.buttons"], enhances: ["system.wifi"] });
    expect(codes(app)).toEqual([]);
  });

  test("the schema refuses an unknown key and a version other than 1", () => {
    expect(validatePocketManifest(manifest({ applet: { version: 1, cookies: true } })).ok).toBe(false);
    expect(validatePocketManifest(manifest({ applet: { version: 2 } })).ok).toBe(false);
    expect(validatePocketManifest(manifest({ applet: { version: 1, hosts: ["api.example.com"] } })).ok).toBe(true);
    expect(validatePocketManifest(manifest({ applet: { version: 1, hosts: ["http://api.example.com"] } })).ok).toBe(false);
    expect(validatePocketManifest(manifest({ applet: { version: 1, hosts: ["localhost"] } })).ok).toBe(false);
    expect(validatePocketManifest(manifest({ applet: { version: 1, services: ["glyphs"] } })).ok).toBe(true);
    expect(validatePocketManifest(manifest({ applet: { version: 1, summary: "The front page and its threads." } })).ok).toBe(true);
    expect(validatePocketManifest(manifest({ applet: { version: 1, summary: "" } })).ok).toBe(false);
    expect(validatePocketManifest(manifest({ applet: { version: 1, summary: "x".repeat(121) } })).ok).toBe(false);
  });

  test("system capabilities, a missing agent, a long title and a wrong surface are refused", () => {
    expect(codes(manifest({}, { enhances: ["system.agent", "system.wifi"] }))).toContain("applet.capability");
    expect(codes(manifest({}, { enhances: ["link.companion", "system.agent"] }))).toContain("applet.capability");
    expect(codes(manifest({}, { enhances: [] }))).toContain("applet.agent");
    expect(codes(manifest({ title: "A title far too long for a springboard label" }))).toContain("applet.title");
    const wide = manifest();
    const surfaces = { auxiliary: { fixed: { logical: [400, 240], presentation: "native" } } };
    expect(codes({ ...wide, app: { ...wide.app, surfaces } } as unknown as PocketManifestV2)).toContain("applet.surface");
    expect(codes({ ...wide, app: { ...wide.app, model: "rust" } } as PocketManifestV2)).toContain("applet.nativeModel");
    expect(codes({ ...wide, app: { ...wide.app, companions: ["youtube"] } } as PocketManifestV2)).toContain("applet.companions");
  });

  test("storage needs applet.store, services need net.http, cameras are allowed", () => {
    const requires = ["display.auxiliary", "input.touch.auxiliary"];
    expect(codes(manifest({ applet: { version: 1, services: ["x"] } }))).toContain("applet.network");
    expect(codes(manifest({ applet: { version: 1, services: ["x"] } }, { requires: [...requires, "net.http"] }))).toEqual([]);
    expect(codes(manifest({}, { requires: [...requires, "data.fs"] }))).toContain("applet.store");
    expect(codes(manifest({ applet: { version: 1, store: { maxBytes: 65536 } } }, { requires: [...requires, "data.fs"] }))).toEqual([]);
    expect(codes(manifest({}, { requires: [...requires, "camera.photo"] }))).toEqual([]);
  });

  test("plan resolution refuses a broken applet and carries a passing one's section", () => {
    expect(() => resolve3dsBuildPlan(manifest({}, { enhances: ["system.agent", "system.wifi"] }))).toThrow(/system.wifi is not available to applets/);
    const plan = resolve3dsBuildPlan(manifest({ applet: { version: 1, store: { maxBytes: 65536 } } }, {
      requires: ["display.auxiliary", "input.touch.auxiliary", "data.fs"],
    }));
    expect(plan.applet).toEqual({ version: 1, store: { maxBytes: 65536 } });
  });
});

describe("the full-screen presentation", () => {
  const FULL_SCREEN = {
    id: "full-screen",
    entry: "notes/main.tsx",
    modality: { screens: 1, touch: "none", buttons: true },
    viewport: { fixed: { logical: [480, 272], presentation: "native" } },
  };
  const both = (app: Record<string, unknown> = {}, capabilities?: { requires?: string[]; enhances?: string[] }) => {
    const base = manifest({}, {
      requires: capabilities?.requires ?? ["text.glyphs.baked", "input.buttons"],
      enhances: capabilities?.enhances ?? ["system.agent", "display.auxiliary", "input.touch.auxiliary", "input.analog.left"],
    });
    return { ...base, app: { ...base.app, modality: { touch: "auxiliary" }, presentations: [FULL_SCREEN], ...app } } as unknown as PocketManifestV2;
  };

  test("one program serves the touch surface and the full screen", () => {
    expect(codes(both())).toEqual([]);
    const psp = validateAndResolveBuildPlan(both(), { target: "psp" });
    if (!psp.ok) throw new Error(psp.diagnostics.map((d) => d.message).join("; "));
    expect(psp.plan.presentation).toEqual({ id: "full-screen", entry: "notes/main.tsx" });
    expect(psp.plan.app.entry).toBe("notes/main.tsx");
    expect(psp.plan.surfaces?.auxiliary).toBeUndefined();
    const dual = resolve3dsBuildPlan(both());
    expect(dual.presentation).toEqual({ id: "default", entry: "notes/main.tsx" });
    expect(dual.surfaces?.auxiliary?.logical).toEqual([320, 240]);
  });

  test("a second program, another modality, a surface or a new output is refused", () => {
    expect(codes(both({ presentations: [{ ...FULL_SCREEN, entry: "notes/psp.tsx" }] }))).toContain("applet.presentationEntry");
    expect(codes(both({ presentations: [{ ...FULL_SCREEN, modality: { screens: 1, touch: "primary" } }] }))).toContain("applet.presentationModality");
    const surfaces = { auxiliary: { fixed: { logical: [320, 240], presentation: "native" } } };
    expect(codes(both({ presentations: [{ ...FULL_SCREEN, surfaces }] }))).toContain("applet.presentationSurfaces");
    expect(codes(both({ presentations: [{ ...FULL_SCREEN, output: "notes-psp" }] }))).toContain("applet.presentationOutput");
    expect(codes(both({ presentations: [FULL_SCREEN, { ...FULL_SCREEN, id: "again" }] }))).toContain("applet.presentations");
  });

  test("the baseline keeps the touch surface: its modality, enhanced surface capabilities, required buttons", () => {
    expect(codes(both({ modality: undefined }))).toContain("applet.baselineModality");
    expect(codes(both({}, { requires: ["text.glyphs.baked", "input.buttons", "display.auxiliary"], enhances: ["system.agent", "input.touch.auxiliary"] }))).toContain("applet.surfaceEnhanced");
    expect(codes(both({}, { requires: ["text.glyphs.baked"] }))).toContain("applet.buttons");
    // Without the presentation, the v1 rule stands: the surface is required.
    const touchOnly = manifest({}, { requires: ["text.glyphs.baked", "input.buttons"], enhances: ["system.agent", "display.auxiliary", "input.touch.auxiliary"] });
    expect(codes(touchOnly)).toContain("applet.required");
  });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(TMP, "project-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

const CLEAN = {
  "notes/main.tsx": `import App from "./app.tsx";\nimport { mount } from "@pocketjs/framework/solid";\nmount(() => <App />);\n`,
  "notes/app.tsx": [
    `import { createSignal } from "solid-js";`,
    `import { AuxiliarySurface, Text } from "@pocketjs/framework/components";`,
    `import { label } from "../ui/label.ts";`,
    `export default function App() {`,
    `  const [text] = createSignal(label);`,
    `  return <AuxiliarySurface><Text>{text()}</Text></AuxiliarySurface>;`,
    `}`,
  ].join("\n"),
  "ui/label.ts": `export const label = <T,>(value: T): T => value;\n`,
};
const DECLARED: AppletDeclaration = { version: 1 };
const sources = (dir: string, applet = DECLARED, capabilities: string[] = []) =>
  checkAppletSources({ projectRoot: dir, entry: "notes/main.tsx", applet, capabilities }).map((d) => d.code);

describe("source rules", () => {
  test("a clean applet passes: shared modules in the project", () => {
    expect(sources(project(CLEAN))).toEqual([]);
  });

  test("eval, Function, dynamic import, other packages, launcher exports and gated modules are refused", () => {
    const dir = project({
      ...CLEAN,
      "notes/bad.ts": [
        `import { readFileSync } from "node:fs";`,
        `import { installApp, companionNow } from "@pocket-shell/runtime/link";`,
        `import { launchApp } from "@pocket-shell/runtime/launcher";`,
        `import { openCamera } from "@pocket-shell/runtime/camera";`,
        `export const run = () => { eval("1"); new Function("return 1"); void import("./app.tsx"); return [readFileSync, installApp, companionNow, launchApp, openCamera]; };`,
      ].join("\n"),
      "notes/main.tsx": `import "./bad.ts";\n${CLEAN["notes/main.tsx"]}`,
    });
    const found = sources(dir);
    for (const code of ["applet.package", "applet.system", "applet.module", "applet.eval", "applet.dynamicImport"]) {
      expect(found).toContain(code);
    }
    // camera is gated, not forbidden.
    const withCamera = checkAppletSources({ projectRoot: dir, entry: "notes/main.tsx", applet: DECLARED, capabilities: ["camera.photo"] });
    expect(withCamera.filter((d) => d.message.includes("camera"))).toEqual([]);
  });

  test("the Runtime's modules: applet and link pass, camera with its capability, the system's are refused", () => {
    const runtimeModules = (imports: string[], capabilities: string[] = []) => {
      const dir = project({
        ...CLEAN,
        "notes/runtime.ts": imports.map((name, index) => `import * as m${index} from "@pocket-shell/runtime/${name}";`).join("\n") +
          `\nexport const all = [${imports.map((_, index) => `m${index}`).join(", ")}];\n`,
        "notes/main.tsx": `import "./runtime.ts";\n${CLEAN["notes/main.tsx"]}`,
      });
      return checkAppletSources({ projectRoot: dir, entry: "notes/main.tsx", applet: DECLARED, capabilities }).map((d) => d.message);
    };
    expect(runtimeModules(["applet", "link"])).toEqual([]);
    expect(runtimeModules(["camera"])).toEqual(["@pocket-shell/runtime/camera needs the camera. capability"]);
    expect(runtimeModules(["camera"], ["camera.qr"])).toEqual([]);
    expect(runtimeModules(["channel", "launcher", "system", "agent", "wifi", "device", "spec/link"])).toEqual(
      ["channel", "launcher", "system", "agent", "wifi", "device", "spec/link"].map((name) => `@pocket-shell/runtime/${name} is not available to applets`),
    );
  });

  test("an import of a Runtime module by its PocketJS name names the module's specifier", () => {
    const dir = project({
      ...CLEAN,
      "notes/old.ts": [
        `import { AppletSurface } from "@pocketjs/framework/applet";`,
        `import { companionNow } from "@pocketjs/framework/link";`,
        `import { openCamera } from "@pocketjs/framework/camera";`,
        `import { wifiStatus } from "@pocketjs/framework/wifi";`,
        `export const all = [AppletSurface, companionNow, openCamera, wifiStatus];`,
      ].join("\n"),
      "notes/main.tsx": `import "./old.ts";\n${CLEAN["notes/main.tsx"]}`,
    });
    const found = checkAppletSources({ projectRoot: dir, entry: "notes/main.tsx", applet: DECLARED, capabilities: ["camera.qr"] });
    expect(found.map((d) => [d.code, d.path, d.message])).toEqual([
      ["applet.module", "notes/old.ts", "@pocketjs/framework/applet moved to @pocket-shell/runtime/applet"],
      ["applet.module", "notes/old.ts", "@pocketjs/framework/link moved to @pocket-shell/runtime/link"],
      ["applet.module", "notes/old.ts", "@pocketjs/framework/camera moved to @pocket-shell/runtime/camera"],
      ["applet.module", "notes/old.ts", "@pocketjs/framework/wifi moved to @pocket-shell/runtime/wifi, which is not available to applets"],
    ]);
  });

  test("worker/channels, the UI's side of the applet's worker, comes with net.http", () => {
    const dir = project({
      ...CLEAN,
      "notes/net.ts": `import { worker } from "@pocketjs/framework/worker/channels";\nexport const requests = () => worker.channel("request");\n`,
      "notes/main.tsx": `import "./net.ts";\n${CLEAN["notes/main.tsx"]}`,
    });
    const refused = checkAppletSources({ projectRoot: dir, entry: "notes/main.tsx", applet: DECLARED, capabilities: [] });
    expect(refused.map((d) => [d.code, d.message])).toEqual([["applet.module", "@pocketjs/framework/worker/channels needs the net.http capability"]]);
    expect(sources(dir, { version: 1, services: ["glyphs"] }, ["net.http"])).toEqual([]);
    // The build checks with the plan's features: an applet that requires
    // net.http and declares its worker resolves with the feature on.
    const plan = resolve3dsBuildPlan(manifest({
      applet: { version: 1, services: ["glyphs"] },
      domains: {
        worker: {
          entry: "notes/worker.ts",
          nodes: [{ name: "http", kind: "http" }],
          channels: [
            { name: "request", kind: "ring", direction: "ui-to-worker", recordBytes: 1024, capacity: 4 },
            { name: "response", kind: "ring", direction: "worker-to-ui", recordBytes: 1024, capacity: 8 },
          ],
        },
      },
    }, { requires: ["text.glyphs.baked", "input.buttons", "display.auxiliary", "input.touch.auxiliary", "net.http"] }));
    expect(plan.domains?.worker?.nodes).toEqual([{ name: "http", kind: "http" }]);
    expect(sources(dir, plan.applet, Object.keys(plan.features))).toEqual([]);
  });

  test("a module outside the project root and a UI without AuxiliarySurface are refused", () => {
    const dir = project({
      "notes/main.tsx": `import "../../outside.ts";\nexport const nothing = 1;\n`,
    });
    writeFileSync(join(dir, "..", "outside.ts"), "export {};\n");
    const found = sources(dir);
    expect(found).toContain("applet.surface");
    expect(found.some((code) => code === "applet.outsideProject" || code === "applet.missingModule")).toBe(true);
  });
});

describe("budgets and an applet's files", () => {
  test("the bundle budgets", () => {
    expect(checkAppletBundle({ jsBytes: APPLET_BUDGET.jsBytes, pakBytes: APPLET_BUDGET.pakBytes })).toEqual([]);
    expect(checkAppletBundle({ jsBytes: APPLET_BUDGET.jsBytes + 1 }).map((d) => d.code)).toEqual(["applet.budget"]);
    expect(checkAppletBundle({ jsBytes: 1, pakBytes: APPLET_BUDGET.pakBytes + 1 }).map((d) => d.code)).toEqual(["applet.budget"]);
  });

  // The fixture applet fetches through a worker, as Hacker News of
  // pocket-nexus/applets does, and keeps a store, as its Notes does.
  test("the fixture applet passes from its files: the contract, the worker, the store, a shared module", () => {
    const manifestPath = join(FIXTURES, "feed/pocket.app.json");
    expect(checkApplet({ manifestPath, projectRoot: FIXTURES })).toEqual([]);
    const plan = resolve3dsBuildPlan(readPocketManifest(manifestPath).manifest);
    expect(plan.applet).toEqual({
      version: 1,
      summary: "The latest headline of one feed, kept between runs.",
      hosts: ["feed.example.com"],
      store: { maxBytes: 65536 },
    });
    expect(plan.domains?.worker?.entry).toBe("lib/feed-worker.ts");
    // The build checks the sources with the plan's features. Without them
    // the same graph is refused at the two gated modules, one in the
    // applet's directory and one in the shared one: the check read both.
    const graph = { projectRoot: FIXTURES, entry: plan.app.entry, applet: plan.applet! };
    expect(checkAppletSources({ ...graph, capabilities: Object.keys(plan.features) })).toEqual([]);
    expect(checkAppletSources({ ...graph, capabilities: [] }).map((d) => [d.path, d.message]).sort()).toEqual([
      ["feed/saved.ts", "@pocketjs/framework/fs needs the data.fs capability"],
      ["lib/feed.ts", "@pocketjs/framework/worker/channels needs the net.http capability"],
    ]);
  });
});
