// SPDX-License-Identifier: GPL-3.0-or-later
// The bounded JSON reader and writer (devices/services/jscan.c) and the
// vendored QR decoder (devices/services/quirc), compiled for the build machine
// under ASan and UBSan: the reader finds members and survives malformed
// input, and quirc decodes a code of the test's encoder (test/qr.ts) in a
// frame of the camera's size.
//
// This is the part of PocketJS tests/3ds-link.test.ts that needs no Pocket
// Link 1 source. Its proof, pairing URI and beacon cases compile
// link_proto.c, which stays in PocketJS.

import { afterAll,beforeAll,describe,expect,test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { encodeQr,rasterizeQr } from "./qr.ts";

/** devices/services: jscan.c and quirc. */
const shared = resolve(import.meta.dir, "..");

// argv-driven probe: one command per run, one result line on stdout.
const HARNESS = String.raw`
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "jscan.h"
#include "quirc/quirc.h"

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  const char *command = argv[1];
  if (strcmp(command, "json") == 0) {
    /* json <document> <key>[.<key>…] -> string or u64 value */
    JsonSpan span = json_span(argv[2], strlen(argv[2]));
    char path[256];
    snprintf(path, sizeof path, "%s", argv[3]);
    char *saveptr = NULL;
    for (char *key = strtok_r(path, ".", &saveptr); key != NULL; key = strtok_r(NULL, ".", &saveptr)) {
      if (!json_find(span, key, &span)) {
        puts("missing");
        return 0;
      }
    }
    char text[512];
    uint64_t number = 0;
    if (json_string(span, text, sizeof text)) puts(text);
    else if (json_u64(span, &number)) printf("%llu\n", (unsigned long long)number);
    else printf("raw:%.*s\n", (int)span.length, span.start);
  } else if (strcmp(command, "write") == 0) {
    JsonBuffer out = { 0 };
    jbuf_text(&out, "{\"s\":");
    jbuf_cstring(&out, argv[2]);
    jbuf_text(&out, "}");
    puts(jbuf_cstr(&out));
    jbuf_free(&out);
  } else if (strcmp(command, "qr") == 0) {
    /* qr <gray8 file> <width> <height> */
    int width = atoi(argv[3]), height = atoi(argv[4]);
    FILE *file = fopen(argv[2], "rb");
    if (file == NULL) return 3;
    struct quirc *decoder = quirc_new();
    if (decoder == NULL || quirc_resize(decoder, width, height) < 0) return 4;
    uint8_t *image = quirc_begin(decoder, NULL, NULL);
    if (fread(image, 1, (size_t)width * height, file) != (size_t)width * height) return 5;
    fclose(file);
    quirc_end(decoder);
    for (int i = 0; i < quirc_count(decoder); i += 1) {
      struct quirc_code code;
      struct quirc_data data;
      quirc_extract(decoder, i, &code);
      if (quirc_decode(&code, &data) == QUIRC_SUCCESS) {
        printf("%.*s\n", data.payload_len, (const char *)data.payload);
        quirc_destroy(decoder);
        return 0;
      }
    }
    puts("none");
    quirc_destroy(decoder);
  } else {
    return 2;
  }
  return 0;
}
`;

let scratch = "";
let binary = "";

function run(...args: string[]): string {
  const result = Bun.spawnSync([binary, ...args]);
  if (result.exitCode !== 0) throw new Error(`harness ${args[0]} exited ${result.exitCode}: ${result.stderr}`);
  return result.stdout.toString().replace(/\n$/, "");
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "pocket-jscan-quirc-"));
  binary = join(scratch, "harness");
  writeFileSync(join(scratch, "harness.c"), HARNESS);
  const compile = Bun.spawnSync([
    "cc", "-std=gnu11", "-O1", "-Wall", "-Wextra", "-fsanitize=address,undefined",
    `-I${shared}`, join(scratch, "harness.c"), join(shared, "jscan.c"),
    join(shared, "quirc/quirc.c"), join(shared, "quirc/decode.c"), join(shared, "quirc/identify.c"),
    join(shared, "quirc/version_db.c"), "-lm", "-o", binary,
  ]);
  expect(compile.exitCode, compile.stderr.toString()).toBe(0);
});

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("host services: JSON and QR", () => {
  test("the bounded JSON reader finds members, unescapes and survives malformed input", () => {
    const doc = JSON.stringify({
      t: "net.head",
      id: 7,
      headers: { "content-type": "text/html", x: "a}b{c\"d" },
      app: { id: "dev.pocket-nexus.hn", title: "Hacker News ☃ 😀", output: "hn-main" },
      bytes: 4096,
    });
    expect(run("json", doc, "t")).toBe("net.head");
    expect(run("json", doc, "id")).toBe("7");
    expect(run("json", doc, "bytes")).toBe("4096");
    expect(run("json", doc, "headers.x")).toBe('a}b{c"d');
    expect(run("json", doc, "app.title")).toBe("Hacker News ☃ 😀");
    expect(run("json", doc, "app.output")).toBe("hn-main");
    expect(run("json", doc, "app.missing")).toBe("missing");
    expect(run("json", '{"a":"\\u00e9\\ud83d\\ude00"}', "a")).toBe("é😀");
    expect(run("json", '{"a":[1,{"b":2}],"c":3}', "c")).toBe("3");
    // The reader validates the document up to the member it returns.
    for (const bad of ['{"a":', '{"a" 1}', '{"a":"x', "[1,2]", '{"b":1,}', "{{{{", '{"b":[}],"a":1}']) {
      expect(run("json", bad, "a")).toBe("missing");
    }
    const tricky = 'quote " slash \\ newline \n tab \t bell \u0007 é';
    expect(JSON.parse(run("write", tricky))).toEqual({ s: tricky });
  });

  test("the vendored quirc decodes an install code at camera size", () => {
    // The payload a launcher's scanner reads: an install code. At 145 bytes it
    // is a version 8 code, 228 pixels wide at this scale, inside the 240 rows.
    const uri = `pocketlink://install?v=1&a=dev.pocket-nexus.hn&s=${randomBytes(32).toString("hex")}` +
      "&u=https://example.org/hn.pocket";
    expect(uri.length).toBe(145);
    const raster = rasterizeQr(encodeQr(uri), 4, 4);
    // Centre it in a mid-grey 320x240 frame, as the outer camera delivers.
    const width = 320, height = 240;
    const frame = new Uint8Array(width * height).fill(128);
    const left = (width - raster.width) >> 1, top = (height - raster.width) >> 1;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    for (let y = 0; y < raster.width; y++) {
      frame.set(raster.pixels.subarray(y * raster.width, (y + 1) * raster.width), (top + y) * width + left);
    }
    const path = join(scratch, "frame.gray");
    writeFileSync(path, frame);
    expect(run("qr", path, String(width), String(height))).toBe(uri);
  });
});
