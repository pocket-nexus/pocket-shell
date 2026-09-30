// SPDX-License-Identifier: GPL-3.0-or-later
// src/icons.ts — where the deck finds each generated icon (src/gen-icons.ts).
// The build bakes the images whose names appear as string literals in the
// source, so every path is spelled out here; test/icons.test.ts keeps this
// table, the generator and images.json in step.

import type { IconName, IconTone } from "./gen-icons.ts";

export const ICON_SRC: Record<IconName, Record<IconTone, string>> = {
  menu: { fg: "icons/menu-fg.png", accent: "icons/menu-accent.png", ink: "icons/menu-ink.png" },
  term: { fg: "icons/term-fg.png", accent: "icons/term-accent.png", ink: "icons/term-ink.png" },
  notes: { fg: "icons/notes-fg.png", accent: "icons/notes-accent.png", ink: "icons/notes-ink.png" },
  top: { fg: "icons/top-fg.png", accent: "icons/top-accent.png", ink: "icons/top-ink.png" },
  kbd: { fg: "icons/kbd-fg.png", accent: "icons/kbd-accent.png", ink: "icons/kbd-ink.png" },
  keys: { fg: "icons/keys-fg.png", accent: "icons/keys-accent.png", ink: "icons/keys-ink.png" },
  wall: { fg: "icons/wall-fg.png", accent: "icons/wall-accent.png", ink: "icons/wall-ink.png" },
  bar: { fg: "icons/bar-fg.png", accent: "icons/bar-accent.png", ink: "icons/bar-ink.png" },
  dwindle: { fg: "icons/dwindle-fg.png", accent: "icons/dwindle-accent.png", ink: "icons/dwindle-ink.png" },
  scrolling: { fg: "icons/scrolling-fg.png", accent: "icons/scrolling-accent.png", ink: "icons/scrolling-ink.png" },
};

export const icon = (name: IconName, tone: IconTone): string => ICON_SRC[name][tone];
