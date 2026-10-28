// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/notes/app.tsx — Notes for Pocket: notes written on the console
// and kept on its card (capability data.fs). The whole app is on the touch
// screen; the top screen belongs to the system (capability "system.agent").
// A keyboard on the console (the Tab5's) types straight into a note; on a
// console without one the on-screen keyboard docks over the note.

import { createSignal } from "solid-js";
import { AuxiliarySurface, View } from "@pocketjs/framework/components";
import { onButtonPress } from "@pocketjs/framework/lifecycle";
import { createAlerts } from "../ui/alert.tsx";
import { Pinstripes } from "../ui/chrome.tsx";
import { createNavStack } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W } from "../ui/screen.ts";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import { createNotesModel } from "./model.ts";
import { editPage, listPage, typePage, type NotesEnv } from "./views.tsx";

const ALL_BUTTONS = 0xffff;

export default function Notes() {
  const model = createNotesModel();
  const press = createPress();
  const alerts = createAlerts(press);
  const [keys, setKeys] = createSignal(false);
  const env: NotesEnv = {
    model,
    press,
    keys,
    confirm: (title, message, action, run) => alerts.show({ title, message, action, run }),
  };

  const stack = createNavStack({
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    background: () => <Pinstripes width={SCREEN_W} height={SCREEN_H} />,
    page(id, nav, layer) {
      return id === "edit" ? editPage(env, nav, layer) : id === "type" ? typePage(env, nav, layer) : listPage(env, nav, layer);
    },
  });
  stack.reset("list");

  createTouchRouter({
    surface: "auxiliary",
    press,
    page: () => alerts.touch() ?? stack.touch(),
    active: () => !stack.busy(),
    onTouch: () => setKeys(false),
  });

  onButtonPress(ALL_BUTTONS, (pressed) => {
    if (alerts.key(pressed)) return;
    stack.key(pressed);
  });

  return (
    <AuxiliarySurface>
      <View class="relative w-full h-full bg-white overflow-hidden">
        {stack.view()}
        {alerts.view()}
      </View>
    </AuxiliarySurface>
  );
}
