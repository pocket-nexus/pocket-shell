// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/screen.ts — the one place a program learns the surface it
// draws on. Every manifest declares an adaptive auxiliary surface (from
// 320x240 up) and the host presents its own size, so the size is read at run
// time:
//
//   320x240 landscape   the 3DS touch screen: the layouts drawn for it
//   portrait (TALL)     such as the M5Stack Tab5's 360x592 (a 5" panel at
//                       density 2): iOS 6 phone layouts
//
// The size is read once, by readScreen(), which every program's main.tsx
// calls first thing in its root component: auxiliaryViewport() answers only
// after mount() put the surface up. Components and the functions they call
// read SCREEN_W and SCREEN_H; module-level code must not, because it runs
// before readScreen() and would see 320x240.

import { auxiliaryViewport } from "@pocketjs/framework/display";
import { hasFeature } from "@pocketjs/framework/platform";

export let SCREEN_W = 320;
export let SCREEN_H = 240;
/** A portrait surface: the phone layouts. */
export let TALL = false;

export function readScreen(): void {
  const viewport = auxiliaryViewport();
  if (!viewport) return;
  SCREEN_W = viewport.width;
  SCREEN_H = viewport.height;
  TALL = SCREEN_H > SCREEN_W;
}

/** The host takes touch on the surface. False on a buttons-only host (the
 *  PSP), where every action needs a button path. The compiler folds it per
 *  target. */
export function appletTouch(): boolean {
  return hasFeature("input.touch.auxiliary");
}
