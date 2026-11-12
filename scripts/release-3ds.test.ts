// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "bun:test";
import { validateBinary } from "./release-3ds.ts";

test("release staging rejects empty, truncated, wrong-format and CIA binaries", () => {
  expect(() => validateBinary("3dsx", Buffer.alloc(0))).toThrow();
  expect(() => validateBinary("3dsx", Buffer.from("error page"))).toThrow();
  const threeDsx = Buffer.alloc(32);
  threeDsx.write("3DSX");
  expect(() => validateBinary("3dsx", threeDsx)).not.toThrow();
  const cia = Buffer.alloc(0x2021);
  cia.writeUInt32LE(0x2020);
  expect(() => validateBinary("cia", cia)).toThrow();
});
