// SPDX-License-Identifier: GPL-3.0-or-later
// The registries an app contract resolves against: PocketJS's capability ids
// and Pocket Shell's (../spec/capabilities.ts), with PocketJS's production
// targets or with one host contract.
import {
  POCKET_TARGETS,
  definePlatformContractRegistry,
  defineTargetRegistry,
} from "../../vendor/pocketjs/contracts/spec/platforms.ts";
import type { PocketProfile } from "../../vendor/pocketjs/contracts/spec/profile.ts";
import { targetProfile } from "../../vendor/pocketjs/hosts/contract.ts";
import { SHELL_CAPABILITY_REGISTRY } from "../spec/capabilities.ts";

/** PocketJS's production targets, resolved with Pocket Shell's ids. */
export const SHELL_PLATFORM_CONTRACTS = definePlatformContractRegistry(SHELL_CAPABILITY_REGISTRY, POCKET_TARGETS);

/** One host contract as the resolver's registry: the capability ids above
 *  and the contract as the one target. The document must validate. */
export function shellRegistry(profile: PocketProfile) {
  return definePlatformContractRegistry(SHELL_CAPABILITY_REGISTRY, defineTargetRegistry({
    [profile.id]: targetProfile(profile),
  }));
}
