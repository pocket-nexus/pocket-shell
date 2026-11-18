// SPDX-License-Identifier: GPL-3.0-or-later
// ui/chrome.tsx — iOS 6 chrome at the 3DS's 0.82 scale: the
// pinstriped grouped background, ON/OFF switches, the status bar and the
// wallpaper both screens share. The glossy icon tiles are ui/icons.tsx. The navigation bar lives
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
