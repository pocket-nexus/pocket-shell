import { describe, expect, test } from "bun:test";
import {
  CardType, DataState, Event, Kind, Phase, READING_OFFSET, STATE_BYTES, WriteState,
  decodeEvent, decodeHistory, decodeState, encodeEnv, encodeEvent, encodeHeader, encodeHistory, encodeRfid, encodeSonic,
  HISTORY_BYTES, HISTORY_POINTS, matchUnit, type State,
} from "../apps/unit-swap/protocol";
import {
  altitude, cardText, cardType, crc8, crcA, crcAValid, decodeDistance, decodeSht30, decodeSht30Status,
  describeBlock, dewPoint, median, qmpCalibration, qmpCompensate,
} from "../apps/unit-swap/units/decode";

describe("SHT30", () => {
  test("CRC-8 matches the datasheet example", () => {
    expect(crc8(Uint8Array.of(0xbe, 0xef), 0, 2)).toBe(0x92);
  });
  const frame = (t: number, rh: number) => {
    const raw = Uint8Array.of(t >> 8, t & 0xff, 0, rh >> 8, rh & 0xff, 0);
    raw[2] = crc8(raw, 0, 2); raw[5] = crc8(raw, 3, 2);
    return raw;
  };
  test("measurement words convert to C and %RH", () => {
    const sample = decodeSht30(frame(0x6666, 0x8000))!;
    expect(sample.celsius).toBeCloseTo(25, 2);
    expect(sample.humidity).toBeCloseTo(50, 2);
  });
  test("a CRC mismatch or short frame gives nothing", () => {
    const raw = frame(0x6666, 0x8000); raw[5] ^= 1;
    expect(decodeSht30(raw)).toBeUndefined();
    expect(decodeSht30(raw.subarray(1))).toBeUndefined();
    expect(decodeSht30Status(Uint8Array.of(0x80, 0x10, crc8(Uint8Array.of(0x80, 0x10), 0, 2)))).toBe(0x8010);
  });
  test("dew point and altitude", () => {
    expect(dewPoint(25, 50)).toBeCloseTo(13.85, 1);
    expect(altitude(101325)).toBeCloseTo(0, 6);
    expect(altitude(89874.6)).toBeCloseTo(1000, -1);
  });
});

describe("QMP6988", () => {
  test("OTP layout: 20-bit a0 and b00 with nibbles in byte 24, 16-bit factors", () => {
    const otp = new Uint8Array(25);
    otp[0] = 0x01; otp[1] = 0x23; otp[24] = 0x4f; // b00 = 0x01234 / 16
    otp[18] = 0xff; otp[19] = 0xff;               // a0 = 0xFFFFF = -1 -> -1/16
    otp[2] = 0x7f; otp[3] = 0xff;                 // bt1 = A + S
    otp[20] = 0x80; otp[21] = 0x01;               // a1 = A - S
    const cal = qmpCalibration(otp)!;
    expect(cal.b00).toBe(0x01234 / 16);
    expect(cal.a0).toBe(-1 / 16);
    expect(cal.bt1).toBeCloseTo(0.1 + 0.091, 12);
    expect(cal.a1).toBeCloseTo(-6.3e-3 - 4.3e-4, 12);
    expect(cal.bp3).toBeCloseTo(1.3e-16, 28);
    expect(qmpCalibration(otp.subarray(1))).toBeUndefined();
  });
  test("compensation: Tr in 1/256 C, pressure polynomial in Tr and Dp", () => {
    const cal = { a0: 6400, a1: 0, a2: 0, b00: 100000, bt1: 2, bt2: 0, bp1: 0.5, b11: 0, bp2: 0, b12: 0, b21: 0, bp3: 0 };
    // Dp = +1000, Dt = 0.
    const raw = Uint8Array.of(0x80, 0x03, 0xe8, 0x80, 0x00, 0x00);
    const out = qmpCompensate(cal, raw)!;
    expect(out.celsius).toBe(25);
    expect(out.pascals).toBe(100000 + 2 * 6400 + 0.5 * 1000);
  });
});

