// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, test } from 'bun:test';
import { bootWorld } from '../../../vendor/pocketjs/hosts/sim/sim.ts';
import { __packTouchWide } from '../../../vendor/pocketjs/framework/src/touch.ts';
import { PROP } from '../../../vendor/pocketjs/contracts/spec/spec.ts';
import { Navigation, type Contact } from '../src/navigation.ts';
import { shellLayout } from '../src/layout.ts';
import { APPS } from '../src/catalog.ts';

const contact = (x: number, y: number): Contact => ({ id: 0, x, y, vx: 0, vy: 0 });
const settle = (n: Navigation) => { for (let i = 0; i < 60; i++) n.step(1 / 30); };
function swipe(n: Navigation, from: [number, number], to: [number, number], hold = 0) {
  n.down(contact(...from));
  for (let i = 1; i <= 12; i++) { n.move(contact(from[0] + (to[0] - from[0]) * i / 12, from[1] + (to[1] - from[1]) * i / 12), 1 / 30); n.step(1 / 30); }
  for (let i = 0; i < hold; i++) { n.move(contact(...to), 1 / 30); n.step(1 / 30); }
  n.up(contact(...to)); settle(n);
}

describe('Nokia E7 native viewport', () => {
  for (const [width, height] of [[360, 640], [640, 360]]) {
    test(`${width}x${height}: both Home pages, edge navigation, recency and dismissal at 30 Hz`, () => {
      const n = new Navigation(width, height), cx = width / 2, bar = height - 14;
      swipe(n, [cx, bar], [cx, bar - 41]);
      expect(n.destination).toBe('home');
      for (let page = 0; page < 2; page++) {
        if (page) swipe(n, [width - 40, 210], [40, 210]);
        expect(n.homePage.value).toBe(page);
        for (const [index, app] of APPS.entries()) {
          if (app.page >= 0 && app.page !== page) continue;
          const icon = n.layout.icon(index);
          expect(icon.x).toBeGreaterThanOrEqual(0); expect(icon.x + 56).toBeLessThanOrEqual(width);
          expect(icon.y + 56).toBeLessThan(height - 48);
          expect(n.hitHomeIcon(icon.x + 28, icon.y + 28)).toBe(index);
          n.down(contact(icon.x + 28, icon.y + 28)); n.up(contact(icon.x + 28, icon.y + 28)); settle(n);
          expect(n.selected).toBe(index); expect(n.opened.at(-1)).toBe(index);
          expect(n.cards[index].scale.value).toBe(1);
          swipe(n, [cx, bar], [cx, bar - 41]);
          expect(n.cards[index].scale.value * width).toBeCloseTo(56, 8);
          expect(n.cards[index].x.value).toBe(icon.x);
          expect(n.homePage.value).toBe(page);
        }
      }
      swipe(n, [cx, bar], [cx, bar - 90]);
      expect(n.destination).toBe('switcher');
      const selected = n.selected, card = n.cards[selected];
      const x = card.x.value + width * card.scale.value / 2, y = card.y.value + height * card.scale.value / 2;
      swipe(n, [x, y], [x, y - 100]); expect(n.opened).not.toContain(selected);
      n.resize(height, width); settle(n); expect(n.destination).toBe('switcher');
      expect(n.homePage.value).toBe(1); expect(n.opened).not.toContain(selected);
    });

    test(`${width}x${height}: mounted E7 bundle launches every icon and keeps windows mounted`, async () => {
      const writes = new Map<number, Map<number, number>>();
      const actions: number[] = [];
      const world = await bootWorld('pocketshell-touch-e7', 30, undefined, ops => {
        ops.__reportAppAction = (_: string, value: number) => actions.push(value);
        const direct = ops.setProp as (node: number, prop: number, value: number) => void;
        ops.setProp = (node: number, prop: number, value: number) => {
          if (!writes.has(node)) writes.set(node, new Map());
          writes.get(node)!.set(prop, value); direct(node, prop, value);
        };
        const original = ops.setPropBatch as (b: ArrayBuffer) => void;
        ops.setPropBatch = (buffer: ArrayBuffer) => {
          const data = new Float64Array(buffer);
          for (let i = 0; i < data.length; i += 3) {
            if (!writes.has(data[i])) writes.set(data[i], new Map());
            writes.get(data[i])!.set(data[i + 1], data[i + 2]);
          }
          original(buffer);
        };
      }, { width, height, rasterDensity: 1 });
      function frame(x?: number, y?: number) { world.frame(0, undefined, x === undefined ? [] : [__packTouchWide(0, x, y!)]); world.tick(); world.tick(); }
      const idle = () => { for (let i = 0; i < 60; i++) frame(); };
      const tap = (x: number, y: number) => { frame(x, y); frame(x, y); frame(); idle(); };
      function glide(x0: number, y0: number, x1: number, y1: number, hold = 0) {
        for (let i = 0; i <= 12; i++) frame(Math.round(x0 + (x1 - x0) * i / 12), Math.round(y0 + (y1 - y0) * i / 12));
        for (let i = 0; i < hold; i++) frame(x1, y1);
        frame(); idle();
      }
      idle();
      const nodes: number[] = [];
      const collect = (node: any, out: number[]) => { if (/^TouchWindow\d+$/.test(node.n ?? '')) out.push(node.i); node.k?.forEach((n: any) => collect(n, out)); };
      collect(world.getTree(), nodes); expect(nodes).toHaveLength(16);
      const l = shellLayout(width, height), cx = width / 2, bar = height - 14;
      glide(cx, bar, cx, bar - 41);
      // Re-enter from Home before Photos' icon minimization has faded out.
      // Check the mounted painter, not only the navigation model's targets.
      const photoIcon = l.icon(5), photo = nodes[5];
      tap(photoIcon.x + 28, photoIcon.y + 28);
      for (let i = 0; i <= 12; i++) frame(cx, Math.round(bar - 90 * i / 12));
      frame();
      for (let i = 0; i < 9; i++) frame();
      frame(cx, bar);
      expect(writes.get(photo)!.get(PROP.scaleX)).toBe(0.64);
      expect(writes.get(photo)!.get(PROP.translateX)! + width * 0.64).toBeLessThanOrEqual(0);
      frame(cx, bar - 90);
      expect(writes.get(photo)!.get(PROP.scaleX)).toBe(0.64);
      expect(writes.get(photo)!.get(PROP.translateX)! + width * 0.64).toBeGreaterThan(0);
      expect(writes.get(photo)!.get(PROP.translateX)! + width * 0.64).toBeLessThan(48);
      frame(); idle();
      expect(writes.get(photo)!.get(PROP.scaleX)).toBe(0.64);
      tap(cx, height / 2); // Reopen the centered Photos card, then return Home.
      glide(cx, bar, cx, bar - 41);
      for (const [index] of APPS.entries()) {
        if (index === 12) glide(width - 40, 220, 40, 220);
        const icon = l.icon(index); tap(icon.x + 28, icon.y + 28);
        expect(writes.get(nodes[index])!.get(PROP.scaleX), APPS[index].name).toBe(1);
        expect(writes.get(nodes[index])!.get(PROP.opacity)).toBe(1);
        for (const other of nodes.filter(n => n !== nodes[index])) expect(writes.get(other)!.get(PROP.opacity)).toBe(0);
        const pixels = world.render(); expect(pixels.byteLength).toBe(width * height * 4);
        glide(cx, bar, cx, bar - 41);
      }
      // The native host clears old contacts when rotating. That terminal
      // event must cancel a half-completed Home reveal, not open the deck.
      frame(cx, bar); frame(cx, bar - 60);
      const count = actions.at(-1);
      (globalThis as any).__pocketResizeViewport(height, width);
      frame(); idle();
      expect(actions.at(-1)).toBe(count);
      for (const node of nodes) {
        expect(writes.get(node)!.get(PROP.width)).toBe(height);
        expect(writes.get(node)!.get(PROP.height)).toBe(width);
        expect(writes.get(node)!.get(PROP.opacity)).toBe(0);
      }
      const rotated = shellLayout(height, width).icon(12);
      tap(rotated.x + 28, rotated.y + 28);
      expect(writes.get(nodes[12])!.get(PROP.scaleX)).toBe(1);
      const after: number[] = []; collect(world.getTree(), after); expect(after).toEqual(nodes);
    });
  }

  test('orientation change cancels an old contact without launching or closing a window', () => {
    for (const destination of ['home', 'app', 'switcher'] as const) {
      const n = new Navigation(360, 640);
      if (destination === 'home') swipe(n, [180, 626], [180, 585]);
      if (destination === 'switcher') swipe(n, [180, 626], [180, 585], 8);
      const order = [...n.opened], selected = n.selected;
      n.down(contact(180, 626)); n.move(contact(100, 570), 1 / 30);
      n.resize(640, 360); settle(n);
      n.up(contact(100, 570));
      expect(n.drag).toBeNull(); expect(n.destination).toBe(destination);
      expect(n.opened).toEqual(order); expect(n.selected).toBe(selected);
      expect(n.layout.height).toBe(360);
    }
  });
});

// A retained, settled scene must not keep crossing the native property bridge.
// Check both host rates: reducing updates must not depend on E7's old 30 Hz cap.
for (const hz of [30, 60]) {
  test(`settled touch shell sends no property writes at ${hz} Hz`, async () => {
    let writes = 0;
    const world = await bootWorld('pocketshell-touch-e7', hz, undefined, ops => {
      const direct = ops.setProp as (...args: number[]) => void;
      const batch = ops.setPropBatch as (buffer: ArrayBuffer) => void;
      ops.setProp = (...args: number[]) => { writes++; direct(...args); };
      ops.setPropBatch = (buffer: ArrayBuffer) => { writes += buffer.byteLength / 24; batch(buffer); };
    }, { width: 360, height: 640 });
    for (let i = 0; i < hz * 2; i++) { world.frame(0); for (let t = 0; t < 60 / hz; t++) world.tick(); }
    writes = 0;
    for (let i = 0; i < hz; i++) { world.frame(0); for (let t = 0; t < 60 / hz; t++) world.tick(); }
    expect(writes).toBe(0);
  });
}
