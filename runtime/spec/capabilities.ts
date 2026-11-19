// SPDX-License-Identifier: GPL-3.0-or-later
// The capability ids Pocket Shell defines.
//
// PocketJS registers the ids it defines (POCKET_CAPABILITIES in
// vendor/pocketjs/contracts/spec/capabilities.ts); a host contract may list
// others, and those are the host's. These are the ids the hosts of this
// repository define: their contracts, guest modules and host code live here
// (runtime/spec, runtime/src, devices/). The 3DS, Tab5 and PSP host contracts
// list them, and the app contracts of the launcher and the applets declare
// them. Their spelling is the one published packages and plans carry.
//
// An app contract resolves against SHELL_CAPABILITY_REGISTRY, PocketJS's ids
// and these (runtime/manifest/registry.ts): an id here is known on every
// Pocket Shell host, so an applet that enhances `system.agent` builds for a
// host that does not provide it with the feature off.
import {
  POCKET_CAPABILITIES,
  defineCapabilityRegistry,
  type CapabilityId,
} from "../../vendor/pocketjs/contracts/spec/capabilities.ts";

export const SHELL_CAPABILITIES = defineCapabilityRegistry([
  // The console's system link to a paired companion computer
  // (`globalThis.link`, spec/link.ts and spec/link2.ts): pairing, link
  // status, the companion's app catalog and app installs. A host that owns
  // the link also routes net.http over it.
  "link.companion",
  // A running package's channel to its computer side over that link
  // (`globalThis.link.channel`): requests, events and byte streams the
  // companion routes to the package's daemon. The host opens the channel for
  // a package that declares it and closes it when the package ends.
  "link.channel",
  // Native encoded-media playback with bounded worker handoff, audio clock,
  // pause/volume, texture output and observable decoder availability
  // (`globalThis.media`, spec/media.ts, docs/MEDIA.md).
  "media.playback",
  // The console's wireless radio and saved connections (`globalThis.wifi`,
  // spec/wifi.ts). Reads and selects; never writes a connection.
  "system.wifi",
  // The board's own controls (`globalThis.device`, spec/device.ts):
  // backlight, speaker level, power rails, plug detection, free header pins,
  // the removable card's directory listing and power off.
  "system.device",
  // Outer-camera preview texture plus an on-device QR decoder
  // (`globalThis.camera`, spec/camera.ts).
  "camera.qr",
  // Stills from the outer or inner camera kept as JPEG under the storage's
  // DCIM folder, listed, decoded for drawing and deleted (the same
  // `globalThis.camera` namespace).
  "camera.photo",
  // The system mascot on the top screen and the agent channel to the
  // companion (`globalThis.agent`, spec/agent.ts): a guest that declares it
  // hands the top screen to the host's 3D stage and keeps its whole
  // interface on the auxiliary surface.
  "system.agent",
  // A product extension linked into the program: it draws the primary
  // display and publishes its own global, and the guest's interface stays on
  // the auxiliary surface.
  "system.extension",
] as const);

export type ShellCapabilityId = CapabilityId<typeof SHELL_CAPABILITIES>;

/** The ids an app contract resolves against: PocketJS's and Pocket Shell's. */
export const SHELL_CAPABILITY_REGISTRY = defineCapabilityRegistry([...POCKET_CAPABILITIES, ...SHELL_CAPABILITIES] as const);
