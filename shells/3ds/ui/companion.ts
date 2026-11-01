// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/companion.ts — the computer the applets reach, as their prose
// names it: on a 3DS or a Tab5 the paired Mac, whose Pocket Companion runs
// the services. Omarchy Pocket keeps a file of the same shape naming the
// device itself, so an applet's text reads right on both.

/** The services run on a computer the console is linked to. */
export function tethered(): boolean {
  return true;
}

/** "the linked Mac" */
export const yourComputer = (): string => "the linked Mac";

/** "The linked Mac", to start a sentence. */
export const theComputer = (): string => "The linked Mac";

/** Where a service keeps the files that sign it in (Pocket Companion's store). */
export const SERVICE_STORE = "~/Library/Application Support/Pocket Companion/services";

/** What a reader sees when the companion does not answer. */
export function notLinked(app: string, verb = "loads"): { title: string; detail: string } {
  return { title: "No Mac linked", detail: `${app} ${verb} through Pocket Companion on a Mac. Pair one in Settings.` };
}
