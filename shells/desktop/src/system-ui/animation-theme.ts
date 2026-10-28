// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/animation-theme.ts — the animation theme pocket.json names
// in `app.theme`. The Notepad caret reuses the note app's square-wave
// blink: 500 ms on, 500 ms off, hard edges. Long constant segments keep
// the DrawList byte-stable between edges so the demand-rendering host
// paints ~2 frames a second while the caret rests when no input or other
// animation requests a new frame.
import type { AnimationTheme } from "@pocketjs/framework/manifest";

const theme: AnimationTheme = {
  keyframes: {
    caret: {
      "0%,49.99%": { opacity: 1 },
      "50%,100%": { opacity: 0 },
    },
  },
  animation: {
    caret: "caret 1s linear infinite",
  },
};

export default theme;
