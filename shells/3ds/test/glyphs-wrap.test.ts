// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/glyphs-wrap.test.ts — runtime-glyph wrapping
// (shells/3ds/ui/glyphs.ts wrapLines) reads by index the tokens a /u regex
// read before: one wide character, a run of whitespace, a run of anything
// else. The reference below is that regex wrap; both must break every text
// alike.

import { describe, expect, test } from "bun:test";
import { wrapLines } from "../ui/glyphs.ts";

const CLOSING = new Set([0xff0c, 0x3002, 0xff01, 0xff1f, 0xff1a, 0xff1b, 0x3001, 0xff09, 0x300b, 0x300d, 0x300f, 0x201d, 0x2019, 0x2026, 0x2c, 0x2e, 0x21, 0x3f, 0x3a, 0x3b, 0x29, 0x5d]);

function regexWrap(text: string, maxW: number, maxLines: number, advance: (cp: number) => number, ellipsize: (text: string, maxW: number) => string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (lines.length > maxLines) break;
    let line = "";
    let lineW = 0;
    for (const token of paragraph.match(/[\u{2e80}-\u{10ffff}]|[^\s\u{2e80}-\u{10ffff}]+|\s+/gu) ?? []) {
      let tokenW = 0;
      for (const ch of token) tokenW += advance(ch.codePointAt(0)!);
      if (/^\s+$/.test(token)) {
        if (line === "") continue;
        if (lineW + tokenW > maxW) {
          lines.push(line);
          line = "";
          lineW = 0;
        } else {
          line += " ";
          lineW += advance(0x20);
        }
        continue;
      }
      const first = token.codePointAt(0)!;
      if (lineW + tokenW <= maxW || (token.length <= 2 && CLOSING.has(first))) {
        line += token;
        lineW += tokenW;
        continue;
      }
      if (tokenW > maxW && first < 0x2e80) {
        for (const ch of token) {
          const w = advance(ch.codePointAt(0)!);
          if (lineW + w > maxW && line !== "") {
            lines.push(line.trimEnd());
            line = "";
            lineW = 0;
          }
          line += ch;
          lineW += w;
        }
        continue;
      }
      if (line.trim() !== "") lines.push(line.trimEnd());
      line = token;
      lineW = tokenW;
    }
    lines.push(line.trimEnd());
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsize(`${kept[maxLines - 1]!}...`, maxW);
    return kept;
  }
  return lines;
}

const advance = (cp: number) => (cp < 0x80 ? 4 + (cp % 5) : cp >= 0x2e80 ? 13 : 7);
const ellipsize = (text: string, maxW: number) => `${text.slice(0, Math.floor(maxW / 6))}|`;

describe("wrapLines", () => {
  test("breaks Japanese, Latin, URLs and closing punctuation as before", () => {
    expect(wrapLines("大学の予算を20年毎年削ってきたくせに！？学生に負担させようと！？", 120, 7, advance, ellipsize)).toEqual(regexWrap("大学の予算を20年毎年削ってきたくせに！？学生に負担させようと！？", 120, 7, advance, ellipsize));
    const url = "See https://example.com/a/very/long/path/that/never/ends here";
    const lines = wrapLines(url, 80, 7, advance, ellipsize);
    expect(lines).toEqual(regexWrap(url, 80, 7, advance, ellipsize));
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) expect([...line].reduce((w, ch) => w + advance(ch.codePointAt(0)!), 0)).toBeLessThanOrEqual(80);
  });

  test("matches the regex wrap on random text", () => {
    const pieces = ["hello", "world", " ", "  ", "\t", "　", "日本語", "の", "。", "、", "！", "」", "🎉", "👩‍👩‍👧", "https://example.com/a/very/long/path", "\n", "\n\n", ",", ".", "a", " ", " ", "x".repeat(70), "\r", "﻿", "élan"];
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let run = 0; run < 3000; run += 1) {
      let text = "";
      for (let k = Math.floor(random() * 40); k > 0; k -= 1) text += pieces[Math.floor(random() * pieces.length)];
      const maxW = [40, 80, 150, 260][Math.floor(random() * 4)]!;
      const maxLines = [1, 2, 7, Infinity][Math.floor(random() * 4)]!;
      expect(wrapLines(text, maxW, maxLines, advance, ellipsize)).toEqual(regexWrap(text, maxW, maxLines, advance, ellipsize));
    }
  });
});
