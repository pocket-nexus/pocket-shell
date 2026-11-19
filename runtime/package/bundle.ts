// SPDX-License-Identifier: GPL-3.0-or-later
// A `.pocket` variant as a PocketJS bundle (`.pkb`, PocketJS
// contracts/spec/bundle.ts). The two containers number their sections alike
// (docs/POCKET-PACKAGE.md), so the variant's sections, binding generation and
// host contract hash become the bundle's unchanged. The PSP program embeds
// its guests as bundles (shells/3ds/scripts/psp.ts).

import { encodeBundle } from "../../vendor/pocketjs/contracts/spec/bundle.ts";
import type { PocketPackageVariant } from "../spec/pocket-package.ts";

export function bundleOfVariant(variant: PocketPackageVariant): Uint8Array {
  return encodeBundle({
    hostAbi: variant.hostAbi,
    profileHash: variant.profileHash,
    sections: variant.sections.map((section) => ({ kind: section.kind, bytes: section.bytes })),
  });
}
