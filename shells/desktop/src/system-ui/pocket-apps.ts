// SPDX-License-Identifier: GPL-3.0-only
// The desktop's name and its visible application catalog come from the System
// manifest. The About dialog's text and the prefix of an app window's title
// come from pocket.about.json beside it. The native host receives separately
// resolved complete package plans; this module carries only System-owned
// presentation data.

import type { PocketSystemV1 } from "@pocketjs/framework/manifest";
import aboutJson from "../../pocket.about.json";
import systemJson from "../../pocket.system.json";

const system = systemJson as unknown as PocketSystemV1;
const installedPackages = new Set(system.installation.installedPackages);

/** The System manifest's `title`: the name the shell shows for the desktop
 *  itself — the screen bar with no window focused, the About dialog and its
 *  menu entries, the welcome note. A product that installs this System UI
 *  under its own manifest gets its own name in all of them. */
export const DESKTOP_NAME: string = system.title;

/** What the About dialog shows under the desktop's name. */
export interface DesktopAbout {
  /** One text line each. The dialog does not wrap them, and its fixed size
   *  holds four above the link. */
  body: readonly string[];
  /** Shown as text under the body; "" leaves the row out. */
  link: string;
}

/** Read a pocket.about.json value. The System manifest schema has no field
 *  for product copy, so the text lives in this file beside the manifest. Both
 *  fields are optional: a missing `body` gives no lines and a missing `link`
 *  no link row. Entries of `body` that are not strings are dropped. */
export function readAbout(value: unknown): DesktopAbout {
  const record =
    value !== null && typeof value === "object"
      ? (value as { body?: unknown; link?: unknown })
      : {};
  return {
    body: Array.isArray(record.body)
      ? record.body.filter((line): line is string => typeof line === "string")
      : [],
    link: typeof record.link === "string" ? record.link : "",
  };
}

/** The About text of the product that installs this System UI. This
 *  repository's file describes the shell; a product that bundles the System
 *  UI under its own pocket.system.json puts its own pocket.about.json beside
 *  that manifest. */
export const DESKTOP_ABOUT: DesktopAbout = readAbout(aboutJson);

/** What stands before the colon in an app window's title when the product's
 *  pocket.about.json names nothing else. */
export const DEFAULT_WINDOW_TITLE_PREFIX = "PocketJS";

/** Read `windowTitlePrefix` from a pocket.about.json value: the text before
 *  the colon in the title of an installed app's window. Like the About text
 *  it is product copy the System manifest schema has no field for. A missing
 *  field, or one that is not a string, gives DEFAULT_WINDOW_TITLE_PREFIX. An
 *  empty string, or one of spaces alone, gives "": the window is titled with
 *  the app's title and nothing before it. */
export function readWindowTitlePrefix(value: unknown): string {
  const prefix =
    value !== null && typeof value === "object"
      ? (value as { windowTitlePrefix?: unknown }).windowTitlePrefix
      : undefined;
  return typeof prefix === "string"
    ? prefix.trim()
    : DEFAULT_WINDOW_TITLE_PREFIX;
}

/** The prefix of the product that installs this System UI. */
export const WINDOW_TITLE_PREFIX: string = readWindowTitlePrefix(aboutJson);

/** The title of an installed app's window, in its caption and its task
 *  button: "<prefix>: <app title>", or the app's title alone when the prefix
 *  is "". */
export function appWindowTitle(
  title: string,
  prefix: string = WINDOW_TITLE_PREFIX,
): string {
  return prefix === "" ? title : `${prefix}: ${title}`;
}

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
