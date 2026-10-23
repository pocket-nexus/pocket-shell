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
import { AuxiliarySurface, Text, View } from "@pocketjs/framework/components";
import { createGesture } from "@pocketjs/framework/gesture";
import { onButtonPress, onFrame } from "@pocketjs/framework/lifecycle";
import { companionNow } from "@pocketjs/framework/link";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import { createGlyphs, GLYPH_BOLD, GLYPH_TEXT } from "../ui/glyphs.ts";
import { createNavStack } from "../ui/nav.tsx";
import { ellipsize, FONT, toAscii, wrap } from "../ui/text.ts";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import type { Post } from "./api.ts";
import { createXModel } from "./model.ts";
import { postPage, timelinePage, type XEnv } from "./views.tsx";

const ALL_BUTTONS = 0xffff;
const W = 320;
const KEYBOARD_TOP = 240 - oskHeight("auxiliary", "light");
const COMPOSE_BAR = 32;
const DRAFT_LINES = Math.max(1, Math.floor((KEYBOARD_TOP - COMPOSE_BAR - 26) / 16));
/** X's limit on a post. */
const MAX_POST = 280;
/** Frames the lists rest before glyph atlases are asked for and loaded. */
const SETTLE_FRAMES = 6;

export default function X() {
  const model = createXModel();
  const press = createPress();
  const [keys, setKeys] = createSignal(false);
  // Ages need minutes, not frames: the clock signal changes once a minute.
  const [now, setNow] = createSignal(Math.floor(companionNow() / 60000) * 60000);
  let frames = 0;
  // The frame a list last moved (env.moved): glyph atlases are asked for and
  // loaded once the lists have rested SETTLE_FRAMES frames (ui/glyphs.ts when).
  let movedAt = -SETTLE_FRAMES;
  onFrame(() => {
    if (++frames % 60 === 0) setNow(Math.floor(companionNow() / 60000) * 60000);
  });
  const resting = () => frames - movedAt >= SETTLE_FRAMES;

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

  const env: XEnv = {
    model,
    press,
    keys,
    now,
    opening: { id: "" },
    text: createGlyphs(GLYPH_TEXT, model.client.atlas, { when: resting }),
    bold: createGlyphs(GLYPH_BOLD, model.client.atlas, { when: resting }),
    reply,
    moved: () => (movedAt = frames),
    resting,
  };

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
    active: () => !stack.busy() && !replying(),
    onTouch: () => setKeys(false),
  });
  // The open keyboard blocks app gestures; the composer's bar is part of the
  // keyboard's session, so its two buttons take their own exempt gesture.
  const composerButton = (x: number) => (x < 80 ? "compose.cancel" : x >= W - 80 ? "compose.send" : "");
  createGesture({
    surface: "auxiliary",
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
    <AuxiliarySurface>
      <View class="relative w-full h-full bg-white overflow-hidden">
        {stack.view()}
        <Show when={model.notice() && !replying()}>
          <View class="absolute left-[20] top-[200] w-[280] h-[28] rounded-[14] bg-[#0f1419e8]" />
          <Text class="absolute left-[30] top-[207] w-[260] text-xs text-white text-center">{ellipsize(toAscii(model.notice()), FONT.xs, 260)}</Text>
        </Show>
        <Show when={replying()}>
          {(post) => (
            <>
              <View class="absolute left-0 top-0 w-[320] h-[240] bg-white" />
              <View class="absolute left-0 top-0 w-[320] h-[32] bg-[#0f1419]" />
              <Text class={press.is("compose.cancel") ? "absolute left-[10] top-[9] text-sm text-[#ffffff]" : "absolute left-[10] top-[9] text-sm text-[#8b98a5]"}>Cancel</Text>
              <Text class="absolute left-[80] top-[9] w-[160] text-sm text-white font-bold text-center">
                {ellipsize(`Reply to @${toAscii(post().handle)}`, FONT.smBold, 160)}
              </Text>
              <View class={draft().trim() && !sending() ? "absolute left-[248] top-[4] w-[64] h-[24] rounded-[12] bg-[#1d9bf0]" : "absolute left-[248] top-[4] w-[64] h-[24] rounded-[12] bg-[#536471]"} />
              <Text class="absolute left-[248] top-[9] w-[64] text-xs text-white font-bold text-center">{sending() ? "..." : "Reply"}</Text>
              <For each={draftLines()}>
                {(line, index) => (
                  <Text class={draft() ? "absolute left-[14] text-sm text-[#0f1419]" : "absolute left-[14] text-sm text-[#8b98a5]"} style={{ insetT: COMPOSE_BAR + 10 + index() * 16 }}>
                    {line || " "}
                  </Text>
                )}
              </For>
              <Text class="absolute left-[250] w-[60] text-2xs text-[#8b98a5] text-right" style={{ insetT: KEYBOARD_TOP - 16 }}>{`${[...draft()].length}/${MAX_POST}`}</Text>
              <Show when={sendError()}>
                <Text class="absolute left-[14] w-[230] text-2xs text-[#f4212e]" style={{ insetT: KEYBOARD_TOP - 16 }}>
                  {ellipsize(toAscii(sendError()), FONT.xxs, 230)}
                </Text>
              </Show>
              <View class="absolute left-0 w-[320]" style={{ insetT: KEYBOARD_TOP, height: 240 - KEYBOARD_TOP }}>
                <Osk osk={osk} surface="auxiliary" theme="light" />
              </View>
            </>
          )}
        </Show>
      </View>
    </AuxiliarySurface>
  );
}
