// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/youtube/app.tsx — YouTube for Pocket on the 3DS.
//
// The whole app is on the touch screen: videos under a Tech/Music/Gaming/
// News/Search segmented control, and the player. The top screen belongs to
// the system (capability "system.agent"). L and R change the section; in the
// player A pauses, left and right seek ten seconds, up and down set the
// volume, and the track under the picture scrubs.
//
// Lists, thumbnails and streams come from the linked Mac's youtube service
// (yt-dlp and ffmpeg there). A New 3DS plays H.264 in hardware; an Old 3DS
// plays the 160x90 PAL8 stream.

import { createSignal } from "solid-js";
import { AuxiliarySurface, View } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { onButtonPress } from "@pocketjs/framework/lifecycle";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import { createNavStack } from "../ui/nav.tsx";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import { createYtClient } from "./api.ts";
import { createYtModel } from "./model.ts";
import { listPage, playerPage, type YtEnv } from "./views.tsx";

const ALL_BUTTONS = 0xffff;

export default function YouTube() {
  const client = createYtClient();
  const press = createPress();
  const [keys, setKeys] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const osk = createOsk({
    value: draft,
    setValue: setDraft,
    maxLength: 80,
    onCommit: (text) => {
      if (text.trim()) model.setQuery(text.trim());
    },
  });
  const model = createYtModel(client, {
    editQuery() {
      setDraft(model.query());
      osk.open();
    },
  });
  const env: YtEnv = { model, client, press, keys };

  const stack = createNavStack({
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    page(id, nav, layer) {
      return id === "player" ? playerPage(env, nav) : listPage(env, nav, layer);
    },
  });
  stack.reset("list");
  model.setSection("tech");

  createTouchRouter({
    surface: "auxiliary",
    press,
    page: () => stack.touch(),
    active: () => !stack.busy() && !osk.isOpen(),
    onTouch: () => setKeys(false),
  });

  onButtonPress(ALL_BUTTONS, (pressed) => {
    if (osk.isOpen()) return;
    stack.key(pressed);
  });

  const keyboardTop = 240 - oskHeight("auxiliary", "light");
  return (
    <AuxiliarySurface>
      <View class="relative w-full h-full bg-white overflow-hidden">
        {stack.view()}
        <View class="absolute left-0 w-[320]" style={{ insetT: keyboardTop, height: 240 - keyboardTop }}>
          <Osk osk={osk} surface="auxiliary" theme="light" />
        </View>
      </View>
    </AuxiliarySurface>
  );
}
