// SPDX-License-Identifier: GPL-3.0-or-later
// test/icons.test.ts — the generated icons, the paths the deck names and the
// images the build bakes must be the same set.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drawIcon, iconPath, ICON_SIZE, ICON_TONES, ICONS, type IconName, type IconTone } from "../src/gen-icons.ts";
import { ICON_SRC } from "../src/icons.ts";

const names = Object.keys(ICONS) as IconName[];
const tones = Object.keys(ICON_TONES) as IconTone[];

describe("deck icons", () => {
  test("the deck's table names every generated icon in every tone", () => {
    expect(Object.keys(ICON_SRC).sort()).toEqual([...names].sort());
    for (const name of names) for (const tone of tones) expect(ICON_SRC[name][tone]).toBe(iconPath(name, tone));
  });

  test("images.json bakes each one with an alpha channel", () => {
    const images = JSON.parse(readFileSync(resolve(import.meta.dir, "../src/images.json"), "utf8")) as Record<string, { psm?: number }>;
    for (const name of names) for (const tone of tones) expect(images[iconPath(name, tone)]).toEqual({ psm: 3 });
  });

  test("every glyph stays inside its 16 px cell and is not empty", () => {
    for (const name of names) {
      const mask = drawIcon(name);
      expect(mask.length).toBe(ICON_SIZE * ICON_SIZE);
      expect(mask.reduce((sum, on) => sum + on, 0)).toBeGreaterThan(8);
    }
  });
});
