// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/discord/app.tsx — Discord for Pocket on the 3DS.
//
// The whole app is on the touch screen: the servers of the bot the Mac runs,
// a server's text channels, and a channel's messages, live while the channel
// is open. The top screen belongs to the system (capability
// "system.agent"). X (or Write) opens the composer over the channel with the
// system keyboard; START sends, B keeps the draft and closes it.
//
// Every request goes to the companion's discord service through
// @pocketjs/framework/net; the console never holds the bot's token.

import { createEffect, createSignal, For, Show } from "solid-js";
import { AuxiliarySurface, Text, View } from "@pocketjs/framework/components";
import { createGesture } from "@pocketjs/framework/gesture";
import { onButtonPress } from "@pocketjs/framework/lifecycle";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import { createNavStack } from "../ui/nav.tsx";
import { createPress, createTouchRouter } from "../ui/touch.ts";
import { ellipsize, FONT, toAscii, wrap } from "../ui/text.ts";
import { createDiscordModel } from "./model.ts";
import { channelsPage, chatPage, serversPage, type DiscordEnv } from "./views.tsx";

const ALL_BUTTONS = 0xffff;
const W = 320;
const KEYBOARD_TOP = 240 - oskHeight("auxiliary", "dark");
const COMPOSE_BAR = 32;
const DRAFT_LINES = Math.max(1, Math.floor((KEYBOARD_TOP - COMPOSE_BAR - 26) / 16));
export const MAX_MESSAGE = 2000;

export default function Discord() {
  const model = createDiscordModel();
  const press = createPress();
  const [keys, setKeys] = createSignal(false);
  const [composing, setComposing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [sending, setSending] = createSignal(false);
  const [sendError, setSendError] = createSignal("");

  const send = (text: string) => {
    if (sending() || !text.trim()) return;
    setSending(true);
    setSendError("");
    model.send(text).then((error) => {
      setSending(false);
      if (error) {
        setSendError(error);
        return;
      }
      setDraft("");
      close();
    });
  };
  const osk = createOsk({ value: draft, setValue: setDraft, onCommit: send, onClose: () => close(), maxLength: MAX_MESSAGE, closeOnCommit: false });
  const close = () => {
    if (osk.isOpen()) osk.close();
    setComposing(false);
    setSendError("");
  };
  const compose = () => {
    if (!model.chat()) return;
    setComposing(true);
    setSendError("");
    osk.open();
  };

  const env: DiscordEnv = { model, press, keys, compose };
  const stack = createNavStack({
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    page(id, nav, layer) {
      if (id === "chat") return chatPage(env, nav, layer);
      if (id === "channels") return channelsPage(env, nav, layer);
      return serversPage(env, nav, layer);
    },
  });
  stack.reset("servers");
  model.loadGuilds();

  // Leaving a channel (B or the back button) stops its live poll.
  let depth = 1;
  createEffect(() => {
    const now = stack.entries().length;
    if (now < depth && depth >= 3) model.closeChannel();
    depth = now;
  });

  createTouchRouter({
    surface: "auxiliary",
    press,
    page: () => stack.touch(),
    active: () => !stack.busy() && !composing(),
    onTouch: () => setKeys(false),
  });
  // The open keyboard blocks app gestures; the composer's bar is part of the
  // keyboard's session, so its two buttons take their own exempt gesture.
  // The region exists only while composing: a tap single-fires on one
  // recognizer, and this one would otherwise take the bar's back button.
  const composerButton = (x: number) => (x < 80 ? "compose.cancel" : x >= W - 80 ? "compose.send" : "");
  createGesture({
    surface: "auxiliary",
    region: { rect: () => (composing() ? { x: 0, y: 0, w: W, h: COMPOSE_BAR } : null) },
    allowWhenBlocked: true,
    onDown(contact) {
      if (!composing()) return;
      const id = composerButton(contact.x);
      if (id) press.down(id);
    },
    onTap(contact) {
      press.release();
      if (!composing()) return;
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
    if (composing()) return;
    stack.key(pressed);
  });

  const draftLines = () => {
    const text = osk.display("|");
    if (!text) return ["Message #" + toAscii(model.chat()?.channel.name ?? "")];
    const lines = wrap(text.replace(/[^\x20-\x7e\n|]/g, "?"), FONT.sm, W - 24);
    return lines.length > DRAFT_LINES ? lines.slice(lines.length - DRAFT_LINES) : lines;
  };

  return (
    <AuxiliarySurface>
      <View class="relative w-full h-full bg-[#2f3136] overflow-hidden">
        {stack.view()}
        <Show when={composing()}>
          <View class="absolute left-0 top-0 w-[320] h-[240] bg-[#36393f]" />
          <View class="absolute left-0 top-0 w-[320] h-[32] bg-[#202225]" />
          <Text class={press.is("compose.cancel") ? "absolute left-[10] top-[9] text-sm text-[#ffffff]" : "absolute left-[10] top-[9] text-sm text-[#b9bbbe]"}>Cancel</Text>
          <Text class="absolute left-[80] top-[9] w-[160] text-sm text-white font-bold text-center">
            {ellipsize(`#${toAscii(model.chat()?.channel.name ?? "")}`, FONT.smBold, 160)}
          </Text>
          <View class={draft().trim() && !sending() ? "absolute left-[254] top-[4] w-[58] h-[24] rounded-[5] bg-[#5865f2]" : "absolute left-[254] top-[4] w-[58] h-[24] rounded-[5] bg-[#4e5058]"} />
          <Text class="absolute left-[254] top-[9] w-[58] text-xs text-white font-bold text-center">{sending() ? "..." : "Send"}</Text>
          <View class="absolute left-[8] w-[304] rounded-[8] bg-[#40444b]" style={{ insetT: COMPOSE_BAR + 6, height: KEYBOARD_TOP - COMPOSE_BAR - 12 }} />
          <For each={draftLines()}>
            {(line, index) => (
              <Text class={draft() ? "absolute left-[14] text-sm text-[#dcddde]" : "absolute left-[14] text-sm text-[#72767d]"} style={{ insetT: COMPOSE_BAR + 12 + index() * 16 }}>
                {line || " "}
              </Text>
            )}
          </For>
          <Show when={sendError()}>
            <Text class="absolute left-[14] w-[292] text-2xs text-[#ed4245]" style={{ insetT: KEYBOARD_TOP - 18 }}>
              {ellipsize(sendError(), FONT.xxs, 292)}
            </Text>
          </Show>
          <View class="absolute left-0 w-[320]" style={{ insetT: KEYBOARD_TOP, height: 240 - KEYBOARD_TOP }}>
            <Osk osk={osk} surface="auxiliary" theme="dark" />
          </View>
        </Show>
      </View>
    </AuxiliarySurface>
  );
}

