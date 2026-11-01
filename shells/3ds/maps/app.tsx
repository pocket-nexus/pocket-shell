// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/maps/app.tsx — Maps for Pocket: OpenStreetMap in a window of
// Omarchy Pocket's shell.
//
// One page holds the map; a search pushes the list of places found. The
// pad's pointer drives it: a tap presses the field and the buttons, a
// two-finger scroll or a Hold-and-slide pans (views.tsx). On a host whose
// buttons reach the applet, L and R zoom, the d-pad pans, triangle locates
// and square opens the search field.
//
// Tiles, geocodes and the position come from the maps service and the saved
// view from the store service, both in omarchy-pocketd (daemon/companion.ts).

import { createSignal } from "solid-js";
import { AuxiliarySurface } from "@pocketjs/framework/components";
import { View } from "@pocketjs/framework/components";
import { onButtonPress } from "@pocketjs/framework/lifecycle";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import { keep } from "../ui/keep.ts";
import { Legend, legendWhileTyping } from "../ui/legend.tsx";
import { createNavStack } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W, appletSurfaceId, appletTouch } from "../ui/screen.ts";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import { createMapsClient } from "./api.ts";
import { createMapsModel } from "./model.ts";
import { mapPage, resultsPage, type MapsEnv } from "./views.tsx";

const ALL_BUTTONS = 0xffff;
const MAX_QUERY = 80;

export default function Maps() {
  const client = keep("client", () => createMapsClient());
  const press = createPress();
  // Without touch (a PSP) the d-pad focus shows from the start.
  const [keys, setKeys] = createSignal(!appletTouch());
  const [draft, setDraft] = createSignal("");
  const osk = createOsk({
    value: draft,
    setValue: setDraft,
    maxLength: MAX_QUERY,
    onCommit: (text) => {
      if (!text.trim()) return;
      model.search(text.trim());
      if (stack.top()?.page !== "results") stack.push("results");
    },
  });
  legendWhileTyping(osk.isOpen, "Search");
  // the model outlives a remount; its hook into this mount's keyboard is set each time
  const hooks = keep("hooks", () => ({ editQuery: () => {} }));
  hooks.editQuery = () => {
    setDraft(model.query());
    osk.open();
  };
  const model = keep("model", () => createMapsModel(client, hooks));
  const env: MapsEnv = { model, client, press, keys, draft: () => (osk.isOpen() ? osk.display("|") : null) };

  const stack = createNavStack({
    restore: "maps",
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    page(id, nav, layer) {
      return id === "results" ? resultsPage(env, nav, layer) : mapPage(env, nav);
    },
  });
  if (stack.entries().length === 0) stack.reset("map");
  model.start();

  createTouchRouter({
    surface: appletSurfaceId(),
    press,
    page: () => stack.touch(),
    active: () => !stack.busy() && !osk.isOpen(),
    onTouch: () => setKeys(false),
  });

  onButtonPress(ALL_BUTTONS, (pressed) => {
    if (osk.isOpen()) return;
    stack.key(pressed);
  });

  const keyboardTop = SCREEN_H - oskHeight(appletSurfaceId(), "light");
  return (
    <AuxiliarySurface>
      <View class="relative w-full h-full bg-white overflow-hidden">
        {stack.view()}
        <View class="absolute left-0" style={{ insetT: keyboardTop, width: SCREEN_W, height: SCREEN_H - keyboardTop }}>
          <Osk osk={osk} surface={appletSurfaceId()} theme="light" />
        </View>
      </View>
      <Legend home />
    </AuxiliarySurface>
  );
}
