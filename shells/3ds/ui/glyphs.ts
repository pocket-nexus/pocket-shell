// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/ui/glyphs.ts — runtime text in any script, drawn from a font
// atlas the linked Mac renders.
//
// The baked faces hold ASCII and the bundle's own literals, so a Chinese
// name, a Japanese post or an emoji arrives with no glyph on the console
// (ui/text.ts folds such text to ASCII). An app that wants it drawn asks the
// companion's glyphs service (PocketJS tools/companion/services/glyphs.ts)
// for an atlas holding the text it is about to show, loads it into a font
// slot of its own with `ui.loadFontAtlas`, and draws that text from the slot.
//
//   const face = createGlyphs(GLYPH_TEXT);
//   face.want([post.name, post.text]);          // as data arrives
//   face.covers(text) ? face.wrap(text, w) : wrap(toAscii(text), FONT.sm, w)
//
// One request is in flight at a time; codepoints wanted meanwhile ride the
// next one. The NET module holds at most two requests at once, so an app
// with its own request queue passes `send` and the atlas waits its turn. Every atlas holds printable ASCII, the codepoints already shown
// and the new ones, up to what one NET response carries (GLYPH_CAP); past
// that it starts over with the latest text's codepoints. `revision()` bumps
// when an atlas loads, so layouts that measured with the old one redo it.

import { createSignal, type Accessor } from "solid-js";
import { getOps } from "@pocketjs/framework/host";
import { companionService } from "@pocketjs/framework/link";
import { fetch } from "@pocketjs/framework/net";

export interface GlyphFace {
  /** The font slot the atlas binds: 21 and 22 are free (19/20 are text-2xs,
   *  23 the agent overlay's). */
  slot: number;
  px: number;
  bold: boolean;
}

export const GLYPH_TEXT: GlyphFace = { slot: 21, px: 13, bold: false };
export const GLYPH_BOLD: GlyphFace = { slot: 22, px: 13, bold: true };

/** A NET response's limit (PocketJS contracts/spec/net.ts). */
const RESPONSE_MAX = 256 * 1024;

/** Glyphs one atlas of `px` holds within a NET response: the 16-byte header,
 *  then an 8-byte cmap entry and a (px+2) x ceil(px*1.4) cell per glyph
 *  (the companion's atlasFont), with 1 KB to spare. */
export function glyphCap(px: number): number {
  return Math.floor((RESPONSE_MAX - 16 - 1024) / (8 + (px + 2) * Math.ceil(px * 1.4)));
}

/** Codepoints drawn as nothing: variation selectors, the zero-width joiner
 *  and skin-tone modifiers (an emoji sequence draws as its parts). */
function silent(cp: number): boolean {
  return (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d || cp === 0x200b || (cp >= 0x1f3fb && cp <= 0x1f3ff) || cp === 0xe0020 || (cp >= 0xe0061 && cp <= 0xe007f);
}

/** `text` with the silent codepoints removed and tabs as spaces. */
export function richText(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (silent(cp)) continue;
    out += cp === 0x09 ? " " : ch;
  }
  return out;
}

/** Characters that break anywhere (CJK, kana, hangul, emoji, symbols). */
function wide(cp: number): boolean {
  return cp >= 0x2e80;
}

/** Closing punctuation that hangs at a line's end rather than opening one.
 *  Code points, not a string: every literal in the bundle is baked into
 *  every font atlas. */
const CLOSING = new Set([
  0xff0c, 0x3002, 0xff01, 0xff1f, 0xff1a, 0xff1b, 0x3001, 0xff09, 0x300b, 0x300d, 0x300f, 0x201d, 0x2019, 0x2026,
  0x2c, 0x2e, 0x21, 0x3f, 0x3a, 0x3b, 0x29, 0x5d,
]);

const ELLIPSIS = "...";

export interface Glyphs {
  readonly face: GlyphFace;
  /** Bumps when an atlas loads. */
  revision: Accessor<number>;
  /** An atlas is loaded in the slot. */
  ready(): boolean;
  /** Every codepoint of `text` is in the loaded atlas. */
  covers(text: string): boolean;
  /** Ask for the codepoints of `texts` (the latest page's text first). */
  want(texts: readonly string[]): void;
  /** Width of one line in the slot. */
  measure(text: string): number;
  /** Greedy wrap: wide characters break anywhere, words at spaces, a word
   *  longer than a line by character; "\n" kept. The last kept line ends in
   *  "..." when text was dropped. */
  wrap(text: string, maxW: number, maxLines?: number): string[];
  /** The longest prefix that fits, with "..." when it was cut. */
  ellipsize(text: string, maxW: number): string;
}

