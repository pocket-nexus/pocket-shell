// SPDX-License-Identifier: GPL-3.0-or-later
// ui/window.tsx — an applet in a window of Omarchy Pocket's shell.
// The shell sizes the applet's touch surface to the tile its window has and
// sizes it again when the tile changes (host/src/children.rs); the host calls
// `__omarchyResized(w, h)` before the next frame. An applet reads its size
// once (ui/screen.ts readScreen), so a new size remounts it: the layouts for
// its size class are built again. In a window the applet mounts only once the
// first size arrives (`__omarchyWindow`), so it never fetches for a size it
// is not shown at. Anywhere else it mounts at once.
import { createSignal, Show, type JSX } from "solid-js";
import { resizeAuxiliarySurface } from "@pocketjs/framework/display";
import { mount } from "@pocketjs/framework/solid";
import { readScreen } from "./screen.ts";

type Hooks = { __omarchyWindow?: boolean; __omarchyResized?: (w: number, h: number) => void };

export function mountApplet(App: () => JSX.Element): void {
  mount(() => {
    const hooks = globalThis as Hooks;
    const [size, setSize] = createSignal(hooks.__omarchyWindow ? 0 : 1);
    hooks.__omarchyResized = (w, h) => {
      resizeAuxiliarySurface(w, h);
      setSize((n) => n + 1);
    };
    return (
      <Show when={size()} keyed>
        {(_generation: number) => {
          readScreen();
          return <App />;
        }}
      </Show>
    );
  });
}
