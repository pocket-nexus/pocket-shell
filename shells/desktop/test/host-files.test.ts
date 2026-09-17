// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "bun:test";
import { createHostFiles, type FilesIntent } from "../src/system-ui/host-files.ts";
import { selectedIcon } from "../scripts/selected-icon.ts";
import { decodePng } from "../../../vendor/pocketjs/framework/compiler/pak.ts";
import { readFileSync } from "node:fs";

test("directory pages keep window generations separate from launch acknowledgements", () => {
  const sent: FilesIntent[] = [];
  const a = createHostFiles(v => sent.push(v)), b = createHostFiles(v => sent.push(v));
  const file = { path: "/tmp/letter.txt", name: "letter.txt", kind: "file" as const, size: 123 };
  const reply = (request: number, offset = 0, done = true) => ({
    t: "files", request, path: "/tmp", label: "tmp", parent: "/", offset, next: offset + 1, done, entries: [file],
  });
  a.list("/tmp", 0); const first = sent.at(-1)!.request;
  b.list("/var", 0); const second = sent.at(-1)!.request;
  expect(b.accept(reply(first), 1)).toBe(false);
  expect(a.accept(reply(first, 0, false), 1)).toBe(true);
  expect(sent.at(-1)?.offset).toBe(1);
  expect(a.accept(reply(first, 0), 1)).toBe(false); // duplicate page
  a.list("/var", 2); const next = sent.at(-1)!.request;
  expect(a.accept(reply(first, 1), 3)).toBe(false); // cancelled navigation
  expect(a.accept({ ...reply(next), entries: [null] }, 3)).toBe(false);
  expect(a.accept(reply(next), 3)).toBe(true);
  a.open("/Applications/Example App.app", 3); const launch = sent.at(-1)!;
  expect(launch.path).toBe("/Applications/Example App.app");
  expect(a.accept({ t: "files", request: launch.request, opened: true }, 4)).toBe(false);
  expect(a.entries()).toEqual([file]);
  expect(a.status()).toBe("Opened in macOS");
  expect(b.accept(reply(second), 4)).toBe(true);
  a.open("/tmp/letter.txt", 5); const oldLaunch = sent.at(-1)!;
  a.list("/", 6);
  a.accept({ t: "files", request: oldLaunch.request, error: "late failure" }, 7);
  expect(a.status()).toBe("Loading...");
  a.tick(17);
  expect(a.loading()).toBe(false);
  expect(a.status()).toContain("Refresh to retry");
  a.hidden.set(true); a.list("/tmp", 18);
  expect(sent.at(-1)?.hidden).toBe(true);
});

test("selection preserves icon alpha and applies each theme's paint at both densities", () => {
  for (const prefix of ["", "xp-", "classic-"]) for (const density of [1, 2]) {
    const input = readFileSync(new URL(`../assets/icons/${prefix}files-${32 * density}.png`, import.meta.url));
    const original = decodePng(input), selected = decodePng(selectedIcon(input, prefix, density));
    expect(selected.width).toBe(original.width);
    let changed = 0;
    for (let i = 0; i < selected.rgba.length; i += 4) {
      expect(selected.rgba[i + 3]).toBe(original.rgba[i + 3]);
      if (selected.rgba[i + 3] > 0 && selected.rgba[i] !== original.rgba[i]) changed++;
    }
    expect(changed).toBeGreaterThan(100);
  }
});
