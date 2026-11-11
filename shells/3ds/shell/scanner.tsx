// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/shell/scanner.tsx — the install-code scanner: the store's Scan a
// Code... on a console that downloads apps by itself. The outer camera's live
// preview under a viewfinder (1:1 on the 3DS's touch screen; on a larger
// surface scaled to the height under the bar, or to the width in portrait),
// and the console's QR decoder polled every frame.
//
//   scanning -> (pocketlink install QR) -> the install page, in the scanner's place
//
// It reads install codes only. A console is paired by Pocket Hub, which
// writes the pairing onto its storage (PocketJS docs/POCKET-LINK.md §3), so
// no code pairs one; any other code leaves the scanner running with a hint.

import { onCleanup, Show, type Accessor } from "solid-js";
import { Image, Text, View } from "@pocketjs/framework/components";
import { closeCamera, openCamera, pollQrCode } from "@pocketjs/framework/camera";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { registerTexture } from "@pocketjs/framework/renderer";
import { isInstallCode, type ShellSystem } from "./system.ts";
import { NAV_H } from "../ui/bar.tsx";
import type { NavStack, PageSpec } from "../ui/nav.tsx";
import { COMPACT, SCREEN_H, SCREEN_W, TALL } from "../ui/screen.ts";

export const PREVIEW_KEY = "camera.preview";

export type ScanState = { t: "scanning"; hint: string } | { t: "unavailable" };

/** The camera image's size in its 512x256 preview texture. */
const IMAGE_W = 320;
const IMAGE_H = 240;

const IDLE_HINT = "Point the camera at an install code";

export function scannerPage(
  sys: ShellSystem,
  stack: NavStack,
  setScan: (state: ScanState) => void,
  scan: Accessor<ScanState>,
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

  onCleanup(() => closeCamera());

  onFrame(() => {
    const state = scan();
    if (state.t === "unavailable" || leaving) return;
    if (hintFrames > 0 && --hintFrames === 0) setScan({ t: "scanning", hint: "" });
    if (stack.busy()) return; // a code read mid-slide waits for the stack to settle
    const code = pollQrCode();
    if (code === undefined) return;
    if (isInstallCode(code) && sys.canInstallCode() && sys.offerCode(code)) {
      // The install page takes the scanner's place, which closes the camera.
      leaving = true;
      stack.replace("install.code");
      return;
    }
    hintFrames = 120;
    setScan({
      t: "scanning",
      hint: !isInstallCode(code)
        ? "That code is not an install code."
        : sys.canInstallCode()
          ? "That install code could not be read."
          : "This console cannot install from a code.",
    });
  });

  const pill = () => {
    const state = scan();
    return state.t === "scanning" ? state.hint || IDLE_HINT : "";
  };

  return {
    title: () => "Scan a Code",
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
          <View class="absolute w-[22] h-[4] bg-white" style={{ insetL: BOX_X - 2, insetT: BOX_Y - 2 }} />
          <View class="absolute w-[4] h-[22] bg-white" style={{ insetL: BOX_X - 2, insetT: BOX_Y - 2 }} />
          <View class="absolute w-[22] h-[4] bg-white" style={{ insetL: BOX_X + BOX - 20, insetT: BOX_Y - 2 }} />
          <View class="absolute w-[4] h-[22] bg-white" style={{ insetL: BOX_X + BOX - 2, insetT: BOX_Y - 2 }} />
          <View class="absolute w-[22] h-[4] bg-white" style={{ insetL: BOX_X - 2, insetT: BOX_Y + BOX - 2 }} />
          <View class="absolute w-[4] h-[22] bg-white" style={{ insetL: BOX_X - 2, insetT: BOX_Y + BOX - 20 }} />
          <View class="absolute w-[22] h-[4] bg-white" style={{ insetL: BOX_X + BOX - 20, insetT: BOX_Y + BOX - 2 }} />
          <View class="absolute w-[4] h-[22] bg-white" style={{ insetL: BOX_X + BOX - 2, insetT: BOX_Y + BOX - 20 }} />
          {/* status pill */}
          <View
            class={pill() !== IDLE_HINT
              ? "absolute h-[28] rounded-[14] bg-[#b3261ee0] border border-[#ffffff50]"
              : "absolute h-[28] rounded-[14] bg-[#000000b0] border border-[#ffffff40]"}
            style={{ insetL: previewX + 12, insetT: pillY, width: SCREEN_W - 2 * previewX - 24 }}
          />
          <Text class="absolute text-sm text-white font-bold text-center" style={{ insetL: previewX + 12, insetT: pillY + 5, width: SCREEN_W - 2 * previewX - 24 }}>{pill()}</Text>
          <Show when={TALL}>
            <Text class="absolute left-[20] text-xs text-[#ffffff90] text-center" style={{ insetT: pillY + 44, width: SCREEN_W - 40 }}>
              {"A web page that offers an app\nshows its install code."}
            </Text>
          </Show>
        </Show>
      </>
    ),
  };
}
