// SPDX-License-Identifier: GPL-3.0-or-later
// runtime/test/presentation.test.ts — the presentation the resolver picks for
// a target's modality (runtime/manifest/resolve.ts): `app.presentations` in
// declaration order, their viewport, surfaces and capabilities, and
// `app.modality`, the requirement of the baseline entry. From PocketJS
// tests/modality.test.ts; the cases on deriving a modality from a host
// contract stay there, with contracts/spec/modality.ts.

import { describe, expect, test } from "bun:test";
import { PORTABLE_MODALITY } from "../../vendor/pocketjs/contracts/spec/modality.ts";
import { THREE_DS_DEV_CONTRACTS, THREE_DS_DEV_TARGET_ID } from "../../devices/3ds/tools/profile.ts";
import { validateAndResolveBuildPlan } from "../manifest/resolve.ts";

function manifest(): Record<string, any> {
  return {
    $schema: "https://pocketjs.dev/schema/pocket-2.json",
    pocket: 2,
    id: "dev.pocket-nexus.presentations",
    title: "Pocket Presentations",
    version: "1.0.0",
    engine: {
      capabilities: {
        requires: ["text.glyphs.baked", "input.buttons"],
        enhances: ["input.touch", "input.cursor", "input.analog.left"],
      },
    },
    app: {
      entry: "app/main.tsx",
      output: "main",
      framework: "solid",
      viewport: { logical: [480, 272], presentation: "integer-fit" },
      presentations: [
        {
          id: "dual-screen",
          entry: "app/main-dual.tsx",
          output: "dual",
          modality: { screens: 2, touch: "auxiliary" },
          viewport: { fixed: { logical: [400, 240], presentation: "native" } },
          surfaces: { auxiliary: { fixed: { logical: [320, 240], presentation: "native" } } },
          capabilities: {
            requires: ["display.auxiliary", "input.touch.auxiliary", "io.offload"],
            enhances: ["input.analog.right"],
          },
        },
      ],
    },
  };
}

