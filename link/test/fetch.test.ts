// SPDX-License-Identifier: GPL-3.0-or-later
// The destination policy of the Hub's fetches (link/fetch.ts): the addresses
// a request from a device never reaches.

import { expect, test } from "bun:test";
import { isPrivateAddress } from "../fetch.ts";

test("destination policy", () => {
  for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.8.1", "169.254.1.1", "100.64.0.1", "224.0.0.1", "0.0.0.0", "255.255.255.255", "::1", "fe80::1", "fd00::1", "ff02::1", "::ffff:192.168.1.1", "::"]) {
    expect(isPrivateAddress(a)).toBe(true);
  }
  for (const a of ["1.1.1.1", "104.20.23.154", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(a)).toBe(false);
});
