import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bindWorker, FactKind, type HostFact, type WorkerHost } from "@pocketjs/framework/worker";
import { Rx8130ce, type RtcSetTime } from "../apps/tab5-demo/drivers/rx8130ce";

type Step = { op: "read"; register: number; layout: { size: number }[] } |
  { op: "write"; register: number; data: Uint8Array };
/** The SDK's I2C script payload: a 4-byte header, then [op, register, length] per step. */
function decodeScript(payload: Uint8Array): Step[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const steps: Step[] = [];
  let offset = 4;
  for (let i = 0; i < payload[1]!; ++i) {
    const op = payload[offset]!, register = payload[offset + 1]!, length = view.getUint16(offset + 2, true);
    offset += 4;
    if (op === 1) steps.push({ op: "read", register, layout: [{ size: length }] });
    else { steps.push({ op: "write", register, data: payload.slice(offset, offset + length) }); offset += length; }
  }
  return steps;
}
/** An I2C register model behind the worker host: scripts execute on demand
 *  and complete through turns, as the native executor would. */
class Bus {
  registers = new Uint8Array(256);
  submitted: { id: number; script: Step[] }[] = [];
  timers: number[] = [];
  cancelled: number[] = [];
  closed = false;
  reject = 0;
  overflows = 0;
  private next = 1;
  submit(script: Step[]): number {
    if (this.reject) { --this.reject; return -4; }
    const commands = 1 + script.reduce((sum, step) => sum + (step.op === "write" ? 2 :
      step.layout.reduce((size, field) => size + field.size, 0) > 1 ? 6 : 5), 0);
    if (commands > 8) ++this.overflows;
    const id = this.next++;
    this.submitted.push({ id, script });
    return id;
  }
  cancel(id: number): void { this.cancelled.push(id); }
  close(): void { this.closed = true; }
  execute(script: Step[], operationLimit = script.length): Uint8Array {
    const result: number[] = [];
    for (const step of script.slice(0, operationLimit)) {
      if (step.op === "read") {
        const length = step.layout.reduce((sum, field) => sum + field.size, 0);
        result.push(...this.registers.subarray(step.register, step.register + length));
      } else {
        for (let i = 0; i < step.data.length; ++i) {
          const address = step.register + i;
          if (address === 0x1d) {
            const previous = this.registers[address]!;
            this.registers[address] = (previous & step.data[i]! & 0xbe) | (previous & 1);
          } else this.registers[address] = step.data[i]!;
        }
      }
    }
    return Uint8Array.from(result);
  }
}
let bus: Bus;
const global = globalThis as any;
/** A fresh scheduler per driver: earlier drivers' deadlines and waiters are dropped. */
function installHost(): void {
  const host: WorkerHost = {
    open: () => 1,
    submit: (_handle, _opcode, payload) => bus.submit(decodeScript(payload)),
    cancel: id => { bus.cancel(id); return 0; },
    close: () => { bus.close(); return 0; },
    write: () => 0, publish: () => 0, declareChannel: () => 0,
    timer: (_id, deadline) => { bus.timers.push(deadline); return 0; },
  };
  global.__pocketWorker = host;
  bindWorker({ entry: "worker.ts", nodes: [{ name: "i2c0", kind: "i2c" }] });
}
/** The host runs Promise jobs after the turn returns; a macrotask drains them here. */
const jobs = () => new Promise<void>(done => setTimeout(done, 0));
const target: RtcSetTime = { year: 2024, month: 2, day: 29, hour: 12, minute: 34, second: 56 };
const leapTime = [0x56, 0x34, 0x12, 0x10, 0x29, 0x02, 0x24];
function harness() {
  installHost();
  const rtc = new Rx8130ce("i2c0");
  let now = 1000, cursor = 0;
  async function turn(completion?: { id: number; status: number; data?: Uint8Array }, advance = 1000) {
    now += advance;
    const facts: HostFact[] = completion ? [{ kind: FactKind.complete, handle: 1, request: completion.id, status: completion.status,
      offset: 0, data: completion.data ?? new Uint8Array(), timer: 0, channel: 0, deadline: 0, missed: 0 }] : [];
    global.__pocketWorkerTurn({ generation: 1, sequence: now, nowMicros: now }, facts);
    await jobs();
  }
  async function complete(status = 0, operationLimit?: number, data?: Uint8Array) {
    const request = bus.submitted[cursor++];
    expect(request).toBeDefined();
    const result = data ?? bus.execute(request!.script, operationLimit);
    await turn({ id: request!.id, status, data: result });
    return request!.script;
  }
  async function start(time = target) { expect(rtc.requestSetTime(time)).toBe(true); await turn(); }
  return { rtc, turn, complete, start };
}
beforeEach(() => {
  bus = new Bus();
  bus.registers.set(leapTime, 0x10);
  bus.registers[0x1d] = 2;
  bus.registers[0x1e] = 0xbf; // TEST set plus every unrelated CTRL0 bit.
  bus.registers[0x1f] = 0xa5;
});
afterEach(() => {
  expect(bus.overflows).toBe(0); // every script fits the controller's eight command slots
  delete global.__pocketWorker; delete global.__pocketWorkerTurn;
});