describe("presentation selection", () => {
  test("a single-screen target compiles the baseline entry", () => {
    const result = validateAndResolveBuildPlan(manifest(), { target: "psp" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.presentation).toEqual({ id: "default", entry: "app/main.tsx" });
    expect(result.plan.app.entry).toBe("app/main.tsx");
    expect(result.plan.app.output).toBe("main");
    expect(result.plan.viewport.logical).toEqual([480, 272]);
    expect(result.plan.surfaces).toBeUndefined();
    expect(result.plan.modality).toEqual(PORTABLE_MODALITY);
    // The presentation's capabilities stay out of a build that did not pick it.
    expect(result.plan.features).not.toHaveProperty("display.auxiliary");
    expect(result.plan.features).not.toHaveProperty("input.analog.right");
  });

  test("the dual-screen target compiles the matching presentation with its own geometry and capabilities", () => {
    const result = validateAndResolveBuildPlan(manifest(), { target: THREE_DS_DEV_TARGET_ID }, THREE_DS_DEV_CONTRACTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.presentation).toEqual({ id: "dual-screen", entry: "app/main-dual.tsx" });
    expect(result.plan.app.entry).toBe("app/main-dual.tsx");
    expect(result.plan.app.output).toBe("dual");
    expect(result.plan.viewport.logical).toEqual([400, 240]);
    expect(result.plan.viewport.presentation).toBe("native");
    expect(result.plan.surfaces?.auxiliary.logical).toEqual([320, 240]);
    expect(result.plan.modality.screens.length).toBe(2);
    expect(result.plan.features).toEqual({
      "display.auxiliary": true,
      "input.analog.left": true,
      "input.analog.right": true,
      "input.buttons": true,
      "input.cursor": true,
      "input.touch": false,
      "input.touch.auxiliary": true,
      "io.offload": true,
      "text.glyphs.baked": true,
    });
  });

  test("a matched presentation that the target cannot admit fails at the presentation's path", () => {
    const value = manifest();
    value.app.presentations[0].capabilities.requires.push("input.pointer");
    const result = validateAndResolveBuildPlan(value, { target: THREE_DS_DEV_TARGET_ID }, THREE_DS_DEV_CONTRACTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual([
      {
        code: "capability.unavailable",
        path: "/app/presentations/0/capabilities/requires/3",
        message: expect.stringContaining("input.pointer"),
      },
    ]);
  });

  test("a presentation may promote an app enhancement to a requirement, but not repeat a declaration", () => {
    const promoted = manifest();
    promoted.app.presentations[0].capabilities.requires.push("input.cursor");
    const ok = validateAndResolveBuildPlan(promoted, { target: THREE_DS_DEV_TARGET_ID }, THREE_DS_DEV_CONTRACTS);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.plan.features["input.cursor"]).toBe(true);

    const repeated = manifest();
    repeated.app.presentations[0].capabilities.requires.push("input.buttons");
    const bad = validateAndResolveBuildPlan(repeated, { target: THREE_DS_DEV_TARGET_ID }, THREE_DS_DEV_CONTRACTS);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.diagnostics.map((d) => [d.code, d.path])).toEqual([
        ["capability.duplicate", "/app/presentations/0/capabilities/requires/3"],
      ]);
    }
  });

  test("presentations are tried in order and ids must be unique", () => {
    const value = manifest();
    value.app.presentations.push({
      id: "touch",
      entry: "app/main-touch.tsx",
      modality: { touch: "any", screens: 1 },
    });
    const vita = validateAndResolveBuildPlan(value, { target: "vita" });
    expect(vita.ok && vita.plan.presentation.id).toBe("touch");
    const psp = validateAndResolveBuildPlan(value, { target: "psp" });
    expect(psp.ok && psp.plan.presentation.id).toBe("default");
    const dual = validateAndResolveBuildPlan(value, { target: THREE_DS_DEV_TARGET_ID }, THREE_DS_DEV_CONTRACTS);
    expect(dual.ok && dual.plan.presentation.id).toBe("dual-screen");

    // A catch-all listed first wins every device — declaration order decides.
    value.app.presentations.unshift({ id: "any", entry: "app/main-any.tsx", modality: {} });
    const first = validateAndResolveBuildPlan(value, { target: "vita" });
    expect(first.ok && first.plan.presentation.id).toBe("any");

    // A presentation addressed to a modality must admit there: "touch: any"
    // also matches the 3DS, whose top screen cannot present the inherited
    // 480x272 viewport, and the diagnostic points at the presentation.
    const unhosted = manifest();
    unhosted.app.presentations.unshift({ id: "touch", entry: "app/main-touch.tsx", modality: { touch: "any" } });
    const failed = validateAndResolveBuildPlan(unhosted, { target: THREE_DS_DEV_TARGET_ID }, THREE_DS_DEV_CONTRACTS);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.diagnostics.map((d) => d.code)).toContain("viewport.logicalUnsupported");

    value.app.presentations[1].id = "any";
    const duplicate = validateAndResolveBuildPlan(value, { target: "psp" });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.diagnostics[0]).toMatchObject({ code: "presentation.duplicateId", path: "/app/presentations/1/id" });
  });

  test("the schema rejects unknown modality fields and malformed presentations", () => {
    const value = manifest();
    value.app.presentations[0].modality.screenCount = 2;
    const unknown = validateAndResolveBuildPlan(value, { target: "psp" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.diagnostics[0]).toMatchObject({ path: "/app/presentations/0/modality/screenCount" });

    const missing = manifest();
    delete missing.app.presentations[0].modality;
    const result = validateAndResolveBuildPlan(missing, { target: "psp" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0]).toMatchObject({ code: "schema.required", path: "/app/presentations/0/modality" });
  });
});

describe("application modality", () => {
  test("a touch-only application is refused where no screen reports contacts", () => {
    const value = manifest();
    delete value.app.presentations;
    value.app.modality = { touch: "primary" };
    const psp = validateAndResolveBuildPlan(value, { target: "psp" });
    expect(psp.ok).toBe(false);
    if (!psp.ok) {
      expect(psp.diagnostics).toEqual([
        { code: "modality.unsupported", path: "/app/modality", message: expect.stringContaining("touch") },
      ]);
    }
    const vita = validateAndResolveBuildPlan(value, { target: "vita" });
    expect(vita.ok && vita.plan.presentation.id).toBe("default");
  });

  test("a matching presentation serves a device the baseline refuses", () => {
    const value = manifest();
    value.app.modality = { touch: "primary" };
    const dual = validateAndResolveBuildPlan(value, { target: THREE_DS_DEV_TARGET_ID }, THREE_DS_DEV_CONTRACTS);
    expect(dual.ok && dual.plan.presentation.id).toBe("dual-screen");
    const psp = validateAndResolveBuildPlan(value, { target: "psp" });
    expect(psp.ok).toBe(false);
  });
});
