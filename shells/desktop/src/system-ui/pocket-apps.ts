// SPDX-License-Identifier: GPL-3.0-only
// The desktop's name and its visible application catalog come from the System
// manifest. The native host receives separately resolved complete package
// plans; this module carries only System-owned presentation data.

import type { PocketSystemV1 } from "@pocketjs/framework/manifest";
import systemJson from "../../pocket.system.json";

const system = systemJson as unknown as PocketSystemV1;
const installedPackages = new Set(system.installation.installedPackages);

/** The System manifest's `title`: the name the shell shows for the desktop
 *  itself — the screen bar with no window focused, the About dialog and its
 *  menu entries, the welcome note. A product that installs this System UI
 *  under its own manifest gets its own name in all of them. */
export const DESKTOP_NAME: string = system.title;

export interface PocketAppSpec {
  /** Stable package id used by the native compositor surface registry. */
  package: string;
  /** Compact desktop caption/icon label. */
  title: string;
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

/** The installed app with this package id, or undefined when the id is not
 *  in the installed catalog (the System UI itself has no presentation and is
 *  never an app). */
export function pocketAppByPackage(
  packageId: unknown,
): PocketAppSpec | undefined {
  return typeof packageId === "string"
    ? POCKET_APPS.find((app) => app.package === packageId)
    : undefined;
}

export const POCKET_ICON = "icons/pocket-app.svg";
export const POCKET_ICON_SMALL = "icons/pocket-app-16.svg";
