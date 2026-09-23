// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "bun:test";
import { manifestVersion, releaseVersion, validateBinary } from "./release-3ds.ts";

test("release date follows Shanghai midnight, including year rollover", () => {
  expect(releaseVersion("2026-09-23T15:59:59Z")).toBe("2026.09.23");
  expect(releaseVersion("2026-09-23T16:00:00Z")).toBe("2026.09.24");
  expect(releaseVersion("2026-12-31T16:00:00Z")).toBe("2027.01.01");
  expect(() => releaseVersion("invalid")).toThrow();
});

test("manifest uses calendar SemVer and rejects invalid dates or tag injection", () => {
  expect(manifestVersion("2026.09.23")).toBe("2026.9.23");
  expect(manifestVersion("2028.02.29")).toBe("2028.2.29");
  for (const value of ["2026.02.29", "2026.04.31", "2026.13.01", "2026.9.23", "v2026.09.23", "2026.09.23/other"]) {
    expect(() => manifestVersion(value)).toThrow();
  }
});

test("release staging rejects empty, truncated and wrong-format binaries", () => {
  for (const extension of ["3dsx", "cia"]) {
    expect(() => validateBinary(extension, Buffer.alloc(0))).toThrow();
    expect(() => validateBinary(extension, Buffer.from("error page"))).toThrow();
  }
  const threeDsx = Buffer.alloc(32);
  threeDsx.write("3DSX");
  expect(() => validateBinary("3dsx", threeDsx)).not.toThrow();
  const cia = Buffer.alloc(0x2021);
  cia.writeUInt32LE(0x2020);
  expect(() => validateBinary("cia", cia)).not.toThrow();
  expect(() => validateBinary("cia", cia.subarray(0, 0x2020))).toThrow();
});
