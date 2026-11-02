// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/kit/platform.tsx — what the kit takes from the device it runs on. The
// kit is the same on Omarchy Pocket and in Pocket Shell except for this file.
/** The applet surface: the touch screen, or the full screen of a device without one. */
export { AppletSurface as Surface } from "@pocketjs/framework/applet";
import { companionNow } from "@pocketjs/framework/link";
/** The network is the applet's worker (ui/net.ts). */
export { companionService, fetch } from "../ui/net.ts";
/** A response's limit (PocketJS contracts/spec/net.ts). */
export const NET_MAX_RESPONSE_BYTES = 256 * 1024;
/** The keyboard is on this app's own surface. */
export const keyboardElsewhere = () => false;
/** Epoch milliseconds, by the linked Mac's clock: a console's own is often unset. */
export const now = () => companionNow();
/** Query answers kept for going back to, in a guest heap of 24 MiB. */
export const QUERIES_KEPT = 12;
