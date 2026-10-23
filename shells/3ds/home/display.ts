// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/home/display.ts — the console's display mode, for Settings'
// Dual Screen switch.
//
// "dual": the agent lives on the top screen (the 3DS's default). "single":
// one screen, the agent behind a notch the system overlay draws at the top
// centre of the touch screen — the mode a one-screen device (an iPod touch,
// an Android phone) runs in. The host keeps the choice.
//
// The calls are `displayMode()` and `setDisplayMode(mode)` of
// @pocketjs/framework/agent. A host without the agent's display ops has no
// mode to switch: displayApi() is null and Settings shows no switch.

import { agentHost, displayMode, setDisplayMode } from "@pocketjs/framework/agent";

export type DisplayMode = "dual" | "single";

export interface DisplayApi {
  displayMode(): DisplayMode;
  setDisplayMode(mode: DisplayMode): void;
}

export function displayApi(): DisplayApi | null {
  const host = agentHost() as { display?: unknown; setDisplay?: unknown } | null;
  if (typeof host?.display !== "function" || typeof host.setDisplay !== "function") return null;
  return {
    displayMode: () => displayMode(),
    setDisplayMode: (mode) => {
      setDisplayMode(mode);
    },
  };
}
