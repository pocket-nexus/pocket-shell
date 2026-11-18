// The channel records between the UI and the worker, little endian.
//
//   sensors (worker -> UI snapshot, 64 bytes)
//     0 u32 sequence     4 u8 RTC valid    5 u8 IMU state     6 u8 power state
//     7 u8 RTC setting   8 u16 year       10 u8 month       11 u8 day
//    12 u8 hour         13 u8 minute      14 u8 second      15 u8 wake armed
//    16 f32 bus volts   20 f32 amps       24 f32 watts
//    28 f32 accel x y z (m/s²)            40 f32 gyro x y z (rad/s)
//    52 u32 RTC setting sequence          56 u32 wake sequence
//   scan (worker -> UI snapshot, 24 bytes)
//     0 u32 sequence     4 u8 bus          5 u8 scan state    8 16-byte bitmap
//       of the answering addresses, bit n of byte n >> 3
//   serial (worker -> UI ring, 64-byte records)
//     0 u8 kind          1 u8 length       2 up to 62 bytes
//   commands (UI -> worker ring, 32-byte records)
//     0 u8 command       4 u32 sequence    8 arguments

export const SENSORS_BYTES = 64;
export const SCAN_BYTES = 24;
export const SERIAL_BYTES = 64;
export const SERIAL_PAYLOAD = SERIAL_BYTES - 2;
export const COMMAND_BYTES = 32;
export const SEND_PAYLOAD = COMMAND_BYTES - 9;

export const Command = {
  setRtc: 1,
  scan: 2,
  serialOpen: 3,
  serialClose: 4,
  serialSend: 5,
  armRtcWake: 6,
  armMotionWake: 7,
  disarmWake: 8,
} as const;

/** Driver states for the IMU and the power monitor. */
export const Driver = { starting: 0, ready: 1, fault: 2 } as const;
export const RtcSetting = { idle: 0, busy: 1, succeeded: 2, failed: 3 } as const;
/** What the worker armed to power the board back on. */
export const Wake = { none: 0, rtc: 1, motion: 2, failed: 3 } as const;
export const Bus = { sys: 0, porta: 1 } as const;
export const ScanState = { idle: 0, scanning: 1, done: 2 } as const;
export const SerialKind = { received: 1, sent: 2, opened: 3, closed: 4, failed: 5 } as const;

export interface Sensors {
  sequence: number;
  rtcValid: boolean;
  imu: number;
  power: number;
  rtcSetting: number;
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  wake: number;
  volts: number; amps: number; watts: number;
  accel: [number, number, number];
  gyro: [number, number, number];
  rtcSequence: number;
  wakeSequence: number;
}

export function emptySensors(): Sensors {
  return {
    sequence: 0, rtcValid: false, imu: Driver.starting, power: Driver.starting, rtcSetting: RtcSetting.idle,
    year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0, wake: Wake.none,
    volts: 0, amps: 0, watts: 0, accel: [0, 0, 0], gyro: [0, 0, 0], rtcSequence: 0, wakeSequence: 0,
  };
}

export function encodeSensors(value: Sensors, into: Uint8Array): Uint8Array {
  const view = new DataView(into.buffer, into.byteOffset, into.byteLength);
  view.setUint32(0, value.sequence, true);
  into[4] = value.rtcValid ? 1 : 0; into[5] = value.imu; into[6] = value.power; into[7] = value.rtcSetting;
  view.setUint16(8, value.year, true);
  into[10] = value.month; into[11] = value.day; into[12] = value.hour;
  into[13] = value.minute; into[14] = value.second; into[15] = value.wake;
  view.setFloat32(16, value.volts, true); view.setFloat32(20, value.amps, true); view.setFloat32(24, value.watts, true);
  for (let axis = 0; axis < 3; ++axis) {
    view.setFloat32(28 + axis * 4, value.accel[axis]!, true);
    view.setFloat32(40 + axis * 4, value.gyro[axis]!, true);
  }
  view.setUint32(52, value.rtcSequence, true);
  view.setUint32(56, value.wakeSequence, true);
  return into;
}

export function decodeSensors(bytes: Uint8Array): Sensors {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const f = (offset: number) => view.getFloat32(offset, true);
  return {
    sequence: view.getUint32(0, true), rtcValid: bytes[4] === 1, imu: bytes[5]!, power: bytes[6]!,
    rtcSetting: bytes[7]!, year: view.getUint16(8, true), month: bytes[10]!, day: bytes[11]!,
    hour: bytes[12]!, minute: bytes[13]!, second: bytes[14]!, wake: bytes[15]!,
    volts: f(16), amps: f(20), watts: f(24), accel: [f(28), f(32), f(36)], gyro: [f(40), f(44), f(48)],
    rtcSequence: view.getUint32(52, true), wakeSequence: view.getUint32(56, true),
  };
}

export interface Scan {
  sequence: number;
  bus: number;
  state: number;
  /** Answering 7-bit addresses, ascending. */
  addresses: number[];
}

export function encodeScan(value: Scan, into: Uint8Array): Uint8Array {
  into.fill(0);
  new DataView(into.buffer, into.byteOffset, into.byteLength).setUint32(0, value.sequence, true);
  into[4] = value.bus; into[5] = value.state;
  for (const address of value.addresses) into[8 + (address >> 3)]! |= 1 << (address & 7);
  return into;
}

export function decodeScan(bytes: Uint8Array): Scan {
  const addresses: number[] = [];
  for (let address = 0; address < 128; ++address) if (bytes[8 + (address >> 3)]! & (1 << (address & 7))) addresses.push(address);
  return { sequence: new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true), bus: bytes[4]!, state: bytes[5]!, addresses };
}

export interface ClockFields {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
}

/** One command record; `fill` writes the arguments from byte 8. */
export function encodeCommand(command: number, sequence: number, fill?: (view: DataView, bytes: Uint8Array) => void): Uint8Array {
  const bytes = new Uint8Array(COMMAND_BYTES);
  const view = new DataView(bytes.buffer);
  bytes[0] = command;
  view.setUint32(4, sequence, true);
  fill?.(view, bytes);
  return bytes;
}

export function encodeClock(view: DataView, bytes: Uint8Array, clock: ClockFields): void {
  view.setUint16(8, clock.year, true);
  bytes[10] = clock.month; bytes[11] = clock.day; bytes[12] = clock.hour;
  bytes[13] = clock.minute; bytes[14] = clock.second;
}

export function decodeClock(bytes: Uint8Array): ClockFields {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { year: view.getUint16(8, true), month: bytes[10]!, day: bytes[11]!, hour: bytes[12]!, minute: bytes[13]!, second: bytes[14]! };
}

/** QuickJS has no TextEncoder or TextDecoder; serial text is ASCII. */
export function ascii(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte === 10 || byte === 13 || (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : ".";
  return text;
}

export function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; ++i) bytes[i] = text.charCodeAt(i) & 0x7f;
  return bytes;
}
