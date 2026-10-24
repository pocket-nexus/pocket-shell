// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { bootWorld, treeHasText } from "../../../vendor/pocketjs/programs/sim/sim.ts";
import { __packTouch } from "../../../vendor/pocketjs/framework/src/touch.ts";
import { APPS } from "../src/catalog.ts";
import { PROP } from "../../../vendor/pocketjs/contracts/spec/spec.ts";

describe("Touch shell through the mounted PocketJS guest", () => {
  test("content, home, overview, quick switch and back share live mounted windows", async () => {
    const writes = new Map<number, Map<number, number>>();
    const actions: number[] = [];
    let host: Record<string, any>;
    const world = await bootWorld("pocketshell-touch", 60, undefined, ops => {
      host = ops;
      ops.__reportAppAction = (name: string, value: number) => { if (name === "shell_touch_gesture") actions.push(value); };
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
    }, { width: 320, height: 480, rasterDensity: 2 });
    function frame(x?: number, y?: number) {
      world.frame(0, undefined, x === undefined ? [] : [__packTouch(0, x, y!)]);
      world.tick();
    }
    const idle = (frames = 120) => { for (let i = 0; i < frames; i++) frame(); };
    const tap = (x: number, y: number) => { frame(x, y); frame(x, y); frame(); idle(); };
    function glide(x0: number, y0: number, x1: number, y1: number, frames = 18, pause = 0) {
      for (let i = 0; i <= frames; i++) frame(Math.round(x0 + (x1 - x0) * i / frames), Math.round(y0 + (y1 - y0) * i / frames));
      for (let i = 0; i < pause; i++) frame(x1, y1);
      frame(); idle();
    }
    idle(5);
    const initialTree = world.getTree();
    const nodes: number[] = [];
    const named = new Map<string, number>();
    function visit(n: any) { if (n.n) named.set(n.n, n.i); if (n.n?.startsWith("TouchWindow")) nodes[Number(n.n.slice("TouchWindow".length))] = n.i; n.k?.forEach(visit); }
    visit(initialTree);
    expect(nodes).toHaveLength(APPS.length);
    for (const { name } of APPS) expect(treeHasText(initialTree, name)).toBe(true);
    expect(treeHasText(initialTree, "Today")).toBe(true);
    const clips = nodes.map((_, i) => named.get(`TouchCardClip${i}`)!);
    const contentClips = nodes.map((_, i) => named.get(`TouchContentClip${i}`)!);
    const contentPlanes = nodes.map((_, i) => named.get(`TouchContentPlane${i}`)!);
    const prop = (index: number, property: number) => writes.get(nodes[index])!.get(property)! +
      (property === PROP.translateX ? writes.get(clips[index])!.get(PROP.translateX)! : 0);
    function checkCullingPixels() {
      const saved = nodes.flatMap((node, i) => [node, PROP.opacity, prop(i, PROP.opacity)]);
      const clipped = world.render().slice();
      const savedContentClips = contentClips.flatMap((node, i) => [node, PROP.translateX, writes.get(node)!.get(PROP.translateX)!,
        contentPlanes[i], PROP.translateX, writes.get(contentPlanes[i])!.get(PROP.translateX)!]);
      host!.setPropBatch(new Float64Array(contentClips.flatMap((node, i) =>
        [node, PROP.translateX, 0, contentPlanes[i], PROP.translateX, 0])).buffer);
      expect(Bun.hash(world.render())).toBe(Bun.hash(clipped));
      host!.setPropBatch(new Float64Array(savedContentClips).buffer);
      host!.setPropBatch(new Float64Array(nodes.flatMap(node => [node, PROP.opacity, 1])).buffer);
      expect(Bun.hash(world.render())).toBe(Bun.hash(clipped));
      host!.setPropBatch(new Float64Array(saved).buffer);
      const savedClips = clips.flatMap((node, i) => [node, PROP.translateX, writes.get(node)!.get(PROP.translateX)!,
        nodes[i], PROP.translateX, writes.get(nodes[i])!.get(PROP.translateX)!]);
      // The translated scissor must match the old width-based clip exactly.
      const oldClips = clips.flatMap((node, i) => [node, PROP.translateX, 0,
        node, PROP.width, 320 + writes.get(node)!.get(PROP.translateX)!, nodes[i], PROP.translateX, prop(i, PROP.translateX)]);
      host!.setPropBatch(new Float64Array(oldClips).buffer);
      expect(Bun.hash(world.render())).toBe(Bun.hash(clipped));
      host!.setPropBatch(new Float64Array(clips.flatMap(node => [node, PROP.width, 320])).buffer);
      const reference = world.render();
      // Clipping a rotated triangle can quantize its edge one pixel away.
      // Whole-window culling stays byte-exact above; partial clipping permits
      // only a small number of those edge pixels, never missing content.
      let changed = 0;
      for (let p = 0; p < reference.length; p += 4) {
        if (reference.subarray(p, p + 4).every((v, c) => v === clipped[p + c])) continue;
        changed++;
        const x = (p / 4) % 320, y = Math.floor(p / 4 / 320);
        const low = [255, 255, 255, 255], high = [0, 0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= 320 || y + dy < 0 || y + dy >= 480) continue;
          const q = ((y + dy) * 320 + x + dx) * 4;
          for (let c = 0; c < 4; c++) {
            low[c] = Math.min(low[c], reference[q + c]);
            high[c] = Math.max(high[c], reference[q + c]);
          }
        }
        expect(Math.max(...high.map((v, c) => v - low[c]))).toBeGreaterThan(1);
      }
      expect(changed).toBeLessThanOrEqual(320 * 480 * 0.001);
      host!.setPropBatch(new Float64Array(savedClips).buffer);
    }
    // Cold launch paints Home while keeping every mockup mounted.
    expect(nodes.every((_, i) => prop(i, PROP.opacity) === 0)).toBe(true);
    expect(actions).toHaveLength(0);
    const bootHome = Bun.hash(world.render());
    idle(); expect(Bun.hash(world.render())).toBe(bootHome);
    tap(APPS[0].x + 28, APPS[0].y + 28);
    expect(prop(0, PROP.scaleX)).toBe(1);
    const beforeScroll = Bun.hash(world.render());
    glide(155, 388, 155, 200);
    expect(Bun.hash(world.render())).not.toBe(beforeScroll);
    // App overview now requires a hold; short unpaused lifts return home.
    glide(160, 466, 160, 425, 18, 18);
    expect(prop(0, PROP.scaleX)).toBeCloseTo(0.64, 5);
    expect(prop(0, PROP.translateY)).toBeCloseTo(64, 5);
    checkCullingPixels();
    host!.debugInspect(nodes[0]);
    world.render();
    const xy = host!.debugRectXY(), wh = host!.debugRectWH();
    expect(Math.abs((xy & 0xffff) - 57.6)).toBeLessThan(1);
    expect(xy >>> 16).toBe(64);
    // The debug AABB encloses fractional edges: floor(min), ceil(max).
    expect(wh & 0xffff).toBe(206);
    expect(wh >>> 16).toBe(308);
    host!.debugInspect(0);
    glide(160, 240, 250, 240, 18, 8);
    expect(prop(1, PROP.translateX)).toBeCloseTo(57.6, 4);
    const stackX = [0, 1, 2].map(i => prop(i, PROP.translateX));
    frame(160, 240);
    for (let i = 1; i <= 10; i++) frame(160 + Math.round(i * 3.6), 240);
    checkCullingPixels();
    const deltas = [0, 1, 2].map(i => prop(i, PROP.translateX) - stackX[i]);
    expect(deltas[0]).toBeGreaterThan(deltas[1]);
    expect(deltas[2]).toBeLessThan(deltas[1]);
    const horizontalPose = [0, 1, 2].map(i => [prop(i, PROP.translateX), prop(i, PROP.translateY)]);
    for (let i = 1; i <= 15; i++) frame(196, 240 - i * 8);
    expect([0, 1, 2].map(i => [prop(i, PROP.translateX), prop(i, PROP.translateY)])).toEqual(horizontalPose);
    frame(); idle();
    expect([0, 1, 2].map(i => prop(i, PROP.opacity))).toEqual([1, 1, 1]);
    expect(prop(1, PROP.translateX)).toBeCloseTo(57.6, 4);
    tap(160, 230);
    expect(prop(1, PROP.scaleX)).toBe(1);
    expect(prop(1, PROP.translateX)).toBe(0);
    expect(prop(0, PROP.scaleX)).toBeLessThan(0.64);
    expect(prop(2, PROP.scaleX)).toBeLessThan(0.64);
    expect(prop(0, PROP.opacity)).toBe(0);
    expect(prop(2, PROP.opacity)).toBe(0);
    glide(160, 466, 160, 300, 10);
    expect(prop(1, PROP.opacity)).toBe(0);
    tap(55, 375);
    expect(prop(0, PROP.scaleX)).toBe(1);
    // Content scroll survived visiting two destinations and another app.
    expect(Bun.hash(world.render())).not.toBe(beforeScroll);
    tap(120, 210);
    const detail = Bun.hash(world.render());
    glide(4, 240, 240, 240);
    expect(Bun.hash(world.render())).not.toBe(detail);
    frame(40, 466);
    for (let i = 1; i <= 18; i++) frame(40 + i * 10, 466);
    expect(prop(0, PROP.scaleX)).toBe(1);
    expect(prop(1, PROP.scaleX)).toBe(1);
    expect(prop(1, PROP.opacity)).toBe(1);
    expect(prop(0, PROP.translateX) - prop(1, PROP.translateX)).toBeCloseTo(332, 5);
    expect(prop(1, PROP.translateX) + 320).toBeGreaterThan(100);
    frame(); idle();
    expect(prop(1, PROP.translateX)).toBe(0);
    expect(actions.length).toBeGreaterThanOrEqual(8);
    // Home -> bar -> deck, close every live window, then reopen only Today.
    const backgroundBeforeHome = [0, 2].map(i => [prop(i, PROP.translateX), prop(i, PROP.translateY), prop(i, PROP.scaleX)]);
    frame(160, 466);
    for (let i = 1; i <= 18; i++) {
      frame(160, 466 - i * 2);
      expect([0, 2].map(j => prop(j, PROP.opacity))).toEqual([0, 0]);
      expect([0, 2].map(j => [prop(j, PROP.translateX), prop(j, PROP.translateY), prop(j, PROP.scaleX)])).toEqual(backgroundBeforeHome);
    }
    frame(); idle();
    expect(prop(1, PROP.opacity)).toBe(0);
    frame(160, 466);
    const parked = [0, 1, 2].map(i => [prop(i, PROP.translateY), prop(i, PROP.scaleX)]);
    for (let i = 1; i <= 60; i++) {
      frame(160, 466 - i * 7);
      expect(Math.max(...[0, 1, 2].map(j => prop(j, PROP.translateX) + 320 * prop(j, PROP.scaleX)))).toBeLessThan(48);
    }
    expect([0, 1, 2].map(i => [prop(i, PROP.translateY), prop(i, PROP.scaleX)])).toEqual(parked);
    expect([0, 1, 2].map(i => prop(i, PROP.opacity))).toEqual([1, 1, 1]);
    frame(); idle();
    expect(prop(1, PROP.scaleX)).toBeCloseTo(0.64, 5);
    expect(prop(1, PROP.translateX)).toBeGreaterThan(prop(0, PROP.translateX));
    for (const index of [1, 0, ...APPS.map((_, i) => i).slice(2)]) {
      expect(prop(index, PROP.translateX)).toBeCloseTo(57.6, 4);
      glide(160, 250, 160, 100);
      expect(prop(index, PROP.opacity)).toBe(0);
    }
    tap(160, 220); tap(55, 375);
    expect(prop(0, PROP.scaleX)).toBe(1);
    expect(prop(0, PROP.opacity)).toBe(1);
    expect(prop(1, PROP.opacity)).toBe(0);
    expect(prop(2, PROP.opacity)).toBe(0);
    glide(160, 466, 160, 425, 18, 18);
    expect(prop(0, PROP.translateX)).toBeCloseTo(57.6, 4);
    expect(prop(1, PROP.opacity)).toBe(0);
    expect(prop(2, PROP.opacity)).toBe(0);
    tap(160, 220); // Reopen Today from the one-window switcher.
    // Every icon opens its own retained content, including the second page.
    for (const [index, app] of APPS.entries()) {
      glide(160, 466, 160, 425);
      if (index === 12) {
        const dock = named.get("TouchHomeDock")!;
        host!.debugInspect(dock); world.render(); const dockXY = host!.debugRectXY();
        frame(280, 200);
        for (let i = 1; i <= 12; i++) frame(280 - i * 10, 200);
        const page0 = writes.get(named.get("TouchHomePage0")!)!.get(PROP.translateX)!;
        const page1 = writes.get(named.get("TouchHomePage1")!)!.get(PROP.translateX)!;
        expect(page0).toBeLessThan(-100);
        expect(page1 - page0).toBe(320);
        host!.debugInspect(dock); world.render(); expect(host!.debugRectXY()).toBe(dockXY);
        frame(40, 200); frame(); idle(); host!.debugInspect(0);
        expect(writes.get(named.get("TouchHomePage1")!)!.get(PROP.translateX)).toBe(0);
      }
      tap(app.x + 28, app.y + 28);
      expect(prop(index, PROP.scaleX)).toBe(1);
      expect(prop(index, PROP.opacity)).toBe(1);
      for (const other of APPS.map((_, i) => i).filter(i => i !== index)) expect(prop(other, PROP.opacity)).toBe(0);
      glide(160, 180, 160, 410); // Restore the top even when this retained app was scrolled earlier.
      const before = Bun.hash(world.render());
      glide(160, 380, 160, 200);
      expect(Bun.hash(world.render()), app.name).not.toBe(before);
    }
    glide(160, 466, 160, 425);
    expect(writes.get(named.get("TouchHomePage1")!)!.get(PROP.translateX)).toBe(0);
    // Dock icons keep their identity on the second page; a swipe from an icon
    // never turns its release into a tap.
    tap(APPS[1].x + 28, APPS[1].y + 28);
    expect(prop(1, PROP.scaleX)).toBe(1);
    glide(160, 466, 160, 425);
    glide(45, 190, 280, 190);
    expect(writes.get(named.get("TouchHomePage0")!)!.get(PROP.translateX)).toBe(0);
    expect(nodes.every((_, i) => prop(i, PROP.opacity) === 0)).toBe(true);
    // Browsing Calculator must not replace Music as Home's most recent app.
    glide(160, 466, 160, 365);
    expect(prop(1, PROP.translateX)).toBeCloseTo(57.6, 5);
    glide(160, 230, 250, 230, 18, 8);
    expect(prop(15, PROP.translateX)).toBeCloseTo(57.6, 5);
    const deckPose = nodes.map((_, i) => [prop(i, PROP.translateX), prop(i, PROP.translateY), prop(i, PROP.scaleX)]);
    frame(310, 425); frame();
    for (let f = 0; f < 45; f++) {
      frame();
      nodes.forEach((_, i) => {
        expect(prop(i, PROP.translateY)).toBe(deckPose[i][1]);
        expect(prop(i, PROP.scaleX)).toBe(deckPose[i][2]);
        if (deckPose[i][0] >= 320) expect(prop(i, PROP.translateX)).toBe(deckPose[i][0]);
        else expect(prop(i, PROP.translateX)).toBeLessThanOrEqual(deckPose[i][0]);
      });
      expect(nodes.every((_, i) => [0, 1].includes(prop(i, PROP.opacity)))).toBe(true);
      if (f % 9 === 0) checkCullingPixels();
    }
    idle();
    glide(160, 466, 160, 365);
    expect(prop(1, PROP.translateX)).toBeCloseTo(57.6, 5);
    expect(prop(15, PROP.translateX)).toBeLessThan(prop(1, PROP.translateX));
    // Opening a page-two app through the deck retains page one underneath.
    glide(160, 230, 250, 230, 18, 8); tap(160, 220);
    expect(prop(15, PROP.scaleX)).toBe(1);
    frame(160, 466);
    for (let i = 1; i <= 18; i++) frame(160, Math.round(466 - 41 * i / 18));
    frame();
    for (let i = 0; i < 120; i++) {
      frame();
      expect(prop(15, PROP.translateX)).toBeGreaterThanOrEqual(0);
      expect(prop(15, PROP.translateX) + 320 * prop(15, PROP.scaleX)).toBeLessThanOrEqual(320);
    }
    expect(prop(15, PROP.translateX)).toBe(132);
    expect(prop(15, PROP.translateY)).toBe(132);
    expect(prop(15, PROP.opacity)).toBe(0);
    expect(writes.get(named.get("TouchHomePage0")!)!.get(PROP.translateX)).toBe(0);
    const finalNodes: number[] = [];
    const collect = (n: any) => { if (n.n?.startsWith("TouchWindow")) finalNodes.push(n.i); n.k?.forEach(collect); };
    collect(world.getTree());
    expect(finalNodes).toEqual(nodes);
  });
});
