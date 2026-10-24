// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/companion.ts — the computer the applets reach, as their prose
// names it. A console paired over Wi-Fi reaches a Mac. A console tethered
// over USB (a PSP: link.status().device.address is "usb") reaches the
// computer it is plugged into, named by its companion ("CardputerZero").
// Untethered, every string is the one the applets always showed.

type LinkHost = { status(): string };

const host = () => (globalThis as { link?: LinkHost }).link;

let tetheredOnce: boolean | undefined;

/** The link rides the USB share of the computer this console is plugged into. */
export function tethered(): boolean {
  if (tetheredOnce === undefined) {
    try {
      const link = host();
      tetheredOnce = !!link && JSON.parse(link.status())?.device?.address === "usb";
    } catch {
      tetheredOnce = false;
    }
  }
  return tetheredOnce;
}

function companionName(): string | null {
  try {
    const name = JSON.parse(host()?.status() ?? "null")?.companion?.name;
    return typeof name === "string" && name ? name : null;
  } catch {
    return null;
  }
}

/** "your Mac", or the tethered companion's name. */
export const yourComputer = (): string => (tethered() ? companionName() ?? "the companion" : "your Mac");

/** "The Mac", or the tethered companion's name, to start a sentence. */
export const theComputer = (): string => (tethered() ? companionName() ?? "The companion" : "The Mac");

/** What a reader sees when the link is down: `app` `verb` through the computer. */
export function notLinked(app: string, verb = "loads"): { title: string; detail: string } {
  if (tethered()) {
    return {
      title: "Not linked to the companion",
      detail: `${app} ${verb} through the computer this console is plugged into. Run Pocket Companion there with --usb on the share.`,
    };
  }
  return { title: "Not linked to a Mac", detail: `${app} ${verb} through your Mac. Pair one in Settings > Mac and open Pocket Companion.` };
}
