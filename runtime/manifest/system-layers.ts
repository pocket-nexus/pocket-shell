// SPDX-License-Identifier: GPL-3.0-or-later
// The system layers Pocket Shell adds to an application's bundle
// (@pocketjs/framework/system-layers). Every caller that runs PocketJS's
// compiler on a plan (cli/pocket-shell.ts compile, devices/3ds/build.ts)
// passes the arguments this module returns, so one rule decides them.
//
// A Solid application that declares "system.agent" gets the agent's overlay
// (runtime/src/agent-layer.tsx). The compiler takes it as
// `tools/build.ts --layer=<module>`: pass 1 walks the module, so its class
// strings and glyphs compile with the application's, and pass 2 imports it
// ahead of the application's entry, so it registers before mount().

import { resolve } from "node:path";
import type { ResolvedBuildPlan } from "./plan.ts";

/** The agent's overlay: the layer of an application that declares "system.agent". */
export const AGENT_LAYER = resolve(import.meta.dir, "../src/agent-layer.tsx");

/** What the rule reads from a plan. */
export type LayerPlan = { readonly app: Pick<ResolvedBuildPlan["app"], "framework">; readonly features: ResolvedBuildPlan["features"] };

/** The layer modules of `plan`, in the order the compiler imports them. */
export function systemLayers(plan: LayerPlan): string[] {
  return plan.app.framework === "solid" && plan.features["system.agent"] === true ? [AGENT_LAYER] : [];
}

/** `--layer=<module>` for each layer of `plan`: the arguments PocketJS's compiler takes. */
export function systemLayerArguments(plan: LayerPlan): string[] {
  return systemLayers(plan).map((layer) => `--layer=${layer}`);
}
