// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/chrome.tsx — iOS 6 chrome at the 3DS's 0.82 scale: the
// pinstriped grouped background, ON/OFF switches, glossy icon tiles, the
// status bar and the wallpaper both screens share. The navigation bar lives
// in bar.tsx, which names no image, so an app that only needs the bar (Hacker
// News) bakes none of these textures.
//
// Every element is absolutely placed by its caller through `style`, and every
// `class` is one complete literal — the compiler bakes a class table, so a
// state change picks between two whole literals instead of building one.

import { Show, type Accessor, type JSX } from "solid-js";
import { animationClass } from "@pocketjs/framework/animation";
import { Image, Text, View } from "@pocketjs/framework/components";
import { COMPACT, SCREEN_H, SCREEN_W } from "./screen.ts";

// ---- backgrounds -----------------------------------------------------------------

/** The step between copies of the 256 px stripe texture: 42 of its 6 px
 *  periods, so each copy continues the one before. */
const STRIPE_STEP = 252;
/** The stripe texture's rows; every row is the same, so copies stack at
 *  this step. */
const STRIPE_ROWS = 64;

/** The grouped-table pinstripes: a 256x64 RGB565 texture tiled over the box
 *  at its own size. A stretched copy would be cheaper to describe, but a
 *  repaint target without a compositor samples a scaled quad per pixel;
 *  tiles copy. */
export function Pinstripes(props: { width: number; height: number }) {
  const columns = Array.from({ length: Math.ceil(props.width / STRIPE_STEP) }, (_, index) => index * STRIPE_STEP);
  const rows = Array.from({ length: Math.ceil(props.height / STRIPE_ROWS) }, (_, index) => index * STRIPE_ROWS);
  return (
    <View class="absolute left-0 top-0 overflow-hidden" style={{ width: props.width, height: props.height }}>
      {columns.map((x) => rows.map((y) => (
        <Image class="absolute w-[256] h-[64]" src="art/stripes.svg" style={{ insetL: x, insetT: y }} />
      )))}
    </View>
  );
}

/** A soft radial glow: a 64 px texture of stacked translucent discs,
 *  magnified with linear filtering so its rings blur into a gradient. */
function Glow(props: { x: number; y: number; r: number; color: "teal" | "violet" | "white" }) {
  return (
    <Image
      class="absolute"
      src={props.color === "teal" ? "art/glow-teal.svg" : props.color === "violet" ? "art/glow-violet.svg" : "art/glow-white.svg"}
      style={{ insetL: props.x - props.r, insetT: props.y - props.r, width: props.r * 2, height: props.r * 2 }}
    />
  );
}

/** One flat disc of the portrait wallpaper. */
function Disc(props: { x: number; y: number; r: number; color: string }) {
  return (
    <View
      class="absolute"
      style={{ insetL: props.x - props.r, insetT: props.y - props.r, width: props.r * 2, height: props.r * 2, radius: props.r, bgColor: props.color }}
    />
  );
}

/** The wallpaper of a surface larger than the 3DS's: overlapping flat
 *  discs on a flat field, in the 3DS wallpaper's navy, teal and violet. An
 *  RGB565 panel draws a smooth gradient this large as visible steps; flat
 *  fills draw clean. On a repaint target the field stays bare: a disc this
 *  large is a sampled texture over most of the surface, which a CPU
 *  repaints under every moving icon and on every full frame. */
function FlatWallpaper() {
  const big = Math.max(SCREEN_W, SCREEN_H);
  return (
    <View class="absolute left-0 top-0 overflow-hidden bg-[#0c1a2b]" style={{ width: SCREEN_W, height: SCREEN_H }}>
      <Show when={animationClass === "composited"}>
        <Disc x={SCREEN_W * 0.08} y={SCREEN_H * 0.24} r={big * 0.4} color="#103a55" />
        <Disc x={SCREEN_W * 0.98} y={SCREEN_H * 0.84} r={big * 0.36} color="#222a5a" />
        <Disc x={SCREEN_W * 0.86} y={SCREEN_H * 0.2} r={big * 0.18} color="#16506c" />
        <Disc x={SCREEN_W * 0.18} y={SCREEN_H * 0.76} r={big * 0.14} color="#2f2c63" />
      </Show>
    </View>
  );
}

