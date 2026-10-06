// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/svc.ts — the System UI input protocol over the spec svc channel
// (HostOps svcOpen/svcPoll/svcSend), the note dialect's input lines extended
// for a native compositor. hosts/macos speaks it when the resolved System UI
// plan.s companion list names "system-ui".
//
// host → guest lines (superset of apps/note/svc.ts):
//   {t:"hello", w, h, epoch}   viewport at boot + wall-clock ms (taskbar clock)
//   {t:"resize", w, h}         live window resize
//   {t:"ch", s}                typed characters
//   {t:"key", k, sh, alt, ctl} named key + modifiers (adds F1..F12)
//   {t:"key", k, cmd:true}     ⌘ chord — k is the raw lowercase key ("w",
//                              "m", "`", "c", …); ⌘Q/⌘V stay host-side
//   {t:"paste", text}          system clipboard (⌘V or a paste-req reply)
//   {t:"ime", s, c}            IME preedit + caret char index (null clears)
//   {t:"mouse", x, y, d, sh}   primary-button pointer stream
//   {t:"mouse", x, y, d, b:2}  right-button press/release
//   {t:"scroll", dy}           wheel delta in logical px
//   {t:"open", package}        open the installed app with that package id;
//                              when its window is already open, restore it
//                              from the task strip, raise it and focus it.
//                              An id outside the installed catalog is ignored
//   {t:"theme", id}            select the theme with that id ("classic",
//                              "xp" or "aqua"). An id that names no theme
//                              is ignored
//   {t:"lang", id, titles}     the language the shell draws in ("en" or
//                              "ja", words.ts), and the installed apps'
//                              titles in it by package id (optional; an app
//                              it leaves out keeps its manifest's title). An
//                              id with no catalog is ignored
//
// guest → host intents:
//   {t:"theme", id}            the active theme: sent once after boot and
//                              after every frame that ends in another theme,
//                              whether the Settings menu, the cycle chord or
//                              the host's theme line changed it
//   {t:"quit"}                 Shut Down
//   {t:"copy", text}           put text on the system clipboard
//   {t:"paste-req"}            ask for the clipboard (host answers {t:"paste"})
//   {t:"caret", x, y, h}       caret rect — docks the IME candidate window
//   {t:"cursor", k}            pointer shape: default|text|pointer|move|
//                              grabbing|ew|ns|nwse|nesw

import { getOps } from "@pocketjs/framework";
import type { ThemeId } from "./theme.ts";

export interface HostEvent {
  t:
    | "hello"
    | "resize"
    | "ch"
    | "key"
    | "mouse"
    | "scroll"
    | "paste"
    | "ime"
    | "open"
    | "theme"
    | "lang";
  w?: number;
  h?: number;
  epoch?: number;
  s?: string;
  k?: string;
  x?: number;
  y?: number;
  /** Button state for "mouse" lines (the b-button's state, primary if no b). */
  d?: boolean;
  /** Mouse button: undefined/1 = primary, 2 = right. */
  b?: number;
  sh?: boolean;
  alt?: boolean;
  ctl?: boolean;
  /** ⌘ held — k is then the raw lowercase key name ("w", "m", "`", …). */
  cmd?: boolean;
  dy?: number;
  text?: string;
  /** IME preedit caret (char index into s), null when composition ends. */
  c?: number | null;
  /** Package id of the installed app an "open" line names. */
  package?: string;
  /** Theme id a "theme" line selects, or the language a "lang" line names. */
  id?: string;
  /** A "lang" line's app titles in that language, by package id. */
  titles?: Record<string, string>;
}

export type CursorKind =
  | "default"
  | "text"
  | "pointer"
  | "move"
  | "grabbing"
  | "ew"
  | "ns"
  | "nwse"
  | "nesw";

export interface Svc {
  /** Drain and parse this frame's host lines (call once per frame). */
  poll(): HostEvent[];
  send(
    line:
      | { t: "quit" }
      | { t: "copy"; text: string }
      | { t: "paste-req" }
      | { t: "caret"; x: number; y: number; h: number }
      | { t: "cursor"; k: CursorKind }
      | { t: "theme"; id: ThemeId },
  ): void;
}

/** Probe the channel; null = standalone (sim, goldens — static desktop). */
export function connectSvc(): Svc | null {
  const ops = getOps();
  if (!ops.svcOpen || !ops.svcPoll || !ops.svcSend || !ops.svcOpen("system-ui"))
    return null;
  const poll = ops.svcPoll.bind(ops);
  const send = ops.svcSend.bind(ops);
  return {
    poll() {
      const batch = poll();
      if (!batch) return [];
      const events: HostEvent[] = [];
      for (const line of batch.split("\n")) {
        if (line === "") continue;
        try {
          events.push(JSON.parse(line) as HostEvent);
        } catch {
          // A malformed line is a host bug; skip it rather than wedge.
        }
      }
      return events;
    },
    send(line) {
      send(JSON.stringify(line));
    },
  };
}
