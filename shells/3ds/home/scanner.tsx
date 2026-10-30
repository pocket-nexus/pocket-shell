// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/home/scanner.tsx — the QR scanner: Settings > Mac > Pair a Mac,
// and the store's Scan a Code... on a console that downloads apps by itself.
// The outer camera's live preview under a viewfinder (1:1 on the 3DS's touch
// screen; on a larger surface scaled to the height under the bar, or to the
// width in portrait), the console's QR decoder polled every frame, and the
// pairing handshake's progress.
//
//   scanning -> (pocketlink pairing QR) -> connecting to <name> -> paired -> back
//   scanning -> (pocketlink install QR) -> the install page, in the scanner's place
//
// Either entry takes either code: a pairing code pairs, an install code goes
// to its confirmation page when the console can install from a code. Any
// other code leaves the scanner running with a hint.

import { createSignal, onCleanup, Show, type Accessor } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";
import { after } from "@pocketjs/framework/clock";
import { closeCamera, openCamera, pollQrCode } from "@pocketjs/framework/camera";
import { isPairingUri } from "@pocketjs/framework/link";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { registerTexture } from "@pocketjs/framework/renderer";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { isInstallCode, LINK_PAIRING, type HomeSystem } from "./system.ts";
import { NAV_H } from "../ui/bar.tsx";
import type { NavStack, PageSpec } from "../ui/nav.tsx";
import { COMPACT, SCREEN_H, SCREEN_W, TALL } from "../ui/screen.ts";
import { ellipsize, FONT, toAscii } from "../ui/text.ts";

export const PREVIEW_KEY = "camera.preview";

export type ScanState =
  | { t: "scanning"; hint: string }
  | { t: "connecting"; name: string }
  | { t: "paired"; name: string }
  | { t: "failed"; name: string; message: string }
  | { t: "unavailable" };

/** The companion name a pairing URI carries (its `n` parameter). */
export function pairingName(uri: string): string {
  const query = uri.slice(uri.indexOf("?") + 1);
  for (const part of query.split("&")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at) === "n") {
      try {
        return toAscii(decodeURIComponent(part.slice(at + 1).replace(/\+/g, " "))) || "Mac";
      } catch {
        return "Mac";
      }
    }
  }
  return "Mac";
}

/** The camera image's size in its 512x256 preview texture. */
const IMAGE_W = 320;
const IMAGE_H = 240;

/** Pair a Mac (Settings), or install an app from a code (the store). */
export type ScanPurpose = "pair" | "install";

const IDLE_HINT: Record<ScanPurpose, string> = {
  pair: "Point the camera at the code on your Mac",
  install: "Point the camera at an install code",
};