/** The wallpaper, drawn as one picture across both screens: the top screen
 *  is its upper 240 px, the bottom screen continues below the hinge. A
 *  larger surface has its own (FlatWallpaper). */
export function Wallpaper(props: { screen: "top" | "bottom" }) {
  if (!COMPACT && props.screen === "bottom") return FlatWallpaper();
  const top = props.screen === "top";
  return (
    <View
      class={top
        ? "absolute left-0 top-0 w-[400] h-[240] overflow-hidden bg-gradient-to-b from-[#0b1730] via-[#173a63] to-[#1f5277]"
        : "absolute left-0 top-0 w-[320] h-[240] overflow-hidden bg-gradient-to-b from-[#1f5277] via-[#1c4466] to-[#0d1a2c]"}
    >
      {top
        ? <>
            <Glow x={330} y={40} r={150} color="violet" />
            <Glow x={60} y={260} r={170} color="teal" />
            <Glow x={200} y={110} r={90} color="white" />
          </>
        : <>
            <Glow x={20} y={20} r={170} color="teal" />
            <Glow x={300} y={200} r={140} color="violet" />
          </>}
    </View>
  );
}

// ---- status bar ------------------------------------------------------------------

export interface StatusBarProps {
  width: number;
  carrier: string;
  /** 0..3 Wi-Fi bars; -1 hides the fan (radio off). */
  bars: Accessor<number>;
  time: Accessor<string>;
  /** Opaque iOS 6 grey (Settings) instead of black translucent (lock screen). */
  opaque?: boolean;
}

/** The 16 px status bar: carrier and Wi-Fi bars on the left, the time on
 *  the right. The centre stays empty: in single-screen mode the system draws
 *  its notch there (x 124..196). */
export function StatusBar(props: StatusBarProps) {
  const bar = (index: number, x: number, h: number) => (
    <View
      class={props.bars() > index ? "absolute w-[3] bg-white" : "absolute w-[3] bg-[#ffffff40]"}
      style={{ insetL: x, insetT: 12 - h, height: h }}
    />
  );
  return (
    <View
      class={props.opaque
        ? "absolute left-0 top-0 h-[16] bg-gradient-to-b from-[#4a5a71] to-[#25303f]"
        : "absolute left-0 top-0 h-[16] bg-[#00000090]"}
      style={{ width: props.width }}
    >
      <Text class="absolute left-[5] top-[1] text-xs text-white font-bold">{props.carrier}</Text>
      <View class={props.bars() < 0 ? "hidden" : "absolute left-[50] top-[2] w-[16] h-[12]"}>
        {bar(0, 0, 4)}
        {bar(1, 4, 7)}
        {bar(2, 8, 10)}
      </View>
      <Text class="absolute top-[1] text-xs text-white font-bold text-right" style={{ insetL: props.width - 106, width: 100 }}>{props.time()}</Text>
    </View>
  );
}

// ---- icon tiles ------------------------------------------------------------------

/** Icons rendered in Blender (art/icons/icons.py) and finished by
 *  art/icons/bake.ts: the picture, the gloss, the rim and, at 46, the drop
 *  shadow are all in the texture. */
export type IconArt = "settings" | "mac" | "wifi" | "apps" | "hn" | "nexus" | "youtube" | "x" | "discord" | "camera" | "photos";

/** Corner radius as a fraction of the side (art/icons/bake.ts ICON_RADIUS). */
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
  /** The finish alone, over an app's own icon or the tint of one that ships none. */
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
};

export interface TileProps {
  x: number;
  y: number;
  size: number;
  /** A baked icon of Home's own. */
  art?: IconArt;
  /** An app's own icon for a tile `size` px wide (home/app-icon.ts), or null
   *  when its package carries none. */
  picture?: (size: number) => TilePicture | null;
  /** The tint of an app whose package carries no icon. */
  from?: string;
  to?: string;
  /** Darkened while pressed. */
  dim?: Accessor<boolean>;
}