describe("RCWL-9620", () => {
  test("three bytes of micrometres", () => {
    expect(decodeDistance(Uint8Array.of(0x01, 0xe2, 0x40))).toBe(123.456);
    expect(decodeDistance(Uint8Array.of(1, 2))).toBeUndefined();
    expect(median([5, 1, 9, 3, 7])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("ISO 14443A", () => {
  test("CRC_A of HLTA and READ 0", () => {
    expect(crcA([0x50, 0x00])).toEqual([0x57, 0xcd]);
    expect(crcA([0x30, 0x00])).toEqual([0x02, 0xa8]);
    expect(crcAValid(Uint8Array.of(0x50, 0x00, 0x57, 0xcd))).toBe(true);
    expect(crcAValid(Uint8Array.of(0x50, 0x00, 0x57, 0xce))).toBe(false);
  });
  test("SAK to card family", () => {
    expect(cardType(0x08)).toBe(CardType.classic1k);
    expect(cardType(0x18)).toBe(CardType.classic4k);
    expect(cardType(0x00)).toBe(CardType.ultralight);
    expect(cardType(0x20)).toBe(CardType.iso14443_4);
    expect(cardType(0x44)).toBe(CardType.other);
  });
  test("card text pads to 16 bytes and reads back as text", () => {
    const block = cardText("Pocket Tab5 #1");
    expect(block.length).toBe(16);
    expect(describeBlock(block)).toBe('"Pocket Tab5 #1"');
    expect(describeBlock(Uint8Array.of(0xde, 0xad, 0, 1))).toBe("DE AD 00 01");
  });
});

describe("catalogue", () => {
  test("ENV III needs both addresses and wins over a single-address match", () => {
    expect(matchUnit([0x44])).toBeUndefined();
    expect(matchUnit([0x44, 0x70])?.kind).toBe(Kind.env3);
    expect(matchUnit([0x28, 0x44, 0x70])?.kind).toBe(Kind.env3);
    expect(matchUnit([0x57])?.kind).toBe(Kind.sonic);
    expect(matchUnit([0x28])?.kind).toBe(Kind.rfid2);
    expect(matchUnit([0x3c])).toBeUndefined();
  });
});

describe("channel records", () => {
  const header = (kind: number): State => ({
    sequence: 7, phase: Phase.running, kind, attaches: 3, requests: 123456, failures: 9,
    detectMs: 420, scanMs: 12, addresses: [0x44, 0x70],
  });
  test("state header and ENV III reading", () => {
    const bytes = new Uint8Array(STATE_BYTES);
    encodeHeader(header(Kind.env3), bytes);
    encodeEnv({ samples: 5, celsius: 24.5, humidity: 40.25, pascals: 101000, qmpCelsius: 25, dewPoint: 10, altitude: 27 }, bytes);
    const state = decodeState(bytes);
    expect(state).toMatchObject({ sequence: 7, phase: Phase.running, kind: Kind.env3, attaches: 3, requests: 123456, failures: 9, detectMs: 420, scanMs: 12 });
    expect(state.addresses).toEqual([0x44, 0x70]);
    expect(state.env).toEqual({ samples: 5, celsius: 24.5, humidity: 40.25, pascals: 101000, qmpCelsius: 25, dewPoint: 10, altitude: 27 });
  });
  test("ultrasonic and RFID readings", () => {
    const bytes = new Uint8Array(STATE_BYTES);
    encodeHeader(header(Kind.sonic), bytes);
    encodeSonic({ samples: 2, millimetres: 512.5, raw: 510, min: 100, max: 900, outOfRange: 1 }, bytes);
    expect(decodeState(bytes).sonic).toEqual({ samples: 2, millimetres: 512.5, raw: 510, min: 100, max: 900, outOfRange: 1 });
    encodeHeader(header(Kind.rfid2), bytes);
    const uid = Uint8Array.of(0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66);
    const data = Uint8Array.from({ length: 16 }, (_, i) => i);
    encodeRfid({ polls: 40, version: 0x15, present: true, cards: 2, atqa: 0x0044, sak: 0x00, cardType: CardType.ultralight,
      uid, dataState: DataState.read, data, writeState: WriteState.written }, bytes);
    expect(READING_OFFSET + 42).toBeLessThanOrEqual(STATE_BYTES);
    expect(decodeState(bytes).rfid).toEqual({ polls: 40, version: 0x15, present: true, cards: 2, atqa: 0x0044, sak: 0,
      cardType: CardType.ultralight, uid, dataState: DataState.read, data, writeState: WriteState.written });
  });
  test("a state that is not running carries no reading", () => {
    const bytes = new Uint8Array(STATE_BYTES);
    encodeHeader({ ...header(Kind.env3), phase: Phase.identifying }, bytes);
    expect(decodeState(bytes).env).toBeUndefined();
  });
  test("history keeps the newest points and its gaps", () => {
    const bytes = new Uint8Array(HISTORY_BYTES);
    const points = Array.from({ length: HISTORY_POINTS + 3 }, (_, i) => i % 5 === 0 ? { celsius: undefined, humidity: undefined } : { celsius: 20 + i / 100, humidity: 40 });
    encodeHistory(points, bytes);
    const decoded = decodeHistory(bytes);
    expect(decoded.length).toBe(HISTORY_POINTS);
    expect(decoded[0]!.celsius).toBeCloseTo(20.03, 2);
    expect(decoded[2]).toEqual({ celsius: undefined, humidity: undefined });
  });
  test("event records", () => {
    const record = decodeEvent(encodeEvent({ event: Event.card, kind: Kind.rfid2, detail: CardType.classic1k, millis: 65_432, payload: Uint8Array.of(1, 2, 3, 4) }));
    expect(record).toEqual({ event: Event.card, kind: Kind.rfid2, detail: CardType.classic1k, millis: 65_432, payload: Uint8Array.of(1, 2, 3, 4) });
  });
});