export function scannerPage(
  sys: HomeSystem,
  stack: NavStack,
  setScan: (state: ScanState) => void,
  scan: Accessor<ScanState>,
  purpose: ScanPurpose = "pair",
): PageSpec {
  // The preview fills the 3DS's screen behind the bar. A landscape surface
  // shows it under the bar as tall as the space there, centred, with the pill
  // over its foot; a portrait one scales it to its width, the pill below.
  const zoom = COMPACT ? 1 : TALL ? SCREEN_W / IMAGE_W : (SCREEN_H - NAV_H) / IMAGE_H;
  const previewX = Math.round((SCREEN_W - IMAGE_W * zoom) / 2);
  const previewY = COMPACT ? 0 : TALL ? NAV_H + 24 : NAV_H;
  const previewBottom = previewY + Math.round(IMAGE_H * zoom);
  const BOX = Math.round(150 * zoom);
  const BOX_X = Math.round(previewX + (IMAGE_W * zoom - BOX) / 2);
  const BOX_Y = COMPACT ? 46 : Math.round(previewY + (IMAGE_H * zoom - BOX) / 2);
  const dimTop = Math.max(previewY, NAV_H);
  const pillY = COMPACT ? 204 : TALL ? previewBottom + 24 : SCREEN_H - 40;
  const handle = openCamera();
  if (handle >= 0) registerTexture(PREVIEW_KEY, handle);
  setScan(handle >= 0 ? { t: "scanning", hint: "" } : { t: "unavailable" });
  let hintFrames = 0;
  let leaving = false;

  let disposed = false;
  onCleanup(() => {
    disposed = true;
    closeCamera();
  });

  onFrame(() => {
    const state = scan();
    if (state.t === "unavailable" || leaving) return;
    if (state.t === "scanning" || state.t === "failed") {
      if (hintFrames > 0 && --hintFrames === 0 && state.t === "scanning") setScan({ t: "scanning", hint: "" });
      if (stack.busy()) return; // a code read mid-slide waits for the stack to settle
      const code = pollQrCode();
      if (code === undefined) return;
      if (isInstallCode(code)) {
        if (sys.canInstallCode() && sys.offerCode(code)) {
          // The install page takes the scanner's place, which closes the camera.
          leaving = true;
          stack.replace("install.code");
          return;
        }
        hintFrames = 120;
        setScan({ t: "scanning", hint: sys.canInstallCode() ? "That install code could not be read." : "This console cannot install from a code." });
        return;
      }
      if (!isPairingUri(code)) {
        hintFrames = 120;
        setScan({ t: "scanning", hint: purpose === "pair" ? "That code is not a Pocket pairing code." : "That code is not a Pocket code." });
        return;
      }
      const name = pairingName(code);
      if (sys.pair(code)) setScan({ t: "connecting", name });
      else setScan({ t: "failed", name, message: "The pairing code could not be read." });
      return;
    }
    if (state.t === "connecting") {
      const pairing = sys.link().pairing;
      if (pairing === LINK_PAIRING.paired) {
        setScan({ t: "paired", name: sys.link().companion?.name ?? state.name });
        leaving = true;
        // Back to the Mac page, unless the user already left the scanner.
        after(1.2, () => !disposed && stack.top()?.page.startsWith("scan") && stack.pop());
      } else if (pairing === LINK_PAIRING.failed) {
        setScan({ t: "failed", name: state.name, message: sys.link().error || "The Mac refused the pairing." });
      }
    }
  });

  const pill = () => {
    const state = scan();
    switch (state.t) {
      case "scanning":
        return state.hint || IDLE_HINT[purpose];
      case "connecting":
        return ellipsize(`Connecting to ${state.name}...`, FONT.smBold, SCREEN_W - 80);
      case "paired":
        return ellipsize(`Paired with ${state.name}`, FONT.smBold, SCREEN_W - 80);
      case "failed":
        return ellipsize(state.message, FONT.smBold, SCREEN_W - 50);
      default:
        return "";
    }
  };

  return {
    title: () => (purpose === "pair" ? "Pair a Mac" : "Scan a Code"),
    backLabel: "Scan",
    tint: "black",
    bare: true,
    fixed: () => (
      <>
        <View class="absolute left-0 top-0 bg-black overflow-hidden" style={{ width: SCREEN_W, height: SCREEN_H }}>
          <Show when={scan().t !== "unavailable"}>
            <Image class="absolute" src={PREVIEW_KEY} style={{ insetL: previewX, insetT: previewY, width: 512 * zoom, height: 256 * zoom }} />
          </Show>
          <View class="absolute left-0 bg-black" style={{ insetT: previewBottom, width: SCREEN_W, height: SCREEN_H - previewBottom }} />
          <View class="absolute top-0 bg-black" style={{ insetL: previewX + Math.round(IMAGE_W * zoom), width: SCREEN_W, height: SCREEN_H }} />
        </View>
        <Show when={scan().t === "unavailable"}>
          <Image class="absolute top-[80] w-[48] h-[48]" src="art/camera.svg" style={{ insetL: (SCREEN_W - 48) / 2 }} />
          <Text class="absolute left-0 top-[136] text-sm text-white font-bold text-center" style={{ width: SCREEN_W }}>Camera unavailable</Text>
          <Text class="absolute left-0 top-[156] text-xs text-[#ffffffa0] text-center" style={{ width: SCREEN_W }}>This console did not start its outer camera.</Text>
        </Show>
        <Show when={scan().t !== "unavailable"}>
          {/* the viewfinder: dim the picture outside the square, bracket its corners */}
          <View class="absolute bg-[#00000070]" style={{ insetL: previewX, insetT: dimTop, width: SCREEN_W - 2 * previewX, height: BOX_Y - dimTop }} />
          <View class="absolute bg-[#00000070]" style={{ insetL: previewX, insetT: BOX_Y + BOX, width: SCREEN_W - 2 * previewX, height: previewBottom - BOX_Y - BOX }} />
          <View class="absolute bg-[#00000070]" style={{ insetL: previewX, insetT: BOX_Y, width: BOX_X - previewX, height: BOX }} />
          <View class="absolute bg-[#00000070]" style={{ insetL: BOX_X + BOX, insetT: BOX_Y, width: SCREEN_W - previewX - BOX_X - BOX, height: BOX }} />
          <View class={scan().t === "paired" ? "absolute w-[22] h-[4] bg-[#5fd35f]" : "absolute w-[22] h-[4] bg-white"} style={{ insetL: BOX_X - 2, insetT: BOX_Y - 2 }} />
          <View class={scan().t === "paired" ? "absolute w-[4] h-[22] bg-[#5fd35f]" : "absolute w-[4] h-[22] bg-white"} style={{ insetL: BOX_X - 2, insetT: BOX_Y - 2 }} />
          <View class={scan().t === "paired" ? "absolute w-[22] h-[4] bg-[#5fd35f]" : "absolute w-[22] h-[4] bg-white"} style={{ insetL: BOX_X + BOX - 20, insetT: BOX_Y - 2 }} />
          <View class={scan().t === "paired" ? "absolute w-[4] h-[22] bg-[#5fd35f]" : "absolute w-[4] h-[22] bg-white"} style={{ insetL: BOX_X + BOX - 2, insetT: BOX_Y - 2 }} />
          <View class={scan().t === "paired" ? "absolute w-[22] h-[4] bg-[#5fd35f]" : "absolute w-[22] h-[4] bg-white"} style={{ insetL: BOX_X - 2, insetT: BOX_Y + BOX - 2 }} />
          <View class={scan().t === "paired" ? "absolute w-[4] h-[22] bg-[#5fd35f]" : "absolute w-[4] h-[22] bg-white"} style={{ insetL: BOX_X - 2, insetT: BOX_Y + BOX - 20 }} />
          <View class={scan().t === "paired" ? "absolute w-[22] h-[4] bg-[#5fd35f]" : "absolute w-[22] h-[4] bg-white"} style={{ insetL: BOX_X + BOX - 20, insetT: BOX_Y + BOX - 2 }} />
          <View class={scan().t === "paired" ? "absolute w-[4] h-[22] bg-[#5fd35f]" : "absolute w-[4] h-[22] bg-white"} style={{ insetL: BOX_X + BOX - 2, insetT: BOX_Y + BOX - 20 }} />
          <Show when={scan().t === "paired"}>
            <View class="absolute w-[64] h-[64] rounded-[32] bg-[#3fae3fd0]" style={{ insetL: SCREEN_W / 2 - 32, insetT: BOX_Y + BOX / 2 - 32 }} />
            <Image class="absolute w-[40] h-[40]" src="art/checkmark-big.svg" style={{ insetL: SCREEN_W / 2 - 20, insetT: BOX_Y + BOX / 2 - 20 }} />
          </Show>
          {/* status pill */}
          <View
            class={scan().t === "failed" || (scan().t === "scanning" && pill() !== IDLE_HINT[purpose])
              ? "absolute h-[28] rounded-[14] bg-[#b3261ee0] border border-[#ffffff50]"
              : "absolute h-[28] rounded-[14] bg-[#000000b0] border border-[#ffffff40]"}
            style={{ insetL: previewX + 12, insetT: pillY, width: SCREEN_W - 2 * previewX - 24 }}
          />
          <Show when={scan().t === "connecting"}>
            <View class="absolute" style={{ insetL: previewX + 22, insetT: pillY + 6 }}>
              <ClassicSpinner size={16} color={"#ffffff"} />
            </View>
          </Show>
          <Text class="absolute text-sm text-white font-bold text-center" style={{ insetL: previewX + 12, insetT: pillY + 5, width: SCREEN_W - 2 * previewX - 24 }}>{pill()}</Text>
          <Show when={TALL}>
            <Text class="absolute left-[20] text-xs text-[#ffffff90] text-center" style={{ insetT: pillY + 44, width: SCREEN_W - 40 }}>
              {purpose === "pair" ? "On your Mac, open Pocket Companion\nand choose Pair a Console..." : "A web page that offers an app\nshows its install code."}
            </Text>
          </Show>
        </Show>
      </>
    ),
  };
}
