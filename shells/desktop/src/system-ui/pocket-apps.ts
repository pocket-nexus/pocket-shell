// SPDX-License-Identifier: GPL-3.0-only
// Pocket Shell Desktop's visible application catalog comes from its System manifest.
// The native host receives separately resolved complete package plans; this
// module carries only System-owned presentation data.

import { getOps } from "@pocketjs/framework/host";
import type { IconName } from "./theme.ts";
import type { PocketSystemV1 } from "@pocketjs/framework/manifest";
import systemJson from "../../pocket.system.json";
import macApps from "../../macos-apps.json";

const system = systemJson as unknown as PocketSystemV1;
const installedPackages = new Set(system.installation.installedPackages);

export interface PocketAppSpec {
  /** Stable package id used by the native compositor surface registry. */
  package: string;
  /** Compact desktop caption/icon label. */
  title: string;
  native?: boolean;
  icon?: IconName;
  /** The macos-app plan's logical viewport. */
  viewport: readonly [number, number];
}

export const POCKET_APPS: readonly PocketAppSpec[] = system.applications.catalog
  .filter((entry) => installedPackages.has(entry.package) && entry.presentation)
  .map((entry) => ({
    package: entry.package,
    title: entry.presentation!.title,
    viewport: entry.presentation!.viewport,
  }));

export const POCKET_ICON = "icons/pocket-app.svg";
export const POCKET_ICON_SMALL = "icons/pocket-app-16.svg";
export const MAC_POCKET_APPS = POCKET_APPS.filter(app => macApps.includes(app.package));


export const OPENSTRIKE_APP: PocketAppSpec = {
  package: "dev.pocket-stack.openstrike", title: "OpenStrike", viewport: [800, 450], native: true, icon: "openstrike",
};

export function nativePocketApps(): readonly PocketAppSpec[] {
  return (getOps().__applications ?? []).filter(app => app.native).map(app => ({
    ...app, icon: app.package === OPENSTRIKE_APP.package ? "openstrike" : "pocket-apps",
  }));
}
