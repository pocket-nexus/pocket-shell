// SPDX-License-Identifier: GPL-3.0-or-later
// ui/icons.tsx — the icon family's index and the tile that draws it: the
// launcher's own icons (Settings, Mac, Wi-Fi, Apps) and every applet's, baked
// by tools/icons into art/icons.
//
// Only the launcher imports this module. A build packs every image path that
// appears as a string in the bundle, so an applet that reached this table
// would carry the whole family in its pak; ui/table.tsx draws a row's picture
// through the cell's `leading` instead of importing Tile.

import { Show, type Accessor } from "solid-js";
import { Image, View } from "@pocketjs/framework/components";

/** Icons rendered in Blender (tools/icons/icons.py) and finished by
 *  tools/icons/bake.ts into art/icons: the picture, the gloss, the rim and,
 *  at 46, the drop shadow are all in the texture. An applet's icon.png is a
 *  link to its 64@2x texture, so the store, the package and the launcher
 *  show one picture. */
export type IconArt =
  | "settings" | "mac" | "wifi" | "apps" | "hn" | "nexus" | "youtube" | "x" | "discord" | "camera" | "photos"
  | "github" | "weather" | "podcasts" | "maps" | "homeassistant" | "spotify" | "notes" | "appstore";

/** Corner radius as a fraction of the side (tools/icons/bake.ts ICON_RADIUS). */
const ICON_RADIUS = 0.2;

/** Each icon's textures: [icon side, texture side, path]. The icon sits in
 *  the middle of its texture, which leaves room for the shadow. */
type Variant = readonly [icon: number, tex: number, src: string];
const ART: Record<IconArt | "plain", readonly Variant[]> = {
  settings: [[24, 32, "art/icons/settings-24.png"], [46, 64, "art/icons/settings-46.png"]],
  mac: [[24, 32, "art/icons/mac-24.png"], [46, 64, "art/icons/mac-46.png"]],
  wifi: [[24, 32, "art/icons/wifi-24.png"]],
  apps: [[24, 32, "art/icons/apps-24.png"]],
  hn: [[24, 32, "art/icons/hn-24.png"], [46, 64, "art/icons/hn-46.png"], [64, 64, "art/icons/hn-64.png"]],
  nexus: [[24, 32, "art/icons/nexus-24.png"], [46, 64, "art/icons/nexus-46.png"], [64, 64, "art/icons/nexus-64.png"]],
  youtube: [[24, 32, "art/icons/youtube-24.png"], [46, 64, "art/icons/youtube-46.png"], [64, 64, "art/icons/youtube-64.png"]],
  x: [[24, 32, "art/icons/x-24.png"], [46, 64, "art/icons/x-46.png"], [64, 64, "art/icons/x-64.png"]],
  discord: [[24, 32, "art/icons/discord-24.png"], [46, 64, "art/icons/discord-46.png"], [64, 64, "art/icons/discord-64.png"]],
  camera: [[24, 32, "art/icons/camera-24.png"], [46, 64, "art/icons/camera-46.png"], [64, 64, "art/icons/camera-64.png"]],
  photos: [[24, 32, "art/icons/photos-24.png"], [46, 64, "art/icons/photos-46.png"], [64, 64, "art/icons/photos-64.png"]],
  github: [[24, 32, "art/icons/github-24.png"], [46, 64, "art/icons/github-46.png"], [64, 64, "art/icons/github-64.png"]],
  weather: [[24, 32, "art/icons/weather-24.png"], [46, 64, "art/icons/weather-46.png"], [64, 64, "art/icons/weather-64.png"]],
  podcasts: [[24, 32, "art/icons/podcasts-24.png"], [46, 64, "art/icons/podcasts-46.png"], [64, 64, "art/icons/podcasts-64.png"]],
  maps: [[24, 32, "art/icons/maps-24.png"], [46, 64, "art/icons/maps-46.png"], [64, 64, "art/icons/maps-64.png"]],
  homeassistant: [[24, 32, "art/icons/homeassistant-24.png"], [46, 64, "art/icons/homeassistant-46.png"], [64, 64, "art/icons/homeassistant-64.png"]],
  spotify: [[24, 32, "art/icons/spotify-24.png"], [46, 64, "art/icons/spotify-46.png"], [64, 64, "art/icons/spotify-64.png"]],
  notes: [[24, 32, "art/icons/notes-24.png"], [46, 64, "art/icons/notes-46.png"], [64, 64, "art/icons/notes-64.png"]],
  appstore: [[24, 32, "art/icons/appstore-24.png"], [46, 64, "art/icons/appstore-46.png"], [64, 64, "art/icons/appstore-64.png"]],
  /** The finish alone, over the tint and glyph of an app that ships no icon. */
  plain: [[24, 32, "art/icons/plain-24.png"], [46, 64, "art/icons/plain-46.png"], [64, 64, "art/icons/plain-64.png"]],
};

