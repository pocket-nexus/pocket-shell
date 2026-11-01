// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/weather/app.tsx — Weather in a window of Omarchy Pocket's shell.
//
// The saved places as a table, a place's forecast, and a search that adds a
// place. The deck's keyboard types into the search field while it is open;
// on a host whose buttons reach the applet, triangle reloads and square
// opens the search. Open-Meteo answers the geocodes and forecasts through
// omarchy-pocketd; the places and the units live in its store service.

import { createEffect, createSignal } from "solid-js";
import { AuxiliarySurface } from "@pocketjs/framework/components";
import { View } from "@pocketjs/framework/components";
import { onButtonPress } from "@pocketjs/framework/lifecycle";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import { keep } from "../ui/keep.ts";
import { Legend, legendWhileTyping } from "../ui/legend.tsx";
import { createNavStack } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W, appletSurfaceId, appletTouch } from "../ui/screen.ts";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import { Pinstripes } from "../ui/chrome.tsx";
import { createWeatherClient } from "./api.ts";
import { createWeatherModel } from "./model.ts";
import { forecastPage, placesPage, searchPage, type WeatherEnv } from "./views.tsx";

const ALL_BUTTONS = 0xffff;
const MAX_QUERY = 60;

export default function Weather() {
  const client = keep("client", () => createWeatherClient());
  const press = createPress();
  // Without touch (a PSP) the d-pad focus shows from the start.
  const [keys, setKeys] = createSignal(!appletTouch());
  const [draft, setDraft] = createSignal("");
  const osk = createOsk({
    value: draft,
    setValue: setDraft,
    maxLength: MAX_QUERY,
    onCommit: (text) => model.setQuery(text),
  });
  legendWhileTyping(osk.isOpen, "Search");
  // the model outlives a remount; its hook into this mount's keyboard is set each time
  const hooks = keep("hooks", () => ({ editQuery: () => {} }));
  hooks.editQuery = () => {
    setDraft(model.search().query);
    osk.open();
  };
  const model = keep("model", () => createWeatherModel(client, hooks));
  const env: WeatherEnv = { model, press, keys, draft: () => (osk.isOpen() ? osk.display("|") : null) };

  const stack = createNavStack({
    restore: "weather",
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    background: () => <Pinstripes width={SCREEN_W} height={SCREEN_H} />,
    page(id, nav, layer) {
      return id === "forecast" ? forecastPage(env, nav, layer) : id === "search" ? searchPage(env, nav, layer) : placesPage(env, nav, layer);
    },
  });
  if (stack.entries().length === 0) stack.reset("places");
  // The first mount opens on the forecast of the place open last, once the
  // store has answered; a later mount (a resize) keeps the pages it had.
  const opened = keep("opened", () => ({ done: false }));
  createEffect(() => {
    if (opened.done || model.store() !== "ready") return;
    opened.done = true;
    if (model.current() && stack.entries().length === 1) stack.push("forecast");
  });

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
      <View class="relative w-full h-full bg-[#c9d0d8] overflow-hidden">
        {stack.view()}
        <View class="absolute left-0" style={{ insetT: keyboardTop, width: SCREEN_W, height: SCREEN_H - keyboardTop }}>
          <Osk osk={osk} surface={appletSurfaceId()} theme="light" />
        </View>
      </View>
      <Legend home />
    </AuxiliarySurface>
  );
}
