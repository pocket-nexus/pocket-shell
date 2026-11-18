// Conversions with no I/O, shared by the drivers and the host tests.
import { CardType } from "../protocol";

/** Sensirion CRC-8: polynomial 0x31, initial value 0xFF (SHT3x datasheet
 *  §4.12; 0xBEEF gives 0x92). */
export function crc8(bytes: Uint8Array, offset: number, length: number): number {
  let crc = 0xff;
  for (let i = offset; i < offset + length; ++i) {
    crc ^= bytes[i]!;
    for (let bit = 0; bit < 8; ++bit) crc = crc & 0x80 ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** A 16-bit word followed by its CRC, as the SHT3x sends every word. */
function word(raw: Uint8Array, offset: number): number | undefined {
  return crc8(raw, offset, 2) === raw[offset + 2] ? (raw[offset]! << 8) | raw[offset + 1]! : undefined;
}

/** A single-shot measurement: temperature word, humidity word, each with
 *  its CRC (§4.13). */
export function decodeSht30(raw: Uint8Array): { celsius: number; humidity: number } | undefined {
  if (raw.length !== 6) return undefined;
  const t = word(raw, 0), rh = word(raw, 3);
  if (t === undefined || rh === undefined) return undefined;
  return { celsius: -45 + 175 * t / 65535, humidity: 100 * rh / 65535 };
}

/** The status register (command 0xF32D), or undefined on a CRC mismatch. */
export function decodeSht30Status(raw: Uint8Array): number | undefined {
  return raw.length === 3 ? word(raw, 0) : undefined;
}

// ---- QMP6988 -----------------------------------------------------------------

export interface QmpCalibration {
  a0: number; a1: number; a2: number;
  b00: number; bt1: number; bt2: number; bp1: number; b11: number;
  bp2: number; b12: number; b21: number; bp3: number;
}

function s16(raw: Uint8Array, offset: number): number {
  const value = (raw[offset]! << 8) | raw[offset + 1]!;
  return value & 0x8000 ? value - 0x10000 : value;
}
function s20(value: number): number {
  return value & 0x80000 ? value - 0x100000 : value;
}

/** The 25 OTP bytes from 0xA0. a0 and b00 are 20-bit, their low nibbles in
 *  byte 24; the rest are 16-bit big endian. Each coefficient converts as
 *  A + S * OTP / 32767 with the datasheet's conversion factors; a0 and b00
 *  as OTP / 16. */
export function qmpCalibration(otp: Uint8Array): QmpCalibration | undefined {
  if (otp.length !== 25) return undefined;
  const k = (a: number, s: number, offset: number) => a + s * s16(otp, offset) / 32767;
  return {
    b00: s20((otp[0]! << 12) | (otp[1]! << 4) | (otp[24]! >> 4)) / 16,
    bt1: k(1.0e-1, 9.1e-2, 2), bt2: k(1.2e-8, 1.2e-6, 4), bp1: k(3.3e-2, 1.9e-2, 6),
    b11: k(2.1e-7, 1.4e-7, 8), bp2: k(-6.3e-10, 3.5e-10, 10), b12: k(2.9e-13, 7.6e-13, 12),
    b21: k(2.1e-15, 1.2e-14, 14), bp3: k(1.3e-16, 7.9e-17, 16),
    a0: s20((otp[18]! << 12) | (otp[19]! << 4) | (otp[24]! & 0x0f)) / 16,
    a1: k(-6.3e-3, 4.3e-4, 20), a2: k(-1.9e-11, 1.2e-10, 22),
  };
}

/** Registers 0xF7..0xFC: pressure then temperature, 24-bit offset by 2^23.
 *  Tr is the temperature in 1/256 C; the pressure polynomial takes Tr. */
export function qmpCompensate(cal: QmpCalibration, raw: Uint8Array): { celsius: number; pascals: number } | undefined {
  if (raw.length !== 6) return undefined;
  const dp = ((raw[0]! << 16) | (raw[1]! << 8) | raw[2]!) - 0x800000;
  const dt = ((raw[3]! << 16) | (raw[4]! << 8) | raw[5]!) - 0x800000;
  const tr = cal.a0 + cal.a1 * dt + cal.a2 * dt * dt;
  const pascals = cal.b00 + cal.bt1 * tr + cal.bp1 * dp + cal.b11 * tr * dp + cal.bt2 * tr * tr +
    cal.bp2 * dp * dp + cal.b12 * dp * tr * tr + cal.b21 * dp * dp * tr + cal.bp3 * dp * dp * dp;
  return { celsius: tr / 256, pascals };
}

/** Magnus formula with the Sonntag (1990) constants, valid -45..60 C. */
export function dewPoint(celsius: number, humidity: number): number {
  const gamma = Math.log(Math.max(humidity, 0.01) / 100) + 17.62 * celsius / (243.12 + celsius);
  return 243.12 * gamma / (17.62 - gamma);
}

/** Barometric altitude against the 101325 Pa standard sea-level pressure. */
export function altitude(pascals: number): number {
  return 44330 * (1 - Math.pow(pascals / 101325, 1 / 5.255));
}

// ---- RCWL-9620 ---------------------------------------------------------------

/** The three bytes after a trigger: the distance in micrometres, big endian. */
export function decodeDistance(raw: Uint8Array): number | undefined {
  return raw.length === 3 ? ((raw[0]! << 16) | (raw[1]! << 8) | raw[2]!) / 1000 : undefined;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// ---- ISO 14443A --------------------------------------------------------------

/** CRC_A (ISO/IEC 14443-3 Annex B): initial value 0x6363, low byte first.
 *  HLTA 50 00 carries 57 CD. */
export function crcA(bytes: readonly number[] | Uint8Array): [number, number] {
  let crc = 0x6363;
  for (const value of bytes) {
    let ch = (value ^ crc) & 0xff;
    ch = (ch ^ (ch << 4)) & 0xff;
    crc = ((crc >> 8) ^ (ch << 8) ^ (ch << 3) ^ (ch >> 4)) & 0xffff;
  }
  return [crc & 0xff, crc >> 8];
}

/** Whether the last two bytes are the CRC_A of the rest. */
export function crcAValid(bytes: Uint8Array): boolean {
  if (bytes.length < 3) return false;
  const [lo, hi] = crcA(bytes.subarray(0, bytes.length - 2));
  return bytes[bytes.length - 2] === lo && bytes[bytes.length - 1] === hi;
}

/** The card family a final SAK announces (NXP AN10833 §3.2). */
export function cardType(sak: number): number {
  switch (sak) {
    case 0x00: return CardType.ultralight;
    case 0x08: case 0x28: return CardType.classic1k;
    case 0x18: case 0x38: return CardType.classic4k;
    case 0x09: return CardType.mini;
    case 0x10: case 0x11: return CardType.plus;
    case 0x20: return CardType.iso14443_4;
    default: return CardType.other;
  }
}

export const CARD_NAMES: Record<number, string> = {
  [CardType.none]: "-", [CardType.ultralight]: "MIFARE Ultralight / NTAG", [CardType.classic1k]: "MIFARE Classic 1K",
  [CardType.classic4k]: "MIFARE Classic 4K", [CardType.mini]: "MIFARE Mini", [CardType.iso14443_4]: "ISO 14443-4",
  [CardType.plus]: "MIFARE Plus", [CardType.other]: "Unknown card",
};

/** The text a card write stores: ASCII, zero padded to 16 bytes. */
export function cardText(text: string): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < Math.min(text.length, 16); ++i) {
    const code = text.charCodeAt(i);
    out[i] = code >= 0x20 && code < 0x7f ? code : 0x3f;
  }
  return out;
}

/** Printable ASCII up to the first zero, or hex when the block is not text. */
export function describeBlock(data: Uint8Array): string {
  let end = data.indexOf(0);
  if (end < 0) end = data.length;
  const text = data.subarray(0, end);
  const printable = text.length > 0 && text.every(byte => byte >= 0x20 && byte < 0x7f) && data.subarray(end).every(byte => byte === 0);
  if (printable) return `"${String.fromCharCode(...text)}"`;
  return Array.from(data, byte => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}
