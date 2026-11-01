// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/podcasts/app.tsx — Podcasts in a window of Omarchy Pocket.
//
// The library (subscriptions kept in the companion's store) and the search
// (the iTunes directory) under a Library/Search segmented control, a show's
// page with its episodes, and the player. L and R change the tab; in the
// player A pauses, left and right skip thirty seconds, up and down set the
// volume, and the track under the artwork scrubs. The deck's keyboard types
// into the search field while it is open.
//
// Lists, artwork and the audio stream come from omarchy-pocketd's podcasts
// service (ffmpeg on this device); the host plays the stream through
// `globalThis.media`. The episode keeps playing when the player page is
// left: the playback object outlives the pages and the window's resize.

import { createSignal } from "solid-js";
import { AuxiliarySurface } from "@pocketjs/framework/components";
import { View } from "@pocketjs/framework/components";
import { onButtonPress, onFrame } from "@pocketjs/framework/lifecycle";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import { draftOf } from "../ui/field.tsx";
import { keep } from "../ui/keep.ts";
import { createNavStack } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W, appletTouch, appletSurfaceId } from "../ui/screen.ts";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import { createPodcastClient } from "./api.ts";
import { createPodcastModel } from "./model.ts";
import { createPlayback } from "./playback.ts";
import { listPage, playerPage, showPage, type PodcastEnv } from "./views.tsx";
import { Legend, legendWhileTyping } from "../ui/legend.tsx";

const ALL_BUTTONS = 0xffff;
/** The media worker's status is read every sixth frame. */
const POLL_FRAMES = 6;

export default function Podcasts() {
  const client = keep("client", () => createPodcastClient());
  const press = createPress();
  // Without touch the d-pad focus shows from the start.
  const [keys, setKeys] = createSignal(!appletTouch());
  const [draft, setDraft] = createSignal("");
  const osk = createOsk({
    value: draft,
    setValue: setDraft,
    maxLength: 80,
    onCommit: (text) => {
      if (text.trim()) model.setQuery(text.trim());
    },
  });
  legendWhileTyping(osk.isOpen, "Search");
  // the model outlives a remount; its hook into this mount's keyboard is set each time
  const hooks = keep("hooks", () => ({ editQuery: () => {} }));
  hooks.editQuery = () => {
    setDraft(model.query());
    osk.open();
  };
  const model = keep("model", () => createPodcastModel(client, hooks));
  const playback = keep("playback", () => createPlayback(client, model));
  const env: PodcastEnv = { model, client, playback, press, keys, draft: draftOf(osk) };

  const stack = createNavStack({
    restore: "podcasts",
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    page(id, nav, layer) {
      return id === "player" ? playerPage(env, nav) : id === "show" ? showPage(env, nav, layer) : listPage(env, nav, layer);
    },
  });
  if (stack.entries().length === 0) stack.reset("list");

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

  // The frame registry starts over with each mount; the kept playback is
  // polled from whichever mount is current.
  let frames = 0;
  onFrame(() => {
    if (++frames % POLL_FRAMES === 0) playback.poll();
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