/** An app's own icon: a registered texture of side `texture` with the
 *  `icon`-sided picture in its middle, cut to the tile's rounded square. */
export interface TilePicture {
  src: string;
  icon: number;
  texture: number;
}

/** An iOS 6 icon: a baked picture, an app's own icon under the baked gloss,
 *  rim and shadow, or for an app without one, the tint gradient and the
 *  four-square applet glyph under them; a darkening wash while pressed.
 *  Never an app's initials. */
export function Tile(props: TileProps) {
  const r = Math.round(props.size * ICON_RADIUS);
  const square = (texture: number, icon: number, src: string) => {
    const scale = props.size / icon;
    const pad = ((texture - icon) / 2) * scale;
    return <Image class="absolute" src={src} style={{ insetL: props.x - pad, insetT: props.y - pad, width: texture * scale, height: texture * scale }} />;
  };
  const finish = (art: IconArt | "plain") => {
    const [icon, tex, src] = variant(art, props.size);
    return square(tex, icon, src);
  };
  const packaged = () => props.picture?.(props.size) ?? null;
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
        <Show when={packaged()} fallback={
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
          {(icon) => (
            <>
              {square(icon().texture, icon().icon, icon().src)}
              {finish("plain")}
            </>
          )}
        </Show>
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
  picture?: TileProps["picture"];
  from: string;
  to: string;
}

/** An app's tile without its package: Home's baked art for its own applets,
 *  else a deterministic tint under the applet glyph. home/app-icon.ts adds
 *  the icon an installed package carries. */
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

// ---- switch ----------------------------------------------------------------------

export const SWITCH_W = 62;
export const SWITCH_H = 22;

/** The iOS 6 ON/OFF switch: a blue "ON" or grey "OFF" pill and a white knob. */
export function Switch(props: { x: number; y: number; on: Accessor<boolean> }) {
  return (
    <>
      <View
        class={props.on()
          ? "absolute w-[62] h-[22] rounded-[11] border border-[#1b4fa3] bg-gradient-to-b from-[#1d5bc6] via-[#3a84ea] to-[#5aa0f4]"
          : "absolute w-[62] h-[22] rounded-[11] border border-[#a9a9a9] bg-gradient-to-b from-[#d5d5d5] via-[#ececec] to-[#fbfbfb]"}
        style={{ insetL: props.x, insetT: props.y }}
      />
      <Text
        class={props.on() ? "absolute text-xs text-white font-bold text-center" : "absolute text-xs text-[#7f7f7f] font-bold text-center"}
        style={{ insetL: props.on() ? props.x + 6 : props.x + 26, insetT: props.y + 4, width: 30 }}
      >
        {props.on() ? "ON" : "OFF"}
      </Text>
      <View
        class="absolute w-[22] h-[22] rounded-[11] border border-[#9c9c9c] bg-gradient-to-b from-[#ffffff] to-[#dcdcdc]"
        style={{ insetL: props.on() ? props.x + SWITCH_W - SWITCH_H : props.x, insetT: props.y }}
      />
    </>
  );
}

/** Wi-Fi strength as three rising bars (lit: 0..3). */
export function Bars(props: { x: number; y: number; level: Accessor<number>; white?: Accessor<boolean> }) {
  const bar = (index: number, h: number) => (
    <View
      class={props.white?.()
        ? props.level() > index ? "absolute w-[3] bg-white" : "absolute w-[3] bg-[#ffffff60]"
        : props.level() > index ? "absolute w-[3] bg-[#38547f]" : "absolute w-[3] bg-[#c0c6ce]"}
      style={{ insetL: props.x + index * 4, insetT: props.y + 10 - h, height: h }}
    />
  );
  return <>{bar(0, 4)}{bar(1, 7)}{bar(2, 10)}</>;
}

export type Children = JSX.Element;
