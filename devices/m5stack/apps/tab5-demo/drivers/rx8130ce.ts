import { io, ResourceStatus, type I2CDevice } from "@pocketjs/framework/io";
import { read, write, bytes, type I2CStep } from "@pocketjs/framework/io/i2c";
import { nowMicros, settle, sleep } from "@pocketjs/framework/worker";
import { decodeRx8130ce, type RtcTime } from "./decode";

export interface RtcSetTime {
  readonly year: number; readonly month: number; readonly day: number;
  readonly hour: number; readonly minute: number; readonly second: number;
}
export type RtcSetStatus = "idle" | "queued" | "reading" | "writing" |
  "verifying" | "recovering" | "succeeded" | "failed";

const STOP = 0x40, TEST = 0x80, VLF = 0x02;
const POLL_MICROS = 1_000_000, RETRY_MICROS = 1000, SET_TIMEOUT_MICROS = 2_000_000;
// Flags are write-zero-to-clear; writing one preserves concurrent events.
// Bit 6 is reserved/read-zero, and VBFF (bit 0) is read-only.
const CLEAR_ONLY_VLF = 0xbd;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function bcd(value: number): number { return Math.floor(value / 10) * 16 + value % 10; }
function leap(year: number): boolean { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
function monthDays(year: number, month: number): number {
  return MONTH_DAYS[month - 1]! + (month === 2 && leap(year) ? 1 : 0);
}
function daysSince2000(year: number, month: number, day: number): number {
  const years = year - 2000;
  return years * 365 + Math.floor((years + 3) / 4) + MONTH_START[month - 1]! +
    (month > 2 && leap(year) ? 1 : 0) + day - 1;
}
function normalize(value: RtcSetTime): RtcTime | undefined {
  if (!value || ![value.year, value.month, value.day, value.hour, value.minute, value.second].every(Number.isInteger) ||
      value.year < 2000 || value.year > 2099 || value.month < 1 || value.month > 12 ||
      value.day < 1 || value.day > monthDays(value.year, value.month) ||
      value.hour < 0 || value.hour > 23 || value.minute < 0 || value.minute > 59 ||
      value.second < 0 || value.second > 59) return undefined;
  return { year: value.year, month: value.month, day: value.day,
    weekday: (6 + daysSince2000(value.year, value.month, value.day)) % 7,
    hours: value.hour, minutes: value.minute, seconds: value.second };
}
function secondsSince2000(time: RtcTime): number {
  return daysSince2000(time.year, time.month, time.day) * 86400 +
    time.hours * 3600 + time.minutes * 60 + time.seconds;
}
/** A setting that cannot be confirmed; the message is the reported setError. */
class SettingError extends Error {}
const CANCELLED = "RTC setting cancelled; time not confirmed";
const TIMED_OUT = "RTC setting timed out; time not confirmed";

/** Epson ETM50E-10 §§13.2, 14.1, 14.5 and 18.5. Normal polling never writes.
 *  One task polls once a second and executes a requested setting as a
 *  sequence of awaited transactions. */
export class Rx8130ce {
  readonly device: I2CDevice;
  latest: { time: RtcTime; observedAtMicros: number } | undefined;
  currentValid = false;
  invalidSamples = 0;
  transfers = 0;
  raw: readonly number[] | undefined;
  error: number | undefined;
  setStatus: RtcSetStatus = "idle";
  setError: string | undefined;
  lastSetTime: RtcTime | undefined;
  private target: RtcTime | undefined;
  private outcome: ((status: "succeeded" | "failed") => void) | undefined;
  private result: Promise<"succeeded" | "failed"> = Promise.resolve("failed");
  private wake: (() => void) | undefined;
  private resumeControl = 0;
  private mayBeStopped = false;
  private closing = false;
  private closed = false;
  constructor(node: string) {
    this.device = io.i2c(node).open({ address: 0x32, timeoutMillis: 20 });
    void this.run();
  }
  get setting(): boolean { return this.target !== undefined; }

  /** Queues one confirmed UI request. Acceptance does not mean the RTC changed;
   *  settled() resolves with the verified outcome. */
  requestSetTime(value: RtcSetTime): boolean {
    if (this.setting || this.closing || this.closed) return false;
    const target = normalize(value);
    if (!target) {
      this.setStatus = "failed";
      this.setError = "Invalid Gregorian date/time (years 2000–2099)";
      return false;
    }
    this.target = target;
    this.setStatus = "queued";
    this.setError = undefined;
    this.currentValid = false;
    this.result = new Promise(resolve => { this.outcome = resolve; });
    this.wake?.();
    return true;
  }
  /** The final status of the accepted request, or of the last one. */
  settled(): Promise<"succeeded" | "failed"> { return this.result; }

  /** Ends the task. A potentially stopped write recovers before the native
   *  resource closes; `setting` is false once the task has ended. */
  close(): void {
    if (this.closed || this.closing) return;
    this.closing = true;
    this.wake?.();
  }

  private async run(): Promise<void> {
    await sleep(0); // IO starts in the first turn, after the owner's requests.
    while (!this.closing) {
      if (this.target) await this.setTime(this.target);
      else await this.poll();
      if (!this.target && !this.closing) await this.idle(POLL_MICROS);
    }
    this.device.close();
    this.closed = true;
    this.currentValid = false;
  }
  /** Sleeps until the deadline, a setting request or close. */
  private idle(micros: number): Promise<void> {
    return new Promise<void>(resolve => {
      this.wake = resolve;
      void sleep(micros).then(resolve);
    }).then(() => { this.wake = undefined; });
  }
  private sample(data: Uint8Array): void {
    ++this.transfers;
    this.raw = Array.from(data);
    const time = decodeRx8130ce(data);
    this.currentValid = !!time;
    if (time) this.latest = { time, observedAtMicros: nowMicros()! };
    else ++this.invalidSamples;
  }
  private async poll(): Promise<void> {
    let request: number;
    while ((request = this.device.submit([read(0x10, [bytes(15)])])) < 0) {
      this.currentValid = false;
      await this.idle(RETRY_MICROS);
      if (this.target || this.closing) return;
    }
    const record = await settle(request);
    if (record.status === ResourceStatus.ok) { this.error = undefined; this.sample(record.data); }
    else { this.error = record.status; this.currentValid = false; }
    if (this.target) this.currentValid = false;
  }
  private matches(data: Uint8Array, target: RtcTime, writtenAt: number, allowVlf: boolean): RtcTime | undefined {
    if (data.length !== 15 || data[14] !== this.resumeControl) return undefined;
    const checked = data.slice();
    if (allowVlf) checked[13] = checked[13]! & ~VLF;
    const time = decodeRx8130ce(checked);
    if (!time || time.weekday !== (6 + daysSince2000(time.year, time.month, time.day)) % 7) return undefined;
    const elapsedSeconds = Math.floor(Math.max(0, nowMicros()! - writtenAt) / 1_000_000) + 1;
    const delta = secondsSince2000(time) - secondsSince2000(target);
    return delta >= 0 && delta <= elapsedSeconds ? time : undefined;
  }
  private checkCancelled(): void { if (this.closing) throw new SettingError(CANCELLED); }
  /** Submits until accepted, then waits for the completion or the deadline.
   *  An overdue request is cancelled once and its terminal outcome observed. */
  private async transfer(script: readonly I2CStep[], deadline: number): Promise<Uint8Array> {
    let request: number;
    while ((request = this.device.submit(script)) < 0) {
      if (nowMicros()! >= deadline) throw new SettingError(TIMED_OUT);
      await sleep(RETRY_MICROS);
      this.checkCancelled();
    }
    const completion = settle(request);
    const remaining = Math.max(0, deadline - nowMicros()!);
    const outcome = await Promise.race([completion, sleep(remaining).then(() => undefined)]);
    if (outcome === undefined) this.device.cancel(request);
    const record = outcome ?? await completion;
    if (record.status !== ResourceStatus.ok) {
      this.error = record.status;
      throw new SettingError(outcome === undefined ? TIMED_OUT : `RTC ${this.setStatus} outcome ${record.status}; time not confirmed`);
    }
    if (outcome === undefined) throw new SettingError(TIMED_OUT);
    return record.data;
  }
  private async setTime(target: RtcTime): Promise<void> {
    const deadline = nowMicros()! + SET_TIMEOUT_MICROS;
    this.setStatus = "reading";
    this.currentValid = false;
    this.mayBeStopped = false;
    let failure: string | undefined;
    try {
      const control = await this.transfer([read(0x1e, [bytes(1)])], deadline);
      if (control.length !== 1) throw new SettingError("RTC control read was incomplete");
      // HOUR is always 24-hour BCD. TEST must be zero whenever CTRL0 is written.
      this.resumeControl = control[0]! & ~(STOP | TEST);
      this.checkCancelled();
      this.setStatus = "writing";
      // Three writes plus final STOP use seven of the controller's eight slots.
      // STOP is set and cleared in this one native transaction, not across turns.
      this.mayBeStopped = true;
      const writtenAt = nowMicros()!;
      await this.transfer([write(0x1e, this.resumeControl | STOP),
        write(0x10, bcd(target.seconds), bcd(target.minutes), bcd(target.hours), 1 << target.weekday,
          bcd(target.day), bcd(target.month), bcd(target.year - 2000)),
        write(0x1e, this.resumeControl)], deadline);
      this.checkCancelled();
      this.setStatus = "verifying";
      const verified = await this.transfer([read(0x10, [bytes(15)])], deadline);
      this.raw = Array.from(verified);
      if (!this.matches(verified, target, writtenAt, true)) throw new SettingError("RTC time/control readback mismatch");
      this.mayBeStopped = false;
      this.checkCancelled();
      await this.transfer([write(0x1d, CLEAR_ONLY_VLF)], deadline);
      this.checkCancelled();
      const final = await this.transfer([read(0x10, [bytes(15)])], deadline);
      this.raw = Array.from(final);
      const time = this.matches(final, target, writtenAt, false);
      if (!time) {
        if (final.length === 15 && (final[14]! & (STOP | TEST))) this.mayBeStopped = true;
        throw new SettingError("RTC final readback invalid (time, STOP, TEST or VLF)");
      }
      this.sample(final);
      this.lastSetTime = { ...time };
      this.setStatus = "succeeded";
      this.setError = this.error = undefined;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      if (this.mayBeStopped) {
        this.setStatus = "recovering";
        this.setError = failure;
        failure = await this.recover(failure);
      }
      this.setStatus = "failed";
      this.setError = failure;
      this.currentValid = false;
    } finally {
      this.target = undefined;
      this.outcome?.(failure ? "failed" : "succeeded");
      this.outcome = undefined;
    }
  }
  /** At most three attempts to restore CTRL0 and read it back; one write plus
   *  a one-byte read and STOP use all eight command slots. */
  private async recover(failure: string): Promise<string> {
    for (let attempt = 1; attempt <= 3; ++attempt) {
      const request = this.device.submit([write(0x1e, this.resumeControl), read(0x1e, [bytes(1)])]);
      if (request >= 0) {
        const record = await settle(request);
        if (record.status === ResourceStatus.ok && record.data.length === 1 && record.data[0] === this.resumeControl) {
          this.mayBeStopped = false;
          return `${failure}; clock resumed`;
        }
      }
      if (attempt < 3) await sleep(RETRY_MICROS);
    }
    return `${failure}; recovery failed, STOP may remain set`;
  }
}
