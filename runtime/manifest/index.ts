// SPDX-License-Identifier: GPL-3.0-or-later
/** The app contract (pocket.app.json): its schema, loader, validation,
 *  resolution into a build plan, and the inputs a native host build reads
 *  from that plan. Desktop System manifests (PocketJS
 *  contracts/spec/pocket-system.ts) and the Vita title id are not part of it. */
export {
  POCKET_MANIFEST_SCHEMA_ID,
  POCKET_MANIFEST_VERSION,
  pocketManifestV2Schema,
  type PocketManifestV2,
  type PocketFramework,
  type AnimationTheme,
} from "../spec/pocket-manifest.ts";
export {
  type PackageRole,
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
export {
  validatePocketManifest,
  type ContractDiagnostic,
  type ValidationResult,
} from "./validate.ts";
export {
  validateAndResolveBuildPlan,
  type ResolutionResult,
  type ResolveBuildRequest,
} from "./resolve.ts";
export { createHostExtension, isHostExtension, type HostExtension } from "./host-extension.ts";
