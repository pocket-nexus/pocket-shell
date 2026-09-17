// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "bun:test";
import { Navigation } from "../src/navigation.ts";

test("native handoff keeps the released pose, Home page and MRU order", () => {
  for (const [w, h] of [[360, 640], [640, 360]]) {
    for (const destination of ["home", "switcher"] as const) {
      const nav = new Navigation(w, h);
      nav.homePage.value = nav.homePage.target = 0;
      nav.returnFromApp(14, destination, { x: 0.06, y: -0.04, scale: 0.88 });
      expect(nav.homePage.target).toBe(0);
      expect(nav.opened.at(-1)).toBe(14);
      expect(nav.cards[14].x.value).toBeCloseTo(w * 0.06);
      expect(nav.cards[14].y.value).toBeCloseTo(h * -0.04);
      expect(nav.cards[14].scale.value).toBe(0.88);
      expect(nav.destination).toBe(destination);
      expect(nav.cards[14].scale.target).toBeLessThan(0.88);
      for (let i = 0; i < 180; ++i) nav.step(1 / 60);
      expect(nav.opened.at(-1)).toBe(14);
    }
  }
});

test("a rejected launch does not become the last window", () => {
  const nav = new Navigation(360, 640);
  nav.returnFromApp(0);
  nav.open(4);
  nav.rejectNativeLaunch(4);
  expect(nav.destination).toBe("home");
  expect(nav.opened).not.toContain(4);
  expect(nav.opened.at(-1)).toBe(0);
  expect(nav.selected).toBe(0);
});

test("a refused close restores the card at its previous position", () => {
  const nav = new Navigation(360, 640);
  const order = [...nav.opened], rank = order.indexOf(4);
  nav.opened.splice(rank, 1);
  nav.restoreNativeCard(4, rank);
  expect(nav.opened).toEqual(order);
  expect(nav.destination).toBe("switcher");
});
