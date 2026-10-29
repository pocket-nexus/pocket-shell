// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/home/app-icon.ts — an installed app's tile: the icon its package
// carries (package section 9, @pocketjs/framework/launcher appIcon), else
// Home's tint and glyph. Home's own module: applets share ui/chrome.tsx but
// not the launcher API.

import { appIcon, type AppEntry } from "@pocketjs/framework/launcher";
import { registerTexture } from "@pocketjs/framework/renderer";
import { appTint, type AppTint } from "../ui/chrome.tsx";

/** The tile of app `id`; `installed` is its app table row, absent for a
 *  catalog app that is not installed. */
export function appTile(id: string, installed?: AppEntry): AppTint {
  const tint = appTint(id);
  if (!installed || tint.art) return tint;
  return {
    ...tint,
    picture(size) {
      const icon = appIcon(installed, size);
      if (!icon) return null;
      const src = `app-icon-${icon.handle}`;
      registerTexture(src, icon.handle);
      return { src, icon: icon.icon, texture: icon.texture };
    },
  };
}