/** POST `body` (JSON) to the glyphs service; the atlas bytes. */
export type GlyphSend = (body: string) => Promise<Uint8Array>;

/** The service URL, for an app's own queue. */
export const GLYPH_ATLAS_URL = companionService("glyphs", "/atlas");

const directSend: GlyphSend = (body) =>
  fetch(GLYPH_ATLAS_URL, { method: "POST", headers: { "content-type": "application/json" }, body, maxBytes: RESPONSE_MAX, timeoutMs: 20_000 }).then(
    async (response) => {
      if (!response.ok) throw new Error(`glyphs: HTTP ${response.status}`);
      return await response.bytes();
    },
  );

export function createGlyphs(face: GlyphFace, send: GlyphSend = directSend): Glyphs {
  const [revision, setRevision] = createSignal(0);
  const cap = glyphCap(face.px);
  let loaded: Set<number> | null = null;
  /** What the next atlas holds: everything shown so far, then the new. */
  let wanted = new Set<number>();
  let latest: number[] = [];
  let inFlight = false;
  let dirty = false;
  const advances = new Map<number, number>();

  const advance = (cp: number): number => {
    let w = advances.get(cp);
    if (w === undefined) {
      w = getOps().measureText(String.fromCodePoint(cp), face.slot);
      advances.set(cp, w);
    }
    return w;
  };

  const request = () => {
    if (inFlight || !dirty) return;
    inFlight = true;
    dirty = false;
    const sending = new Set(wanted);
    let text = "";
    for (const cp of sending) text += String.fromCodePoint(cp);
    send(JSON.stringify({ px: face.px, bold: face.bold, slot: face.slot, text })).then(
      (bytes) => {
        inFlight = false;
        // The 3DS host answers false for a blob it cannot parse.
        const load = getOps().loadFontAtlas as ((buf: Uint8Array) => unknown) | undefined;
        if (load && load(bytes) !== false) {
          loaded = sending;
          advances.clear();
          setRevision(revision() + 1);
        }
        request();
      },
      () => {
        inFlight = false;
        // A lost request is not retried by itself; the next want() asks again.
        dirty = true;
      },
    );
  };

  const glyphs: Glyphs = {
    face,
    revision,
    ready: () => loaded !== null,
    covers(text) {
      if (!loaded) return false;
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp >= 0x20 && cp < 0x7f) continue;
        if (cp === 0x0a || silent(cp)) continue;
        if (!loaded.has(cp)) return false;
      }
      return true;
    },
    want(texts) {
      const fresh: number[] = [];
      for (const text of texts) {
        for (const ch of text) {
          const cp = ch.codePointAt(0)!;
          if (cp < 0x7f || silent(cp)) continue;
          if (!wanted.has(cp) && !fresh.includes(cp)) fresh.push(cp);
        }
      }
      // ASCII-only text needs no atlas: the baked faces draw it.
      if (fresh.length === 0) return;
      latest = [...fresh, ...latest].slice(0, cap);
      // ASCII is always in the atlas; room for the rest is what remains.
      const room = cap - 95;
      if (wanted.size + fresh.length > room) wanted = new Set(latest.slice(0, room));
      else for (const cp of fresh) wanted.add(cp);
      dirty = true;
      request();
    },
    measure(text) {
      let w = 0;
      for (const ch of text) w += advance(ch.codePointAt(0)!);
      return w;
    },
    wrap(text, maxW, maxLines = Infinity) {
      const lines: string[] = [];
      for (const paragraph of text.split("\n")) {
        if (lines.length > maxLines) break;
        let line = "";
        let lineW = 0;
        const tokens = paragraph.match(/[\u{2e80}-\u{10ffff}]|[^\s\u{2e80}-\u{10ffff}]+|\s+/gu) ?? [];
        for (const token of tokens) {
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
          if (tokenW > maxW && !wide(first)) {
            // A word wider than the line (a URL): break it by characters.
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
        kept[maxLines - 1] = glyphs.ellipsize(`${kept[maxLines - 1]!}${ELLIPSIS}`, maxW);
        return kept;
      }
      return lines;
    },
    ellipsize(text, maxW) {
      if (glyphs.measure(text) <= maxW) return text;
      const room = maxW - glyphs.measure(ELLIPSIS);
      let out = "";
      let w = 0;
      for (const ch of text.endsWith(ELLIPSIS) ? text.slice(0, -ELLIPSIS.length) : text) {
        const cw = advance(ch.codePointAt(0)!);
        if (w + cw > room) break;
        out += ch;
        w += cw;
      }
      return out.trimEnd() + ELLIPSIS;
    },
  };
  return glyphs;
}
