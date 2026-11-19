// SPDX-License-Identifier: GPL-3.0-or-later
// devices/3ds/tools/profile.ts — the 3DS host contract (../pocket.host.json,
// id "3ds-dev") and the build plans resolved against it.

import { resolve } from "node:path";
import { POCKET_BINDING_GENERATION } from "../../../vendor/pocketjs/contracts/spec/binding-generation.ts";
import { shellRegistry } from "../../../runtime/manifest/registry.ts";
import type { ResolvedBuildPlan } from "../../../runtime/manifest/plan.ts";
import { validateAndResolveBuildPlan } from "../../../runtime/manifest/resolve.ts";
import { readPocketProfile } from "../../../vendor/pocketjs/framework/src/profile.ts";

/** The host contract this program is built for and admits packages against. */
export const THREE_DS_HOST_CONTRACT = resolve(import.meta.dir, "../pocket.host.json");
/** The checked, frozen host contract. */
export const THREE_DS_PROFILE = readPocketProfile(THREE_DS_HOST_CONTRACT);
const softwareProfile = THREE_DS_PROFILE;

/**
 * The Nintendo 3DS product's host contract.
 *
 * The app owns the 400x240 top screen and a simultaneous 320x240 auxiliary
 * bottom-screen output. Both PICA200 targets are native at density 1. The
 * resistive panel reports contacts only through input.touch.auxiliary. The
 * contract is not in PocketJS's registry of production targets
 * (`POCKET_TARGETS`): a plan is resolved against the registry of one target
 * made here.
 */
export const THREE_DS_DEV_TARGET_ID = softwareProfile.id;
export const THREE_DS_DEV_HOST_ABI = POCKET_BINDING_GENERATION;
export const THREE_DS_VIEWPORT = softwareProfile.display.logicalViewports[0];
export const THREE_DS_AUXILIARY_VIEWPORT = softwareProfile.display.auxiliary!.logicalViewports[0];

/** The registry a 3DS plan resolves against: PocketJS's and Pocket Shell's
 *  capability ids, and this contract as the one target. */
export const THREE_DS_DEV_CONTRACTS = shellRegistry(softwareProfile);

export function resolve3dsBuildPlan(input: unknown): ResolvedBuildPlan {
  const resolution = validateAndResolveBuildPlan(
    input,
    { target: THREE_DS_DEV_TARGET_ID },
    THREE_DS_DEV_CONTRACTS,
  );
  if (!resolution.ok) {
    throw new Error(
      `pocket 3ds: manifest did not resolve: ${resolution.diagnostics
        .map((diagnostic) => `${diagnostic.path || "/"}: ${diagnostic.message}`)
        .join("; ")}`,
    );
  }
  return resolution.plan;
}
