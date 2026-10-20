// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/x/app.tsx — X for Pocket on the 3DS.
//
// The whole app is on the touch screen: the home timeline under a
// Following/For You control, then a post's thread. The top screen belongs to
// the system (capability "system.agent"). L and R switch timelines on the
// list and page through a thread; X reloads.
//
// The X session lives on the linked Mac (Pocket Companion's x service); the
// console asks it for pages over @pocketjs/framework/net.

import { createSignal } from "solid-js";
import { AuxiliarySurface, View } from "@pocketjs/framework/components";
import { onButtonPress, onFrame } from "@pocketjs/framework/lifecycle";
import { companionNow } from "@pocketjs/framework/link";
import { createNavStack } from "../ui/nav.tsx";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import { createXModel } from "./model.ts";
import { postPage, timelinePage, type XEnv } from "./views.tsx";

const ALL_BUTTONS = 0xffff;

export default function X() {
  const model = createXModel();
  const press = createPress();
  const [keys, setKeys] = createSignal(false);
  // Ages need minutes, not frames: the clock signal changes once a minute.
  const [now, setNow] = createSignal(Math.floor(companionNow() / 60000) * 60000);
  let frames = 0;
  onFrame(() => {
    if (++frames % 60 === 0) setNow(Math.floor(companionNow() / 60000) * 60000);
  });

  const env: XEnv = { model, press, keys, now, opening: { id: "" } };

  const stack = createNavStack({
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    page(id, nav, layer) {
      return id === "post" ? postPage(env, nav, layer) : timelinePage(env, nav, layer);
    },
  });
  stack.reset("timeline");
  model.setKind("following");

  createTouchRouter({
    surface: "auxiliary",
    press,
    page: () => stack.touch(),
    active: () => !stack.busy(),
    onTouch: () => setKeys(false),
  });

  onButtonPress(ALL_BUTTONS, (pressed) => {
    stack.key(pressed);
  });

  return (
    <AuxiliarySurface>
      <View class="relative w-full h-full bg-white overflow-hidden">{stack.view()}</View>
    </AuxiliarySurface>
  );
}
