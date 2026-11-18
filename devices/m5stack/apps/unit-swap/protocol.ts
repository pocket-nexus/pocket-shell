// The unit catalogue and the channel records between the UI and the worker,
// little endian.
//
//   state (worker -> UI snapshot, 96 bytes)
//     0 u32 sequence      4 u8 phase          5 u8 unit kind     6 u16 attaches
//     8 u32 I2C requests 12 u32 failed requests
//    16 u16 ms from the scan that found the unit to its first reading
//    18 u16 ms of the last address probe round
//    20 16-byte bitmap of the answering Port A addresses, bit n of byte n >> 3
//    36 the unit's reading, 60 bytes (EnvReading, SonicReading, RfidReading)
//   history (worker -> UI snapshot, 260 bytes)
//     0 u16 points        2 u16 seconds per point
//     4 points oldest first: i16 temperature (0.01 C), u16 humidity (0.01 %);
//       HISTORY_GAP marks a point without an ENV III reading
//   events (worker -> UI ring, 16-byte records)
//     0 u8 event          1 u8 unit kind      2 u8 detail        3 u8 payload length
//     4 u32 ms since the worker started       8 up to 8 payload bytes
//   commands (UI -> worker ring, 8-byte records)
//     0 u8 command

export const STATE_BYTES = 96;
export const READING_OFFSET = 36;
export const HISTORY_POINTS = 64;
export const HISTORY_SECONDS = 5;
export const HISTORY_BYTES = 4 + HISTORY_POINTS * 4;
export const HISTORY_GAP = -32768;
export const EVENT_BYTES = 16;
export const COMMAND_BYTES = 8;

/** What the worker is doing on Port A. */
export const Phase = { waiting: 0, identifying: 1, running: 2, unknown: 3, busFault: 4 } as const;
export const Kind = { none: 0, env3: 1, rfid2: 2, sonic: 3 } as const;
export const Event = {
  attached: 1, removed: 2, unknown: 3, card: 4, cardGone: 5, busFault: 6, written: 7, rejected: 8,
} as const;
export const Command = { writeCard: 1, resetRange: 2 } as const;

/** A unit the worker recognises: the addresses that must all answer a probe
 *  before its driver identifies it. A unit whose addresses include another's
 *  is listed first. */
export interface UnitType { kind: number; name: string; addresses: readonly number[]; measures: string }
export const UNITS: readonly UnitType[] = [
  { kind: Kind.env3, name: "ENV III", addresses: [0x44, 0x70], measures: "SHT30 + QMP6988: temperature, humidity, pressure" },
  { kind: Kind.rfid2, name: "RFID 2", addresses: [0x28], measures: "WS1850S: ISO 14443A cards" },
  { kind: Kind.sonic, name: "Ultrasonic I2C", addresses: [0x57], measures: "RCWL-9620: distance, 2 cm to 4.5 m" },
];
/** Every address a known unit answers on, probed every round. */
export const KNOWN_ADDRESSES = [...new Set(UNITS.flatMap(unit => unit.addresses))].sort((a, b) => a - b);

export function unitName(kind: number): string {
  return UNITS.find(unit => unit.kind === kind)?.name ?? "No unit";
}

/** The first catalogue entry whose addresses all answered. */
export function matchUnit(answering: readonly number[]): UnitType | undefined {
  return UNITS.find(unit => unit.addresses.every(address => answering.includes(address)));
}

