// SPDX-License-Identifier: GPL-3.0-only
import { createRenderEffect, onCleanup } from "solid-js";
import { Image } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import { decodeNativeIcon, validNativeIcon } from "./host-files.ts";

/** Mounted rows own their textures. Scrolling, navigation and window disposal
 * release them, so the GPU budget follows the visible rows, not the app count. */
export function NativeAppIcon(props: { rgba?: string; fallback: string }) {
  return <>{validNativeIcon(props.rgba) ? <Image class="w-[16] h-[16] mr-[4]" ref={node => {
    createRenderEffect(() => {
      if (!validNativeIcon(props.rgba)) return;
      const ops = getOps();
      const handle = ops.uploadTexture(decodeNativeIcon(props.rgba), 32, 32, 3); // RGBA8888
      if (handle < 0) return;
      ops.setImage(node.id, handle);
      onCleanup(() => ops.freeTexture?.(handle));
    });
  }} /> : <Image class="w-[16] h-[16] mr-[4]" src={props.fallback} />}</>;
}
