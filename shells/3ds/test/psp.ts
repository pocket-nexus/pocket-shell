// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/psp.ts — the PSP's full screen in the sims: a program built
// the way `bun run psp` builds it (scripts/psp.ts: compiled against the psp
// host config, admitted by its host contract), its guest unpacked from that
// package and booted on a 480x272 primary display with no auxiliary surface
// and no touch, the way the PSP host presents it. The console is tethered:
// its link rides the USB share of the computer it is plugged into.
// POCKET_PSP_SHOTS=<dir> writes the screens as PNGs.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePocketPackage, findSection, findVariant, POCKET_SECTION } from "../../../vendor/pocketjs/contracts/spec/pocket-package.ts";
import { bootConsole3ds, type Console3ds, type Console3dsOptions } from "../../../vendor/pocketjs/programs/sim/console-3ds.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { buildPspPackage } from "../scripts/psp.ts";

export const PSP: [number, number] = [480, 272];

/** The computer a PSP is plugged into, as its companion names itself. */
export const ZERO = { id: "1e992d21f442aba3", name: "CardputerZero", address: "usb", port: 0 };
/** A PSP whose link rides the USB share, linked to ZERO's companion. */
export const USB_LINK = { device: { id: "000004766e7535b5", name: "PSP", model: "PSP", address: "usb" }, paired: [ZERO], linked: ZERO.id };

const SHOTS = process.env.POCKET_PSP_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** Build `app`'s PSP package into `out` and unpack the guest the EBOOT
 *  embeds; returns the guest's path without extension. */
export async function buildPspGuest(app: string, out: string): Promise<string> {
  const { path, plan } = await buildPspPackage(app, out);
  const variant = findVariant(decodePocketPackage(new Uint8Array(readFileSync(path))), "psp");
  const js = variant && findSection(variant, POCKET_SECTION.js);
  if (!variant || !js) throw new Error(`${path} has no psp variant with JavaScript`);
  const guest = join(out, "guest", plan.app.output);
  mkdirSync(join(out, "guest"), { recursive: true });
  // The package's JavaScript ends in a NUL the guest does not read.
  writeFileSync(`${guest}.js`, js.subarray(0, js.length - 1));
  writeFileSync(`${guest}.pak`, findSection(variant, POCKET_SECTION.pak) ?? new Uint8Array());
  return guest;
}

/** Boot a PSP guest: one 480x272 screen, buttons only, tethered over USB. */
export function bootPsp(guest: string, options: Partial<Console3dsOptions> = {}): Promise<Console3ds> {
  return bootConsole3ds({
    js: `${guest}.js`,
    pak: `${guest}.pak`,
    link: USB_LINK,
    wifi: null,
    camera: false,
    primary: PSP,
    auxiliary: null,
    ...options,
  });
}

export function pspShot(console3ds: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = console3ds.world.pixels("primary");
  writeFileSync(join(SHOTS, `${name}.png`), encodePNG(rgba, width, height));
}
