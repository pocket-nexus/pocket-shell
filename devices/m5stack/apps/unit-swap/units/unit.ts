// What the supervisor needs from a unit driver.
import { nowMicros, sleep } from "@pocketjs/framework/worker";
import type { HistoryPoint } from "../protocol";
import type { Bus } from "./bus";

export type Emit = (event: number, detail?: number, payload?: Uint8Array) => void;
export interface UnitContext {
  readonly bus: Bus;
  /** Publishes an event record. */
  readonly emit: Emit;
  /** Called after each new reading; the supervisor publishes the state. */
  readonly changed: () => void;
}

export interface Unit {
  readonly kind: number;
  /** Set when the first reading arrived. */
  readonly ready: boolean;
  /** Samples until the unit stops answering, then resolves. */
  run(): Promise<void>;
  /** Writes the reading at READING_OFFSET of the state record. */
  encode(into: Uint8Array): void;
  command?(command: number): void;
  /** The point the history records now, for a unit that has one. */
  history?(): HistoryPoint | undefined;
  /** Closes the unit's handles. */
  close(): void;
}

/** Opens the unit's addresses, checks its identity registers and configures
 *  it; undefined (handles closed) when the device is not this unit. */
export type Identify = (context: UnitContext) => Promise<Unit | undefined>;

/** A unit counts as removed after this many failed cycles in a row. */
export const REMOVED_AFTER = 2;

export function now(): number {
  return nowMicros() ?? 0;
}

/** Sleeps until `start + period` (microseconds), at least 1 ms. */
export function pace(start: number, period: number): Promise<void> {
  return sleep(Math.max(1000, start + period - now()));
}
