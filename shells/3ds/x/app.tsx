// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/x/app.tsx — X for Pocket on the 3DS.
//
// The whole app is on the touch screen: the home timeline under a
// Following/For You control, then a post's thread. The top screen belongs to
// the system (capability "system.agent"). L and R switch timelines on the
// list and page through a thread; X reloads. A row's reply button opens the
// composer with the system keyboard: START (or Reply) sends, B keeps the
// draft and closes it.
//
// The X session lives on the linked Mac (Pocket Companion's x service); the
// console asks it for pages over @pocketjs/framework/net. Text in any script
// draws from glyph atlases the Mac renders (ui/glyphs.ts).

import { createSignal, For, Show } from "solid-js";
import { AppletSurface } from "@pocketjs/framework/applet";
import { Text, View } from "@pocketjs/framework/components";
import { createGesture } from "@pocketjs/framework/gesture";
import { onButtonPress, onFrame } from "@pocketjs/framework/lifecycle";
import { companionNow } from "@pocketjs/framework/link";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import { createGlyphs, GLYPH_BOLD, GLYPH_TEXT } from "../ui/glyphs.ts";
import { createNavStack } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W, appletTouch, appletSurfaceId } from "../ui/screen.ts";
import { ellipsize, FONT, toAscii, wrap } from "../ui/text.ts";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import type { Post } from "./api.ts";
import { createXModel } from "./model.ts";
import { postPage, timelinePage, type XEnv } from "./views.tsx";
import { Legend, legendWhileTyping } from "../ui/legend.tsx";

const ALL_BUTTONS = 0xffff;
const COMPOSE_BAR = 32;
/** X's limit on a post. */
const MAX_POST = 280;

