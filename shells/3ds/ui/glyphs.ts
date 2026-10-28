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
// when an atlas loads. A glyph's advance is the same in every atlas of a
// face, so a text an atlas covers keeps its layout while later atlases grow;
// `epoch()` bumps only when an atlas starts over and may drop a glyph.

import { createSignal, type Accessor } from "solid-js";
import { getOps } from "@pocketjs/framework/host";
import { onFrame } from "@pocketjs/framework/lifecycle";
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

/** A tab or a silent codepoint, as UTF-16 units. */
const SILENT_OR_TAB = /[\t\u200b\u200d\ufe00-\ufe0f]|\ud83c[\udffb-\udfff]|\udb40[\udc20\udc61-\udc7f]/;

/** `text` with the silent codepoints removed and tabs as spaces. */
export function richText(text: string): string {
  if (!SILENT_OR_TAB.test(text)) return text;
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (silent(cp)) continue;
    out += cp === 0x09 ? " " : ch;
  }
  return out;
}

/** What an atlas has to hold for a text, each codepoint once: everything
 *  but printable ASCII, "\n" and the silent codepoints. Kept per text, as
 *  layout and want() ask about the same texts again and again. */
const needed = new Map<string, readonly number[]>();
function neededBy(text: string): readonly number[] {
  let cps = needed.get(text);
  if (cps) return cps;
  const seen = new Set<number>();
  for (let at = 0; at < text.length; ) {
    const cp = text.codePointAt(at)!;
    at += cp > 0xffff ? 2 : 1;
    if ((cp >= 0x20 && cp < 0x7f) || cp === 0x0a || silent(cp)) continue;
    seen.add(cp);
  }
  cps = [...seen];
  if (needed.size > 2048) needed.clear();
  needed.set(text, cps);
  return cps;
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

/** \s below U+2E80; from there on every character is a token of its own. */
function isSpace(c: number): boolean {
  return c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f;
}

/** Greedy wrap (Glyphs.wrap) with `advance` for a codepoint's width. The
 *  tokens are one wide character, a run of whitespace, or a run of anything
 *  else, read by index. Tokens from a /u regex and string iterators cost
 *  QuickJS about 29 ms for a 140-character Japanese post on an Old 3DS. */
export function wrapLines(
  text: string,
  maxW: number,
  maxLines: number,
  advance: (cp: number) => number,
  ellipsize: (text: string, maxW: number) => string,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (lines.length > maxLines) break;
    let line = "";
    let lineW = 0;
    const end = paragraph.length;
    let at = 0;
    while (at < end) {
      const start = at;
      const first = paragraph.codePointAt(at)!;
      let tokenW = 0;
      // Whitespace past U+2E80 (U+3000, U+FEFF) starts a token of its own
      // but joins a run that started before it, as the regex tokens did.
      if (first === 0x3000 || first === 0xfeff) {
        tokenW = advance(first);
        at += 1;
      } else if (first < 0x2e80 && isSpace(first)) {
        for (let c = first; at < end && (c === 0x3000 || c === 0xfeff || (c < 0x2e80 && isSpace(c))); c = paragraph.charCodeAt(at)) {
          tokenW += advance(c);
          at += 1;
        }
      }
      if (at > start) {
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
      if (wide(first)) {
        tokenW = advance(first);
        at += first > 0xffff ? 2 : 1;
      } else {
        // Below U+2E80 every character is one UTF-16 unit.
        for (let c = first; at < end && c < 0x2e80 && !isSpace(c); c = paragraph.charCodeAt(at)) {
          tokenW += advance(c);
          at += 1;
        }
      }
      const token = paragraph.slice(start, at);
      if (lineW + tokenW <= maxW || (token.length <= 2 && CLOSING.has(first))) {
        line += token;
        lineW += tokenW;
        continue;
      }
      if (tokenW > maxW && !wide(first)) {
        // A word wider than the line (a URL): break it by characters.
        for (let index = start; index < at; index += 1) {
          const w = advance(paragraph.charCodeAt(index));
          if (lineW + w > maxW && line !== "") {
            lines.push(line.trimEnd());
            line = "";
            lineW = 0;
          }
          line += paragraph[index];
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
    kept[maxLines - 1] = ellipsize(`${kept[maxLines - 1]!}${ELLIPSIS}`, maxW);
    return kept;
  }
  return lines;
}

export interface Glyphs {
  readonly face: GlyphFace;
  /** Bumps when an atlas loads. */
  revision: Accessor<number>;
  /** Bumps when an atlas loads without every codepoint of the one before. */
  epoch(): number;
  /** Bumps when the wanted codepoints start over: a text want() took before
   *  may have to be asked for again. */
  wants(): number;
  /** An atlas is loaded in the slot. */
  ready(): boolean;
  /** Every codepoint of `text` is in the loaded atlas. */
  covers(text: string): boolean;
  /** The first codepoint of `text` the loaded atlas lacks (0 before any
   *  atlas loads), or -1. */
  missing(text: string): number;
  /** `cp` is in the loaded atlas; 0 (missing() before any atlas) once one
   *  has loaded. */
  holds(cp: number): boolean;
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

export interface GlyphOptions {
  /** Atlases are asked for and loaded only in frames where this answers
   *  true; want() meanwhile only records the codepoints, and an atlas that
   *  arrives waits, the newest replacing an older. Building a request costs
   *  QuickJS tens of milliseconds on an Old 3DS (the body is UTF-8 encoded
   *  a byte at a time), and loading an atlas uploads its texture and lays
   *  out every text in its slot again: a moving list shows both as dropped
   *  frames. */
  when?: () => boolean;
}

export function createGlyphs(face: GlyphFace, send: GlyphSend = directSend, options: GlyphOptions = {}): Glyphs {
  const [revision, setRevision] = createSignal(0);
  let epoch = 0;
  let wants = 0;
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

  let pending: { bytes: Uint8Array; holds: Set<number> } | null = null;
  const apply = (bytes: Uint8Array, holds: Set<number>) => {
    // The 3DS host answers false for a blob it cannot parse.
    const load = getOps().loadFontAtlas as ((buf: Uint8Array) => unknown) | undefined;
    if (!load || load(bytes) === false) return;
    let dropped = false;
    if (loaded) for (const cp of loaded) if (!holds.has(cp)) dropped = true;
    if (dropped) {
      epoch += 1;
      advances.clear();
    }
    loaded = holds;
    setRevision(revision() + 1);
  };
  /** A want() since the last request went out; a failed request waits for
   *  the next want() rather than retrying every frame. */
  let due = false;
  const request = () => {
    if (inFlight || !dirty || !due || (options.when && !options.when())) return;
    inFlight = true;
    dirty = false;
    due = false;
    const sending = new Set(wanted);
    const text = String.fromCodePoint(...sending);
    send(JSON.stringify({ px: face.px, bold: face.bold, slot: face.slot, text })).then(
      (bytes) => {
        inFlight = false;
        if (options.when && !options.when()) pending = { bytes, holds: sending };
        else {
          pending = null;
          apply(bytes, sending);
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
  if (options.when) {
    const when = options.when;
    onFrame(() => {
      if (!when()) return;
      if (pending) {
        const atlas = pending;
        pending = null;
        apply(atlas.bytes, atlas.holds);
      }
      request();
    });
  }

  const glyphs: Glyphs = {
    face,
    revision,
    epoch: () => epoch,
    wants: () => wants,
    ready: () => loaded !== null,
    covers(text) {
      return glyphs.missing(text) < 0;
    },
    missing(text) {
      // With no atlas loaded, every text lacks one: 0 stands for it.
      if (!loaded) return 0;
      for (const cp of neededBy(text)) if (!loaded.has(cp)) return cp;
      return -1;
    },
    holds: (cp) => loaded !== null && (cp === 0 || loaded.has(cp)),
    want(texts) {
      const fresh = new Set<number>();
      for (const text of texts) {
        for (const cp of neededBy(text)) {
          // Control characters are never drawn and never asked for.
          if (cp >= 0x7f && !wanted.has(cp)) fresh.add(cp);
        }
      }
      // ASCII-only text needs no atlas: the baked faces draw it.
      if (fresh.size === 0) return;
      latest = [...fresh, ...latest].slice(0, cap);
      // ASCII is always in the atlas; room for the rest is what remains.
      const room = cap - 95;
      if (wanted.size + fresh.size > room) {
        wanted = new Set(latest.slice(0, room));
        wants += 1;
      } else {
        for (const cp of fresh) wanted.add(cp);
      }
      dirty = true;
      due = true;
      request();
    },
    measure(text) {
      let w = 0;
      for (const ch of text) w += advance(ch.codePointAt(0)!);
      return w;
    },
    wrap(text, maxW, maxLines = Infinity) {
      return wrapLines(text, maxW, maxLines, advance, glyphs.ellipsize);
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
