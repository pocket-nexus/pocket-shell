// SPDX-License-Identifier: GPL-3.0-or-later
/** The app contract (pocket.app.json): its schema, loader, validation,
 *  resolution into a build plan, and the inputs a native host build reads
 *  from that plan. The JSON Schema subset and its validator are PocketJS's
 *  (contracts/spec/json-schema.ts). */
export {
  POCKET_MANIFEST_SCHEMA_ID,
  POCKET_MANIFEST_VERSION,
  pocketManifestV2Schema,
  type PocketManifestV2,
  type PocketFramework,
} from "../spec/pocket-manifest.ts";
export {
  type FeatureId,
  type PocketCapabilityId,
  type PresentationMode,
  type Viewport,
} from "../../vendor/pocketjs/contracts/spec/platforms.ts";
export {
  extractHostBuildInputs,
  hostBuildEnvironment,
  type ExtractHostBuildInputsOptions,
  type HostBuildEnvironmentOptions,
  type HostBuildInputs,
} from "./host-build-inputs.ts";
export {
  expandThemeReference,
  readAuthoredManifest,
  readPocketManifest,
  type LoadedManifest,
} from "./load.ts";
export { validatePocketManifest } from "./validate.ts";
export {
  validateAndResolveBuildPlan,
  type ResolutionResult,
  type ResolveBuildRequest,
} from "./resolve.ts";
export { createHostExtension, isHostExtension, type HostExtension } from "./host-extension.ts";
export { SHELL_PLATFORM_CONTRACTS, shellRegistry } from "./registry.ts";
export {
  SHELL_CAPABILITIES,
  SHELL_CAPABILITY_REGISTRY,
  type ShellCapabilityId,
} from "../spec/capabilities.ts";