export default function X() {
  const W = SCREEN_W;
  const KEYBOARD_TOP = SCREEN_H - oskHeight(appletSurfaceId(), "light");
  const DRAFT_LINES = Math.max(1, Math.floor((KEYBOARD_TOP - COMPOSE_BAR - 26) / 16));
  const model = createXModel();
  const press = createPress();
  // Without touch (a PSP) the d-pad focus shows from the start.
  const [keys, setKeys] = createSignal(!appletTouch());
  // Ages need minutes, not frames: the clock signal changes once a minute.
  const [now, setNow] = createSignal(Math.floor(companionNow() / 60000) * 60000);
  let frames = 0;
  onFrame(() => {
    if (++frames % 60 === 0) setNow(Math.floor(companionNow() / 60000) * 60000);
  });

  // -- the reply composer -------------------------------------------------------
  const [replying, setReplying] = createSignal<Post | null>(null);
  const [draft, setDraft] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [sendError, setSendError] = createSignal("");
  const send = (text: string) => {
    const post = replying();
    if (!post || sending() || !text.trim()) return;
    setSending(true);
    setSendError("");
    model.reply(post, text.trim()).then((error) => {
      setSending(false);
      if (error) {
        setSendError(error);
        return;
      }
      setDraft("");
      close();
    });
  };
  const osk = createOsk({ value: draft, setValue: setDraft, onCommit: send, onClose: () => close(), maxLength: MAX_POST, closeOnCommit: false });
  legendWhileTyping(osk.isOpen, "Reply");
  const close = () => {
    if (osk.isOpen()) osk.close();
    setReplying(null);
    setSendError("");
  };
  const reply = (post: Post) => {
    if (replying()?.id !== post.id) setDraft("");
    setReplying(post);
    setSendError("");
    osk.open();
  };

  const env: XEnv = { model, press, keys, now, opening: { id: "" }, text: createGlyphs(GLYPH_TEXT, model.client.atlas), bold: createGlyphs(GLYPH_BOLD, model.client.atlas), reply };

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
    surface: appletSurfaceId(),
    press,
    page: () => stack.touch(),
    active: () => !stack.busy() && !replying(),
    onTouch: () => setKeys(false),
  });
  // The open keyboard blocks app gestures; the composer's bar is part of the
  // keyboard's session, so its two buttons take their own exempt gesture.
  const composerButton = (x: number) => (x < 80 ? "compose.cancel" : x >= W - 80 ? "compose.send" : "");
  createGesture({
    surface: appletSurfaceId(),
    region: { rect: () => (replying() ? { x: 0, y: 0, w: W, h: COMPOSE_BAR } : null) },
    allowWhenBlocked: true,
    onDown(contact) {
      if (!replying()) return;
      const id = composerButton(contact.x);
      if (id) press.down(id);
    },
    onTap(contact) {
      press.release();
      if (!replying()) return;
      const id = composerButton(contact.x);
      if (id === "compose.cancel") close();
      else if (id === "compose.send") send(draft());
    },
    onCancel() {
      press.clear();
    },
  });

  onButtonPress(ALL_BUTTONS, (pressed) => {
    // The open keyboard owns its chords (START sends, B closes).
    if (replying()) return;
    stack.key(pressed);
  });

  const draftLines = () => {
    const text = osk.display("|");
    if (!text) return ["Post your reply"];
    const lines = wrap(text.replace(/[^\x20-\x7e\n|]/g, "?"), FONT.sm, W - 24);
    return lines.length > DRAFT_LINES ? lines.slice(lines.length - DRAFT_LINES) : lines;
  };

  return (
    <AppletSurface>
      <View class="relative w-full h-full bg-white overflow-hidden">
        {stack.view()}
        <Show when={model.notice() && !replying()}>
          <View class="absolute w-[280] h-[28] rounded-[14] bg-[#0f1419e8]" style={{ insetL: (W - 280) / 2, insetT: SCREEN_H - 40 }} />
          <Text class="absolute w-[260] text-xs text-white text-center" style={{ insetL: (W - 260) / 2, insetT: SCREEN_H - 33 }}>{ellipsize(toAscii(model.notice()), FONT.xs, 260)}</Text>
        </Show>
        <Show when={replying()}>
          {(post) => (
            <>
              <View class="absolute left-0 top-0 bg-white" style={{ width: W, height: SCREEN_H }} />
              <View class="absolute left-0 top-0 h-[32] bg-[#0f1419]" style={{ width: W }} />
              <Text class={press.is("compose.cancel") ? "absolute left-[10] top-[9] text-sm text-[#ffffff]" : "absolute left-[10] top-[9] text-sm text-[#8b98a5]"}>Cancel</Text>
              <Text class="absolute left-[80] top-[9] text-sm text-white font-bold text-center" style={{ width: W - 160 }}>
                {ellipsize(`Reply to @${toAscii(post().handle)}`, FONT.smBold, W - 160)}
              </Text>
              <View class={draft().trim() && !sending() ? "absolute top-[4] w-[64] h-[24] rounded-[12] bg-[#1d9bf0]" : "absolute top-[4] w-[64] h-[24] rounded-[12] bg-[#536471]"} style={{ insetL: W - 72 }} />
              <Text class="absolute top-[9] w-[64] text-xs text-white font-bold text-center" style={{ insetL: W - 72 }}>{sending() ? "..." : "Reply"}</Text>
              <For each={draftLines()}>
                {(line, index) => (
                  <Text class={draft() ? "absolute left-[14] text-sm text-[#0f1419]" : "absolute left-[14] text-sm text-[#8b98a5]"} style={{ insetT: COMPOSE_BAR + 10 + index() * 16 }}>
                    {line || " "}
                  </Text>
                )}
              </For>
              <Text class="absolute w-[60] text-2xs text-[#8b98a5] text-right" style={{ insetL: W - 70, insetT: KEYBOARD_TOP - 16 }}>{`${[...draft()].length}/${MAX_POST}`}</Text>
              <Show when={sendError()}>
                <Text class="absolute left-[14] text-2xs text-[#f4212e]" style={{ insetT: KEYBOARD_TOP - 16, width: W - 90 }}>
                  {ellipsize(toAscii(sendError()), FONT.xxs, W - 90)}
                </Text>
              </Show>
              <View class="absolute left-0" style={{ insetT: KEYBOARD_TOP, width: W, height: SCREEN_H - KEYBOARD_TOP }}>
                <Osk osk={osk} surface={appletSurfaceId()} theme="light" />
              </View>
            </>
          )}
        </Show>
      </View>
      <Legend home />
    </AppletSurface>
  );
}