describe("RX8130CE confirmed clock setting", () => {
  test("validates Gregorian fields and rejects concurrent requests without IO", () => {
    const { rtc } = harness();
    for (const patch of [{ year: 1999 }, { year: 2100 }, { year: NaN }, { month: 0 }, { month: 13 },
      { day: 0 }, { day: 30 }, { year: 2023 }, { hour: 24 }, { minute: -1 }, { second: 60 }, { day: 1.5 }])
      expect(rtc.requestSetTime({ ...target, ...patch })).toBe(false);
    expect(bus.submitted).toHaveLength(0);
    expect(rtc.requestSetTime({ ...target, year: 2000 })).toBe(true);
    expect(rtc.requestSetTime(target)).toBe(false);
    expect(rtc.setting).toBe(true);
    expect(rtc.setStatus).toBe("queued");
  });
  test("writes BCD and weekday with STOP in one admitted script, then clears only VLF after readback", async () => {
    const { rtc, start, complete } = harness();
    const input = { ...target };
    const settled = rtc.settled();
    await start(input);
    input.hour = 1; // Accepted input is copied.
    await complete(); // control -> write
    const writes = await complete(); // write -> verify
    expect(writes).toEqual([
      { op: "write", register: 0x1e, data: Uint8Array.of(0x7f) },
      { op: "write", register: 0x10, data: Uint8Array.from(leapTime) },
      { op: "write", register: 0x1e, data: Uint8Array.of(0x3f) },
    ]);
    expect(rtc.setting).toBe(true);
    expect(rtc.currentValid).toBe(false);
    await complete(); // verify -> clear
    expect(rtc.setStatus).toBe("verifying");
    expect(rtc.lastSetTime).toBeUndefined();
    bus.registers[0x1d] = 0xbf; // Flags arriving after the control read must survive.
    expect(await complete()).toEqual([{ op: "write", register: 0x1d, data: Uint8Array.of(0xbd) }]);
    expect(bus.registers[0x1d]).toBe(0xbd);
    await complete(); // final readback -> succeeded
    expect(rtc.setting).toBe(false);
    expect(rtc.currentValid).toBe(true);
    expect(rtc.setStatus).toBe("succeeded");
    expect(rtc.setError).toBeUndefined();
    expect(rtc.lastSetTime).toEqual({ year: 2024, month: 2, day: 29, weekday: 4, hours: 12, minutes: 34, seconds: 56 });
    expect(rtc.latest?.time).toEqual(rtc.lastSetTime);
    expect(bus.registers[0x1f]).toBe(0xa5); // Battery/charge controls are untouched.
    expect(await settled).toBe("failed"); // the promise from before the request reports the previous outcome
    expect(await rtc.settled()).toBe("succeeded");
  });
  test("readback accepts elapsed second/date rollover with the matching weekday", async () => {
    const { rtc, start, complete } = harness();
    await start({ year: 2024, month: 2, day: 28, hour: 23, minute: 59, second: 59 });
    await complete(); await complete();
    bus.registers.set([0, 0, 0, 0x10, 0x29, 0x02, 0x24], 0x10);
    await complete(); await complete(); await complete();
    expect(rtc.setStatus).toBe("succeeded");
    expect(rtc.lastSetTime?.day).toBe(29);
  });
  test("wrong readback never clears VLF or reports success, even after recovery", async () => {
    const { rtc, start, complete } = harness();
    await start(); await complete(); await complete();
    bus.registers[0x10] = 0x50;
    await complete();
    expect(rtc.setStatus).toBe("recovering");
    await complete();
    expect(rtc.setStatus).toBe("failed");
    expect(rtc.setError).toContain("readback mismatch");
    expect(rtc.lastSetTime).toBeUndefined();
    expect(bus.registers[0x1d] & 2).toBe(2);
    expect(bus.submitted.flatMap(r => r.script).some(s => s.op === "write" && s.register === 0x1d)).toBe(false);
    expect(await rtc.settled()).toBe("failed");
  });
  test("range endpoints encode year 00/99 and the Gregorian weekday", async () => {
    for (const year of [2000, 2099]) {
      const { rtc, start, complete } = harness();
      await start({ year, month: 1, day: 1, hour: 0, minute: 0, second: 0 });
      await complete(); await complete(); await complete(); await complete(); await complete();
      expect(rtc.setStatus).toBe("succeeded");
      expect(bus.registers[0x16]).toBe(year === 2000 ? 0 : 0x99);
      expect(rtc.lastSetTime?.weekday).toBe(new Date(Date.UTC(year, 0, 1)).getUTCDay());
      bus = new Bus();
    }
  });
  test("failed control read never writes or claims a changed clock", async () => {
    const { rtc, start, complete } = harness();
    await start(); await complete(-1);
    expect(rtc.setStatus).toBe("failed");
    expect(rtc.lastSetTime).toBeUndefined();
    expect(bus.submitted).toHaveLength(1);
  });
  test("partial/unknown write restores CTRL0 and keeps the failed result", async () => {
    const { rtc, start, complete } = harness();
    await start(); await complete();
    await complete(-3, 1); // STOP ACKed, later transfer outcome unknown.
    expect(bus.registers[0x1e]).toBe(0x7f);
    expect(rtc.setStatus).toBe("recovering");
    const recovery = await complete();
    expect(recovery).toEqual([
      { op: "write", register: 0x1e, data: Uint8Array.of(0x3f) },
      { op: "read", register: 0x1e, layout: [{ size: 1 }] },
    ]);
    expect(bus.registers[0x1e]).toBe(0x3f);
    expect(rtc.setStatus).toBe("failed");
    expect(rtc.setError).toContain("clock resumed");
    expect(rtc.currentValid).toBe(false);
    expect(rtc.lastSetTime).toBeUndefined();
  });
  test("recovery is capped at three attempts and reports a possibly stopped clock", async () => {
    const { rtc, start, complete, turn } = harness();
    await start(); await complete(); await complete(-3, 1);
    for (let i = 0; i < 3; ++i) {
      await complete(-1, 0);
      if (i < 2) await turn();
    }
    expect(rtc.setting).toBe(false);
    expect(rtc.setStatus).toBe("failed");
    expect(rtc.setError).toContain("STOP may remain set");
    expect(bus.registers[0x1e] & 0x40).toBe(0x40);
    expect(bus.submitted).toHaveLength(5); // control, write, three recoveries
  });
  test("in-flight close waits for STOP recovery before closing the native resource", async () => {
    const { rtc, start, complete, turn } = harness();
    await start(); await complete();
    rtc.close();
    expect(bus.closed).toBe(false);
    await complete(); // Write completes; cancellation still requires recovery.
    expect(rtc.setStatus).toBe("recovering");
    expect(bus.closed).toBe(false);
    await complete();
    expect(bus.closed).toBe(true);
    expect(rtc.setting).toBe(false);
    expect(rtc.setStatus).toBe("failed");
    expect(rtc.setError).toContain("cancelled");
    const submitted = bus.submitted.length;
    await turn(undefined, 2_000_000);
    expect(bus.submitted).toHaveLength(submitted);
  });
  test("overdue write cancels once and recovers only after its terminal outcome", async () => {
    const { rtc, start, complete, turn } = harness();
    await start(); await complete();
    await turn(undefined, 2_000_000);
    expect(bus.cancelled).toEqual([2]);
    expect(bus.submitted).toHaveLength(2);
    await complete(-3, 1); await complete();
    expect(rtc.setStatus).toBe("failed");
    expect(rtc.setError).toContain("timed out");
  });
  test("admission backpressure does not skip stages and expires without writing", async () => {
    const { rtc, start, turn } = harness();
    bus.reject = 100;
    await start(); await turn(); await turn(undefined, 2_000_000);
    expect(rtc.setStatus).toBe("failed");
    expect(rtc.setError).toContain("timed out");
    expect(bus.submitted).toHaveLength(0);
  });
  test("VLF that cannot clear fails final validation without success", async () => {
    const { rtc, start, complete } = harness();
    await start(); await complete(); await complete(); await complete(); await complete();
    bus.registers[0x1d] |= 2;
    await complete();
    expect(rtc.setStatus).toBe("failed");
    expect(rtc.currentValid).toBe(false);
    expect(rtc.lastSetTime).toBeUndefined();
  });
  test("current validity follows each poll while the last good sample remains available", async () => {
    const { rtc, turn, complete } = harness();
    bus.registers[0x1d] = 0; bus.registers[0x1e] = 0;
    await turn(); await complete();
    expect(rtc.currentValid).toBe(true);
    const latest = rtc.latest;
    bus.registers[0x1d] = 2;
    await turn(undefined, 1_000_000); await complete();
    expect(rtc.currentValid).toBe(false);
    expect(rtc.latest).toBe(latest);
    expect(rtc.invalidSamples).toBe(1);
    await turn(undefined, 1_000_000); await complete(-1);
    expect(rtc.currentValid).toBe(false);
    expect(rtc.error).toBe(-1);
    expect(bus.submitted.every(r => r.script.every(s => s.op === "read"))).toBe(true);
  });
  test("a setting request interrupts the poll interval and polling resumes after it", async () => {
    const { rtc, turn, complete } = harness();
    bus.registers[0x1d] = 0; bus.registers[0x1e] = 0;
    await turn(); await complete(); // first poll
    expect(rtc.requestSetTime(target)).toBe(true);
    await jobs();
    expect(bus.submitted).toHaveLength(2); // the control read, before the one-second poll deadline
    await complete(); await complete(); await complete(); await complete(); await complete();
    expect(rtc.setStatus).toBe("succeeded");
    await turn(undefined, 1_000_000);
    expect(bus.submitted.at(-1)?.script).toEqual([{ op: "read", register: 0x10, layout: [{ size: 15 }] }]);
  });
  test("unexpected STOP in final readback triggers recovery instead of success", async () => {
    const { rtc, start, complete } = harness();
    await start(); await complete(); await complete(); await complete(); await complete();
    bus.registers[0x1e] |= 0x40;
    await complete();
    expect(rtc.setStatus).toBe("recovering");
    await complete();
    expect(rtc.setStatus).toBe("failed");
    expect(rtc.lastSetTime).toBeUndefined();
    expect(bus.registers[0x1e]).toBe(0x3f);
  });
});
