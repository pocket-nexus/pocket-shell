// Unit Swap's worker: one unit at a time on Port A (`porta`). Every 250 ms
// it probes the addresses of the units it knows (and every 2 s all of
// 0x08..0x77), matches the answering set against the catalogue and, when
// the same set answers again 100 ms later, lets that driver identify and
// configure the unit, and runs the driver until two
// cycles in a row fail; then it probes again. The UI receives the state
// snapshot after each reading, an event per attach, removal and card, and
// a temperature history that runs across swaps.
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import {
  Event, HISTORY_BYTES, HISTORY_POINTS, HISTORY_SECONDS, KNOWN_ADDRESSES, Kind, Phase, STATE_BYTES,
  emptyState, encodeEvent, encodeHeader, encodeHistory, hex2, matchUnit, unitName, type HistoryPoint,
} from "./protocol";
import { Bus, message } from "./units/bus";
import { identifyEnv3 } from "./units/env3";
import { identifyRfid2 } from "./units/rfid2";
import { identifySonic } from "./units/sonic";
import { now, pace, type Identify, type Unit, type UnitContext } from "./units/unit";

const DRIVERS: Record<number, Identify> = {
  [Kind.env3]: identifyEnv3, [Kind.rfid2]: identifyRfid2, [Kind.sonic]: identifySonic,
};
const ROUND = 250_000;
/** A connector being pushed in makes and breaks contact: a match is
 *  identified only when the same addresses answer again this much later. */
const SETTLE = 100_000;
const FULL_SCAN_ROUNDS = 8;
const ALL_ADDRESSES = Array.from({ length: 0x78 - 0x08 }, (_, index) => 0x08 + index);
/** An address no catalogued unit uses. It answers when an unknown device
 *  sits on it, or for every address when SDA is held low. */
const CANARY = 0x08;
/** More answers than this in one scan read as a held-low SDA line. */
const BUS_FAULT_ANSWERS = 24;

const bus = new Bus("porta");
const state = emptyState();
const stateChannel = io.channel("state"), historyChannel = io.channel("history"), eventChannel = io.channel("events");
const stateRecord = new Uint8Array(STATE_BYTES), historyRecord = new Uint8Array(HISTORY_BYTES);
const history: HistoryPoint[] = [];
let unit: Unit | undefined;
let startedAt = 0, foundAt = 0, firstReading = false;

function publishState(): void {
  state.sequence += 1;
  state.requests = bus.requests;
  state.failures = bus.failures;
  encodeHeader(state, stateRecord);
  if (state.phase === Phase.running) unit?.encode(stateRecord);
  stateChannel.publish(stateRecord);
}

function emit(event: number, detail = 0, payload: Uint8Array = new Uint8Array(0)): void {
  eventChannel.publish(encodeEvent({ event, kind: state.kind, detail, millis: Math.round((now() - startedAt) / 1000), payload }));
}

const context: UnitContext = {
  bus, emit,
  changed() {
    if (!firstReading) {
      firstReading = true;
      state.detectMs = Math.round((now() - foundAt) / 1000);
      console.log(`${unitName(state.kind)}: first reading ${state.detectMs} ms after the scan that found it`);
    }
    publishState();
  },
};

function enter(phase: number, kind: number = Kind.none): boolean {
  const changed = state.phase !== phase || state.kind !== kind;
  state.phase = phase;
  state.kind = kind;
  if (changed) publishState();
  return changed;
}

const names = (addresses: readonly number[]) => addresses.map(address => `0x${hex2(address)}`).join(" ");

async function supervise(): Promise<void> {
  let round = 0, reported = "";
  let settling: { key: string; at: number } | undefined;
  for (;;) {
    try {
      await attach();
    } catch (error) {
      // A full resource table or a unit pulled mid-identify: probe again.
      console.log(`supervisor: ${message(error)}`);
      if (unit) { unit.close(); unit = undefined; }
      enter(Phase.waiting);
      await sleep(500_000);
    }
  }

  /** One probe round, and the whole life of a unit when one matches. */
  async function attach(): Promise<void> {
    const start = now();
    let answering = await bus.probe([CANARY, ...KNOWN_ADDRESSES]);
    if (answering.includes(CANARY) || round % FULL_SCAN_ROUNDS === 0) answering = await bus.probe(ALL_ADDRESSES);
    ++round;
    state.scanMs = Math.round((now() - start) / 1000);
    state.addresses = answering;
    const key = names(answering);

    if (answering.length > BUS_FAULT_ANSWERS) {
      settling = undefined;
      if (enter(Phase.busFault)) { emit(Event.busFault, answering.length); console.log(`Port A: ${answering.length} addresses answer, SDA held low`); }
      await pace(start, ROUND);
      return;
    }
    const type = matchUnit(answering);
    if (!type) {
      settling = undefined;
      enter(answering.length ? Phase.unknown : Phase.waiting);
      if (answering.length && key !== reported) {
        emit(Event.unknown, answering.length, Uint8Array.from(answering.slice(0, 8)));
        console.log(`Port A: unknown device ${key}`);
      }
      reported = answering.length ? key : "";
      await pace(start, ROUND);
      return;
    }

    if (settling?.key !== key) {
      settling = { key, at: start };
      enter(Phase.identifying, type.kind);
      await sleep(SETTLE);
      return;
    }
    foundAt = settling.at;
    settling = undefined;
    firstReading = false;
    state.detectMs = 0;
    enter(Phase.identifying, type.kind);
    const candidate = await DRIVERS[type.kind]!(context);
    if (!candidate) {
      // The addresses matched but the identity registers did not.
      if (key !== reported) emit(Event.rejected, type.kind, Uint8Array.from(answering.slice(0, 8)));
      reported = key;
      enter(Phase.unknown);
      await pace(start, 1_000_000);
      return;
    }
    reported = "";
    unit = candidate;
    state.attaches += 1;
    state.phase = Phase.running;
    emit(Event.attached, type.addresses.length, Uint8Array.from(type.addresses));
    console.log(`${type.name} attached at ${names(type.addresses)}`);
    publishState();
    try {
      await candidate.run();
    } catch (error) {
      console.log(`${type.name}: ${message(error)}`);
    }
    candidate.close();
    unit = undefined;
    emit(Event.removed);
    console.log(`${type.name} removed`);
    state.addresses = [];
    enter(Phase.waiting);
  }
}

/** One point every HISTORY_SECONDS: the ENV III reading while one runs, a gap
 *  otherwise, so the chart shows the time the unit was off the port. */
async function recordHistory(): Promise<void> {
  for await (const _ of io.timer(HISTORY_SECONDS * 1_000_000)) {
    history.push(unit?.history?.() ?? { celsius: undefined, humidity: undefined });
    if (history.length > HISTORY_POINTS) history.shift();
    encodeHistory(history, historyRecord);
    historyChannel.publish(historyRecord);
  }
}

/** The counters move with every request; the state goes out twice a
 *  second besides the readings. */
async function heartbeat(): Promise<void> {
  for await (const _ of io.timer(500_000)) publishState();
}

async function commands(): Promise<void> {
  for await (const record of io.channel("commands").observe()) unit?.command?.(record[0]!);
}

async function main(): Promise<void> {
  // Alarms set during bootstrap arm in the first turn, which latches the
  // clock.
  await sleep(0);
  startedAt = now();
  publishState();
  void recordHistory();
  void heartbeat();
  void commands();
  await supervise();
}
void main().catch(error => console.log(`unit-swap worker: ${message(error)}`));
console.log("unit-swap worker: porta node declared");