/** The texture drawn for a tile `size` px wide: the smallest one that is not
 *  magnified by more than 5%, else the largest. */
function variant(art: IconArt | "plain", size: number): Variant {
  const list = ART[art];
  return list.find(([icon]) => icon >= size * 0.95) ?? list[list.length - 1]!;
}

/** Icon art by app id, for the apps that ship a picture. */
const APP_ART: Record<string, IconArt> = {
  "dev.pocket-nexus.hn": "hn",
  "dev.pocket-nexus.nexus": "nexus",
  "dev.pocket-nexus.youtube": "youtube",
  "dev.pocket-nexus.x": "x",
  "dev.pocket-nexus.discord": "discord",
  "dev.pocket-nexus.camera": "camera",
  "dev.pocket-nexus.photos": "photos",
  "dev.pocket-nexus.github": "github",
  "dev.pocket-nexus.weather": "weather",
  "dev.pocket-nexus.podcasts": "podcasts",
  "dev.pocket-nexus.maps": "maps",
  "dev.pocket-nexus.homeassistant": "homeassistant",
  "dev.pocket-nexus.spotify": "spotify",
  "dev.pocket-nexus.notes": "notes",
  "dev.pocket-nexus.store": "appstore",
};

export interface TileProps {
  x: number;
  y: number;
  size: number;
  /** A baked icon of the launcher's own. */
  art?: IconArt;
  /** The tint of an app that ships no icon. */
  from?: string;
  to?: string;
  /** Darkened while pressed. */
  dim?: Accessor<boolean>;
}

/** An iOS 6 icon: a baked picture, or for an app without one, the tint
 *  gradient and the four-square applet glyph under the same baked gloss, rim
 *  and shadow; a darkening wash while pressed. Never an app's initials. */
export function Tile(props: TileProps) {
  const r = Math.round(props.size * ICON_RADIUS);
  const finish = (art: IconArt | "plain") => {
    const [icon, tex, src] = variant(art, props.size);
    const scale = props.size / icon;
    const pad = ((tex - icon) / 2) * scale;
    return <Image class="absolute" src={src} style={{ insetL: props.x - pad, insetT: props.y - pad, width: tex * scale, height: tex * scale }} />;
  };
  // The glyph: two by two rounded squares, 0.2 of the side each.
  const cell = Math.round(props.size * 0.2), gap = Math.max(2, Math.round(props.size * 0.08));
  const glyph = (column: number, row: number) => (
    <View
      class="absolute bg-[#ffffffd9]"
      style={{
        insetL: props.x + (props.size - 2 * cell - gap) / 2 + column * (cell + gap),
        insetT: props.y + (props.size - 2 * cell - gap) / 2 + row * (cell + gap),
        width: cell, height: cell, radius: Math.max(1, Math.round(cell * 0.3)),
      }}
    />
  );
  return (
    <>
      <Show when={props.art} fallback={
        <>
          <View
            class="absolute"
            style={{ insetL: props.x, insetT: props.y, width: props.size, height: props.size, radius: r, gradDir: 1, gradFrom: props.from ?? "#a9b0b9", gradTo: props.to ?? "#5b636d" }}
          />
          {glyph(0, 0)}
          {glyph(1, 0)}
          {glyph(0, 1)}
          {glyph(1, 1)}
          {finish("plain")}
        </>
      }>
        {(art) => finish(art())}
      </Show>
      <View
        class={props.dim?.() ? "absolute bg-[#00000070]" : "hidden"}
        style={{ insetL: props.x, insetT: props.y, width: props.size, height: props.size, radius: r }}
      />
    </>
  );
}

export interface AppTint {
  art?: IconArt;
  from: string;
  to: string;
}

/** An app's icon: the launcher's baked art for its own applets, else a
 *  deterministic tint of its id under the applet glyph. */
export function appTint(id: string): AppTint {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193) >>> 0;
  const hue = hash % 360;
  return { art: APP_ART[id], from: hsl(hue, 0.62, 0.62), to: hsl(hue, 0.7, 0.36) };
}

function hsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}
