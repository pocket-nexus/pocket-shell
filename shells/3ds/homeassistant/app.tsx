// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/homeassistant/app.tsx — Home Assistant on the 3DS and the Tab5:
// the owner's Home Assistant, read and driven through Pocket Companion's
// homeassistant service.
//
// The entities of the open tab as a table, the setup page where the URL and
// a long-lived access token are typed on the deck's keyboard, and a light's
// page. L and R change the tab, triangle reloads, square opens Setup. The
// setup draft (URL, token, the last message) outlives a remount with the
// model.

import { createSignal } from "solid-js";
import { AuxiliarySurface } from "@pocketjs/framework/components";
import { View } from "@pocketjs/framework/components";
import { onButtonPress } from "@pocketjs/framework/lifecycle";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import { Pinstripes } from "../ui/chrome.tsx";
import { keep } from "../ui/keep.ts";
import { Legend, legendWhileTyping } from "../ui/legend.tsx";
import { createNavStack } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W, appletSurfaceId, appletTouch } from "../ui/screen.ts";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import { createHaClient } from "./api.ts";
import { createHaModel } from "./model.ts";
import { homePage, lightPage, setupPage, type HaEnv, type SetupDraft } from "./views.tsx";

const ALL_BUTTONS = 0xffff;
/** A long-lived access token is about 180 characters. */
const MAX_FIELD = 512;

export default function Home() {
  const client = keep("client", () => createHaClient());
  const model = keep("model", () => createHaModel(client));
  const press = createPress();
  // Without touch (a PSP) the d-pad focus shows from the start.
  const [keys, setKeys] = createSignal(!appletTouch());
  const [draft, setDraft] = createSignal("");
  // the draft outlives a remount; its hooks into this mount's keyboard are set each time
  const setup = keep<SetupDraft>("setup", () => ({ url: "", token: "", message: "", editUrl: () => {}, editToken: () => {} }));
  let field: "url" | "token" = "url";
  const osk = createOsk({
    value: draft,
    setValue: setDraft,
    maxLength: MAX_FIELD,
    onCommit: (text) => {
      if (field === "url") setup.url = text.trim();
      else setup.token = text.trim();
      setup.message = "";
      // the setup page's cells follow the draft through the model's setupUrl signal and a bump below
      bump();
    },
  });
  legendWhileTyping(osk.isOpen, "Done");
  const [edits, setEdits] = createSignal(0);
  const bump = () => setEdits(edits() + 1);
  setup.editUrl = () => {
    field = "url";
    setDraft(setup.url);
    osk.open();
  };
  setup.editToken = () => {
    field = "token";
    setDraft(setup.token);
    osk.open();
  };
  const env: HaEnv = { model, press, keys, setup, edits };

  const stack = createNavStack({
    restore: "homeassistant",
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    background: () => <Pinstripes width={SCREEN_W} height={SCREEN_H} />,
    page(id, nav, layer) {
      return id === "setup" ? setupPage(env, nav, layer) : id === "light" ? lightPage(env, nav, layer) : homePage(env, nav, layer);
    },
  });
  if (stack.entries().length === 0) stack.reset("home");

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