export function hex2(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

// ---- state -------------------------------------------------------------------

export interface EnvReading {
  samples: number;
  celsius: number; humidity: number; pascals: number;
  /** The QMP6988's own temperature, a check against the SHT30. */
  qmpCelsius: number; dewPoint: number; altitude: number;
}
export interface SonicReading { samples: number; millimetres: number; raw: number; min: number; max: number; outOfRange: number }
export const CardType = { none: 0, ultralight: 1, classic1k: 2, classic4k: 3, mini: 4, iso14443_4: 5, plus: 6, other: 7 } as const;
export const DataState = { none: 0, read: 1, authFailed: 2, failed: 3, unsupported: 4 } as const;
export const WriteState = { idle: 0, pending: 1, written: 2, failed: 3, noCard: 4 } as const;
export interface RfidReading {
  polls: number; version: number; present: boolean; cards: number;
  atqa: number; sak: number; cardType: number; uid: Uint8Array;
  dataState: number; data: Uint8Array; writeState: number;
}

export interface State {
  sequence: number; phase: number; kind: number; attaches: number;
  requests: number; failures: number; detectMs: number; scanMs: number;
  addresses: number[];
  env?: EnvReading; sonic?: SonicReading; rfid?: RfidReading;
}

export function emptyState(): State {
  return { sequence: 0, phase: Phase.waiting, kind: Kind.none, attaches: 0, requests: 0, failures: 0, detectMs: 0, scanMs: 0, addresses: [] };
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Writes the header; the running unit writes its reading at READING_OFFSET. */
export function encodeHeader(state: State, into: Uint8Array): void {
  into.fill(0);
  const v = view(into);
  v.setUint32(0, state.sequence, true);
  into[4] = state.phase; into[5] = state.kind;
  v.setUint16(6, state.attaches, true);
  v.setUint32(8, state.requests >>> 0, true);
  v.setUint32(12, state.failures >>> 0, true);
  v.setUint16(16, Math.min(state.detectMs, 0xffff), true);
  v.setUint16(18, Math.min(state.scanMs, 0xffff), true);
  for (const address of state.addresses) {
    const index = 20 + (address >> 3);
    into[index] = into[index]! | (1 << (address & 7));
  }
}

export function encodeEnv(r: EnvReading, into: Uint8Array): void {
  const v = view(into), o = READING_OFFSET;
  v.setUint32(o, r.samples, true);
  v.setFloat32(o + 4, r.celsius, true); v.setFloat32(o + 8, r.humidity, true); v.setFloat32(o + 12, r.pascals, true);
  v.setFloat32(o + 16, r.qmpCelsius, true); v.setFloat32(o + 20, r.dewPoint, true); v.setFloat32(o + 24, r.altitude, true);
}

export function encodeSonic(r: SonicReading, into: Uint8Array): void {
  const v = view(into), o = READING_OFFSET;
  v.setUint32(o, r.samples, true);
  v.setFloat32(o + 4, r.millimetres, true); v.setFloat32(o + 8, r.raw, true);
  v.setFloat32(o + 12, r.min, true); v.setFloat32(o + 16, r.max, true);
  v.setUint32(o + 20, r.outOfRange, true);
}

export function encodeRfid(r: RfidReading, into: Uint8Array): void {
  const v = view(into), o = READING_OFFSET;
  v.setUint32(o, r.polls, true);
  into[o + 4] = r.version; into[o + 5] = r.present ? 1 : 0;
  v.setUint16(o + 6, r.cards, true);
  v.setUint16(o + 8, r.atqa, true);
  into[o + 10] = r.sak; into[o + 11] = r.cardType;
  into[o + 12] = r.dataState; into[o + 13] = r.writeState;
  into[o + 14] = Math.min(r.uid.length, 10);
  into.set(r.uid.subarray(0, 10), o + 16);
  into.set(r.data.subarray(0, 16), o + 26);
}

export function decodeState(bytes: Uint8Array): State {
  const v = view(bytes), o = READING_OFFSET;
  const addresses: number[] = [];
  for (let address = 0; address < 128; ++address) if (bytes[20 + (address >> 3)]! & (1 << (address & 7))) addresses.push(address);
  const state: State = {
    sequence: v.getUint32(0, true), phase: bytes[4]!, kind: bytes[5]!, attaches: v.getUint16(6, true),
    requests: v.getUint32(8, true), failures: v.getUint32(12, true),
    detectMs: v.getUint16(16, true), scanMs: v.getUint16(18, true), addresses,
  };
  if (state.phase !== Phase.running) return state;
  if (state.kind === Kind.env3) {
    state.env = {
      samples: v.getUint32(o, true), celsius: v.getFloat32(o + 4, true), humidity: v.getFloat32(o + 8, true),
      pascals: v.getFloat32(o + 12, true), qmpCelsius: v.getFloat32(o + 16, true),
      dewPoint: v.getFloat32(o + 20, true), altitude: v.getFloat32(o + 24, true),
    };
  } else if (state.kind === Kind.sonic) {
    state.sonic = {
      samples: v.getUint32(o, true), millimetres: v.getFloat32(o + 4, true), raw: v.getFloat32(o + 8, true),
      min: v.getFloat32(o + 12, true), max: v.getFloat32(o + 16, true), outOfRange: v.getUint32(o + 20, true),
    };
  } else if (state.kind === Kind.rfid2) {
    const length = Math.min(bytes[o + 14]!, 10);
    state.rfid = {
      polls: v.getUint32(o, true), version: bytes[o + 4]!, present: bytes[o + 5] === 1, cards: v.getUint16(o + 6, true),
      atqa: v.getUint16(o + 8, true), sak: bytes[o + 10]!, cardType: bytes[o + 11]!,
      dataState: bytes[o + 12]!, writeState: bytes[o + 13]!,
      uid: bytes.slice(o + 16, o + 16 + length), data: bytes.slice(o + 26, o + 42),
    };
  }
  return state;
}

// ---- history -----------------------------------------------------------------

export interface HistoryPoint { celsius: number | undefined; humidity: number | undefined }

export function encodeHistory(points: readonly HistoryPoint[], into: Uint8Array): void {
  into.fill(0);
  const v = view(into), count = Math.min(points.length, HISTORY_POINTS);
  v.setUint16(0, count, true); v.setUint16(2, HISTORY_SECONDS, true);
  for (let i = 0; i < count; ++i) {
    const point = points[points.length - count + i]!;
    v.setInt16(4 + i * 4, point.celsius === undefined ? HISTORY_GAP : Math.max(-32767, Math.min(32767, Math.round(point.celsius * 100))), true);
    v.setUint16(6 + i * 4, point.humidity === undefined ? 0 : Math.round(Math.max(0, Math.min(100, point.humidity)) * 100), true);
  }
}

export function decodeHistory(bytes: Uint8Array): HistoryPoint[] {
  const v = view(bytes), count = Math.min(v.getUint16(0, true), HISTORY_POINTS), points: HistoryPoint[] = [];
  for (let i = 0; i < count; ++i) {
    const centi = v.getInt16(4 + i * 4, true);
    points.push(centi === HISTORY_GAP ? { celsius: undefined, humidity: undefined }
      : { celsius: centi / 100, humidity: v.getUint16(6 + i * 4, true) / 100 });
  }
  return points;
}

// ---- events ------------------------------------------------------------------

export interface EventRecord { event: number; kind: number; detail: number; millis: number; payload: Uint8Array }

export function encodeEvent(record: EventRecord): Uint8Array {
  const bytes = new Uint8Array(EVENT_BYTES), length = Math.min(record.payload.length, 8);
  bytes[0] = record.event; bytes[1] = record.kind; bytes[2] = record.detail; bytes[3] = length;
  view(bytes).setUint32(4, record.millis >>> 0, true);
  bytes.set(record.payload.subarray(0, length), 8);
  return bytes;
}

export function decodeEvent(bytes: Uint8Array): EventRecord {
  const length = Math.min(bytes[3]!, 8);
  return { event: bytes[0]!, kind: bytes[1]!, detail: bytes[2]!, millis: view(bytes).getUint32(4, true), payload: bytes.slice(8, 8 + length) };
}
