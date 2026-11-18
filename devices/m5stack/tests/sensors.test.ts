import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { decodeRx8130ce, decodeBmi270 } from "../apps/tab5-demo/drivers/decode";
import { bmi270Configuration } from "../apps/tab5-demo/drivers/bmi270-config";

describe("RX8130CE read-only validation", () => {
  const valid = () => Uint8Array.of(0x56, 0x34, 0x12, 0x04, 0x29, 0x02, 0x24, 0, 0, 0, 0, 0, 0, 0, 0);
  test("BCD leap date and one-hot weekday", () => {
    expect(decodeRx8130ce(valid())).toEqual({year: 2024, month: 2, day: 29, weekday: 2, hours: 12, minutes: 34, seconds: 56});
  });
  test("invalid flags, BCD, dates and weekdays never produce a timestamp", () => {
    for (const [offset, value] of [[13, 2], [14, 0x40], [14, 0x80], [0, 0x6a], [3, 0], [3, 3], [3, 0x80], [5, 0x13], [6, 0x23]]) {
      const raw = valid(); raw[offset!] = value!;
      expect(decodeRx8130ce(raw)).toBeUndefined();
    }
    expect(decodeRx8130ce(valid().subarray(1))).toBeUndefined();
  });
});
describe("BMI270 measurement validation", () => {
  test("requires both DRDY bits and complete fixed layout", () => {
    expect(decodeBmi270(new Uint8Array(24))).toBeUndefined();
    expect(decodeBmi270(Uint8Array.of(0xc0))).toBeUndefined();
  });
  test("sensor axes decode to SI units at configured ranges", () => {
    const raw = new Uint8Array(24); raw[0] = 0xc0;
    const view = new DataView(raw.buffer);
    view.setInt16(9, 8192, true); view.setInt16(11, -8192, true);
    view.setInt16(15, 16384, true); view.setInt16(17, -16384, true);
    raw.set([0x56, 0x34, 0x12], 21);
    const sample = decodeBmi270(raw)!;
    expect(sample.accel).toEqual([9.80665, -9.80665, 0]);
    expect(sample.gyro[0]).toBeCloseTo(500 * Math.PI / 180, 9);
    expect(sample.gyro[1]).toBeCloseTo(-500 * Math.PI / 180, 9);
    expect(sample.sensorTicks).toBe(0x123456);
  });
  test("configuration image is pinned", () => {
    expect(bmi270Configuration.length).toBe(8192);
    expect(createHash("sha256").update(bmi270Configuration).digest("hex")).toBe("2d75e68e343a13ff99be98261dfbd99d9e8c6f267da9e3c5aeb883276ad178db");
  });
});
