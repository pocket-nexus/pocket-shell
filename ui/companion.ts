// SPDX-License-Identifier: GPL-3.0-or-later
// ui/companion.ts — the computer an applet's services run on, as the applets'
// prose names it. On Omarchy Pocket (target rg-ds-plus) omarchy-pocketd answers
// them on the device itself; a 3DS or a Tab5 reaches them on its paired Mac,
// in Pocket Hub.
import { platform } from "@pocketjs/framework/platform";

/** The services run on the device the applet runs on. */
export function tethered(): boolean {
  return platform.target === "rg-ds-plus";
}

/** "this device" or "your Mac" */
export const yourComputer = (): string => (tethered() ? "this device" : "your Mac");

/** "This device" or "The Mac", to start a sentence. */
export const theComputer = (): string => (tethered() ? "This device" : "The Mac");

/** Where to put a service's sign-in, said as an instruction. */
export function serviceSetup(service: string, what: string): string {
  return tethered()
    ? `put ${what} in ~/.local/share/omarchy-pocket/companion/services/${service}/ on this device`
    : `on the Mac run: bun tools/companion.ts service ${service} ${what.replace(/^its /, "")}`;
}

/** What a reader sees when the services do not answer. */
export function notLinked(app: string, verb = "loads"): { title: string; detail: string } {
  return tethered()
    ? { title: "omarchy-pocketd is not answering", detail: `${app} ${verb} through omarchy-pocketd on this device. Check it with: systemctl status omarchy-pocketd` }
    : { title: "Not linked to a Mac", detail: `${app} ${verb} through your Mac. Pair one in Settings > Mac and open Pocket Hub.` };
}
