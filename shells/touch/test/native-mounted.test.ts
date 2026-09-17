// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "bun:test";
import { bootWorld, treeHasText } from "../../../vendor/pocketjs/hosts/sim/sim.ts";
import { __packTouchWide } from "../../../vendor/pocketjs/framework/src/touch.ts";
import { PROP } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import registry from "../native-apps.json";
import { shellLayout } from "../src/layout.ts";

test("native apps launch once, return with their last frame, and close through the host", async () => {
  const g = globalThis as any, previous = g.__pocketjsNativeReturn;
  g.__pocketjsNativeReturn = undefined;
  const launched: string[] = [], closed: string[] = [];
  let allowLaunch = true, allowClose = false, ops: any;
  const writes = new Map<number, Map<number, number>>();
  try {
    const world = await bootWorld("pocketshell-touch-e7", 30, undefined, host => {
      ops = host;
      host.appTable = () => JSON.stringify({ kind: "native", current: "pocketshell-touch", apps: registry.apps, resume: null });
      host.appLaunch = (output: string) => { launched.push(output); return Number(allowLaunch); };
      host.appClose = (output: string) => { closed.push(output); return Number(allowClose); };
      const write = (id: number, prop: number, value: number) => {
        if (!writes.has(id)) writes.set(id, new Map());
        writes.get(id)!.set(prop, value);
      };
      const directProp = host.setProp as (id: number, prop: number, value: number) => void;
      host.setProp = (id: number, prop: number, value: number) => { write(id, prop, value); directProp(id, prop, value); };
      const direct = host.setPropBatch as (buffer: ArrayBuffer) => void;
      host.setPropBatch = (buffer: ArrayBuffer) => {
        const d = new Float64Array(buffer);
        for (let i = 0; i < d.length; i += 3) {
          write(d[i], d[i + 1], d[i + 2]);
        }
        direct(buffer);
      };
    }, { width: 360, height: 640 });
    const frame = (x?: number, y?: number) => { world.frame(0, undefined, x === undefined ? [] : [__packTouchWide(0, x, y!)]); world.tick(); world.tick(); };
    const idle = () => { for (let i = 0; i < 90; i++) frame(); };
    const tap = (x: number, y: number) => { frame(x, y); frame(x, y); frame(); idle(); };
    const dismiss = () => { for (let i = 0; i <= 15; i++) frame(180, 250 - i * 11); frame(); idle(); };
    idle();
    expect(treeHasText(world.getTree(), "Clear")).toBe(true);
    expect(launched).toEqual([]);
    const icon = shellLayout(360, 640).icon(4);
    tap(icon.x + 28, icon.y + 28);
    expect(launched).toEqual(["clear-main"]);
    idle(); expect(launched).toHaveLength(1);
    const shot = ops.uploadTexture(new Uint8Array([255, 20, 20, 255]), 1, 1, 3);
    expect(shot).toBeGreaterThanOrEqual(0);
    g.__pocketjsNativeReturn("clear-main", "home", shot, 0, .05, -.04, .9);
    idle(); expect(launched).toHaveLength(1);
    let hasShot = false, clearNode = -1, placeholder = -1;
    const visit = (n: any) => { if (n.n === "NativeAppShot4") hasShot = true; if (n.n === "TouchWindow4") clearNode = n.i; if (n.n === "TouchWindowContent4") placeholder = n.i; n.k?.forEach(visit); };
    visit(world.getTree());
    expect(hasShot).toBe(true);
    expect(writes.get(placeholder)?.get(PROP.opacity)).toBe(0);
    tap(icon.x + 28, icon.y + 28); expect(launched).toHaveLength(2);
    g.__pocketjsNativeReturn("clear-main", "switcher", shot, 0, .05, -.04, .9);
    idle(); dismiss();
    expect(closed).toEqual(["clear-main"]);
    expect(writes.get(clearNode)?.get(PROP.opacity)).toBe(1);
    allowClose = true; dismiss();
    expect(closed).toHaveLength(2);
    expect(writes.get(clearNode)?.get(PROP.opacity)).toBe(0);
    tap(180, 590); allowLaunch = false; tap(icon.x + 28, icon.y + 28);
    expect(launched).toHaveLength(3);
    expect(treeHasText(world.getTree(), "Pocket Clear is not installed.")).toBe(true);
    idle(); expect(launched).toHaveLength(3);
  } finally { g.__pocketjsNativeReturn = previous; }
});
