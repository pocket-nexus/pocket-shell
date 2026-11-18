export interface RtcTime {
  year: number; month: number; day: number; weekday: number;
  hours: number; minutes: number; seconds: number;
}
function bcd(value: number): number | undefined {
  return (value & 15) > 9 || (value >> 4) > 9 ? undefined : (value >> 4) * 10 + (value & 15);
}
/** Registers 0x10..0x1e from one transaction. VLF and STOP invalidate time. */
export function decodeRx8130ce(raw: Uint8Array): RtcTime | undefined {
  if (raw.length !== 15 || (raw[13]! & 2) || (raw[14]! & 0xC0)) return undefined;
  const second = bcd(raw[0]! & 0x7f), minute = bcd(raw[1]! & 0x7f), hour = bcd(raw[2]! & 0x3f);
  const day = bcd(raw[4]! & 0x3f), month = bcd(raw[5]! & 0x1f), year = bcd(raw[6]!);
  const week = raw[3]!;
  if (second === undefined || minute === undefined || hour === undefined || day === undefined ||
      month === undefined || year === undefined || second > 59 || minute > 59 || hour > 23 ||
      month < 1 || month > 12 || week === 0 || week > 64 || (week & (week - 1))) return undefined;
  const days = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]!) return undefined;
  return { year: 2000 + year, month, day, weekday: Math.log2(week), hours: hour, minutes: minute, seconds: second };
}
export interface ImuSample {
  /** BMI270 sensor axes; accelerations in m/s², angular rates in rad/s. */
  accel: readonly [number, number, number]; gyro: readonly [number, number, number];
  sensorTicks: number;
}
/** Contiguous registers 0x03..0x1a. Both new-data flags must be present. */
export function decodeBmi270(raw: Uint8Array): ImuSample | undefined {
  if (raw.length !== 24 || (raw[0]! & 0xc0) !== 0xc0) return undefined;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const accel = (index: number) => view.getInt16(9 + index * 2, true) * 9.80665 / 8192;
  const gyro = (index: number) => view.getInt16(15 + index * 2, true) * Math.PI / (180 * 32.768);
  return { accel: [accel(0), accel(1), accel(2)], gyro: [gyro(0), gyro(1), gyro(2)],
    sensorTicks: raw[21]! | raw[22]! << 8 | raw[23]! << 16 };
}
