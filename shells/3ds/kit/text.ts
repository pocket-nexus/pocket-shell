// SPDX-License-Identifier: GPL-3.0-or-later
// applets/kit/text.ts — text from the network in any script. ASCII draws from
// the baked faces at their sizes; anything else draws from the glyph atlases
// (ui/glyphs.ts) once they cover it, and folded to ASCII until then. Whoever
// builds rows reads `faces.revision()`, so a row is laid out again as glyphs arrive.
import { createGlyphs, GLYPH_BOLD, GLYPH_TEXT, richText, type Glyphs } from "../ui/glyphs.ts";
import { ellipsize, measure, toAscii, wrap } from "../ui/text.ts";
import { F } from "./theme.ts";

export interface Faces {
  text: Glyphs;
  bold: Glyphs;
  revision(): number;
}

export function createFaces(): Faces {
  const text = createGlyphs(GLYPH_TEXT);
  const bold = createGlyphs(GLYPH_BOLD);
  return { text, bold, revision: () => text.revision() + bold.revision() };
}

const PLAIN = /^[\x00-\x7f]*$/;
export const isPlain = (value: string) => PLAIN.test(value);

/** Curly quotes, dashes and ellipses are drawn from the baked faces as their
 *  ASCII spelling: an atlas glyph beside baked text looks out of place. */
export const typographic = (value: string) =>
  value.replace(/[\u2018\u2019\u201a\u2032]/g, "'").replace(/[\u201c\u201d\u201e\u2033]/g, "\"").replace(/[\u2013\u2014\u2015\u2212]/g, "-").replace(/\u2026/g, "...").replace(/\u00a0/g, " ");

const isBold = (slot: number) => slot >= 7 && slot <= 13;

export interface Fitted {
  lines: string[];
  /** The font slot to draw it from. */
  slot: number;
}

/** `value` wrapped to `width` in `slot`, at most `maxLines` lines, in the face that can draw it. */
export function fit(faces: Faces, value: string, slot: number, width: number, maxLines = Infinity): Fitted {
  const clean = typographic(value.replace(/\r/g, ""));
  if (isPlain(clean)) return { lines: maxLines === 1 ? [ellipsize(clean.replace(/\n/g, " "), slot, width)] : wrap(clean, slot, width, maxLines), slot };
  const face = isBold(slot) ? faces.bold : faces.text;
  const rich = richText(clean);
  face.want([rich]);
  if (face.covers(rich)) return { lines: maxLines === 1 ? [face.ellipsize(rich.replace(/\n/g, " "), width)] : face.wrap(rich, width, maxLines), slot: isBold(slot) ? F.richBold : F.richBody };
  const folded = toAscii(clean);
  return { lines: maxLines === 1 ? [ellipsize(folded.replace(/\n/g, " "), slot, width)] : wrap(folded, slot, width, maxLines), slot };
}

export const textWidth = (faces: Faces, value: string, slot: number) =>
  isPlain(value) ? measure(value, slot) : (isBold(slot) ? faces.bold : faces.text).covers(richText(value)) ? (isBold(slot) ? faces.bold : faces.text).measure(richText(value)) : measure(toAscii(value), slot);
