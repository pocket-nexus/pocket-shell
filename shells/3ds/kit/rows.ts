// SPDX-License-Identifier: GPL-3.0-or-later
// applets/kit/rows.ts — what a page is made of. A page is one list of rows, and
// each builder here does the measuring and spacing, so a page says only what
// it shows:
//
//   rows.cell({ icon, title, detail, pills, trailing, run })   a list item
//   rows.section("Files")                                      a heading between groups
//   rows.text("words", "body")                                 a block of text
//   rows.strip([{ label, icon, tone, run }])                   buttons, filters, stats
//   rows.message({ title, detail, action })                    empty, failed, signed out
//
// `h` and every place come from here; `y` is filled in by the list.
import { ICONS, type IconSrc } from "./icons.ts";
import { fit, textWidth, type Faces } from "./text.ts";
import { F, pillColors, S, T } from "./theme.ts";

interface Base {
  key: string;
  y: number;
  h: number;
  /** What a tap on the row does. */
  id?: string;
  run?: () => void;
}

export interface Pill {
  text: string;
  x: number;
  w: number;
  bg: string;
  fg: string;
}

export interface CellRow extends Base {
  kind: "cell";
  eyebrow: string;
  eyebrowSlot: number;
  title: string;
  titleSlot: number;
  titleColor: string;
  titleY: number;
  titleLeading: number;
  detail: string;
  detailSlot: number;
  detailColor: string;
  detailY: number;
  textX: number;
  trailing: string;
  trailingColor: string;
  icon: IconSrc | "";
  avatar: string;
  avatarSize: number;
  pills: Pill[];
  pillsY: number;
  chevron: boolean;
  unread: boolean;
}

export interface TextRow extends Base {
  kind: "text";
  text: string;
  slot: number;
  color: string;
  leading: number;
  x: number;
  top: number;
  /** A block behind the text: code. */
  block: boolean;
  /** A bar at the left: a quote. */
  bar: boolean;
  /** A heading's rule, or a section's band. */
  rule: boolean;
  band: boolean;
  bullet: string;
  bulletX: number;
}

export type Tone = "chip" | "chipOn" | "button" | "primary" | "danger" | "stat";

export interface StripItem {
  id: string;
  label: string;
  x: number;
  w: number;
  h: number;
  y: number;
  icon: IconSrc | "";
  tone: Tone;
  run?: () => void;
}

export interface StripRow extends Base {
  kind: "strip";
  items: StripItem[];
}

export type Row = CellRow | TextRow | StripRow;

export type TextStyle = "h1" | "h2" | "h3" | "body" | "small" | "quote" | "code" | "li";

const STYLES: Record<TextStyle, { slot: number; leading: number; color: string; top: number; bottom: number }> = {
  h1: { slot: F.h1, leading: 26, color: T.text, top: 14, bottom: 8 },
  h2: { slot: F.h2, leading: 24, color: T.text, top: 14, bottom: 8 },
  h3: { slot: F.h3, leading: 22, color: T.text, top: 10, bottom: 4 },
  body: { slot: F.body, leading: 20, color: T.text, top: 4, bottom: 6 },
  small: { slot: F.small, leading: 16, color: T.muted, top: 4, bottom: 4 },
  quote: { slot: F.body, leading: 20, color: T.muted, top: 4, bottom: 6 },
  code: { slot: F.mono, leading: 17, color: T.text, top: 8, bottom: 8 },
  li: { slot: F.body, leading: 20, color: T.text, top: 1, bottom: 2 },
};

/** Lines a single text row holds; longer text becomes several rows, so a long
 *  document is drawn a screen at a time. */
const LINES_PER_ROW = 24;

export interface CellOptions {
  key: string;
  title: string;
  /** Lines of title before it is cut (default 2). */
  titleLines?: number;
  /** A larger title, for the head of a page. */
  big?: boolean;
  /** A small line above the title: where it belongs. */
  eyebrow?: string;
  detail?: string;
  detailLines?: number;
  /** A status icon at the left: `ICONS["pr-open"].green`. */
  icon?: IconSrc;
  /** An avatar's URL at the left. */
  avatar?: string;
  avatarSize?: number;
  /** A short value at the right edge: a time, a count. */
  trailing?: string;
  /** Coloured labels under the text: `{ text, color: "d73a4a" }`. */
  pills?: { text: string; color: string }[];
  /** A dot: unread. */
  unread?: boolean;
  /** Tapping it does something: a chevron shows unless `chevron` is false. */
  run?: () => void;
  chevron?: boolean;
}

export interface StripOption {
  /** An id for its press and keyboard focus. */
  id?: string;
  label: string;
  icon?: IconSrc;
  /** chip / chipOn: a filter. button, primary, danger: an action. stat: a figure. */
  tone?: Tone;
  run?: () => void;
}

export interface MessageOptions {
  key: string;
  title: string;
  detail?: string;
  /** A button under it: Retry, Sign In. */
  action?: { label: string; run: () => void };
}

export interface Rows {
  width: number;
  cell(options: CellOptions): Row;
  section(label: string, key?: string): Row;
  text(value: string, style?: TextStyle, key?: string, options?: { indent?: number; bullet?: string }): Row[];
  strip(options: StripOption[], key: string, even?: boolean): Row[];
  message(options: MessageOptions): Row[];
  space(h: number, key: string): Row;
}

const ITEM_H: Record<Tone, number> = { chip: S.chipH, chipOn: S.chipH, button: S.buttonH, primary: S.buttonH, danger: S.buttonH, stat: 20 };

export function createRows(faces: Faces, width: number): Rows {
  const blank = (key: string): TextRow => ({
    kind: "text", key, y: 0, h: 0, text: "", slot: F.body, color: T.text, leading: 20, x: S.pad, top: 0, block: false, bar: false, rule: false, band: false, bullet: "", bulletX: 0,
  });
  const api: Rows = {
    width,
    cell(o) {
      const size = o.avatar !== undefined ? o.avatarSize ?? S.avatar : 0;
      const textX = S.pad + (size ? size + 10 : o.icon ? S.icon + 10 : 0);
      const chevron = o.chevron ?? o.run !== undefined;
      const trailing = o.trailing ?? "";
      const room = width - textX - S.pad - (chevron ? 16 : 0);
      const titleSlot = o.big ? F.h2 : F.title;
      const titleLeading = o.big ? 24 : 18;
      const eyebrow = o.eyebrow ? fit(faces, o.eyebrow, F.small, room - (trailing ? textWidth(faces, trailing, F.small) + 8 : 0), 1) : null;
      const titleRoom = eyebrow || !trailing ? room : room - textWidth(faces, trailing, F.small) - 8;
      const title = fit(faces, o.title, titleSlot, titleRoom, o.titleLines ?? 2);
      const detail = o.detail ? fit(faces, o.detail, F.small, room, o.detailLines ?? 2) : null;
      let y = S.rowPad;
      if (eyebrow) y += 16;
      const titleY = y;
      y += title.lines.length * titleLeading;
      const detailY = y + (detail ? 1 : 0);
      if (detail) y += 1 + detail.lines.length * 16;
      const pillsY = y + 5;
      const pills: Pill[] = [];
      let pillX = textX;
      for (const pill of o.pills ?? []) {
        const label = fit(faces, pill.text, F.small, 160, 1).lines[0] ?? "";
        const w = Math.ceil(textWidth(faces, label, F.small)) + 14;
        if (pillX + w > width - S.pad || pills.length === 4) break;
        const colors = pillColors(pill.color);
        pills.push({ text: label, x: pillX, w, bg: colors.bg, fg: colors.fg });
        pillX += w + 5;
      }
      if (pills.length) y += 5 + 20;
      const h = Math.max(y + S.rowPad, size ? size + S.rowPad * 2 : 0, 40);
      return {
        kind: "cell", key: o.key, y: 0, h, id: o.run ? `row.${o.key}` : undefined, run: o.run,
        eyebrow: eyebrow?.lines[0] ?? "", eyebrowSlot: eyebrow?.slot ?? F.small,
        title: title.lines.join("\n"), titleSlot: title.slot, titleColor: T.text, titleY, titleLeading,
        detail: detail?.lines.join("\n") ?? "", detailSlot: detail?.slot ?? F.small, detailColor: T.muted, detailY,
        textX, trailing, trailingColor: T.muted, icon: o.icon ?? "", avatar: o.avatar ?? "", avatarSize: size, pills, pillsY, chevron, unread: o.unread === true,
      };
    },
    section(label, key = `section.${label}`) {
      const fitted = fit(faces, label, F.smallBold, width - S.pad * 2, 1);
      return { ...blank(key), h: 30, text: fitted.lines[0] ?? "", slot: fitted.slot, color: T.muted, leading: 16, top: 9, band: true };
    },
    text(value, style = "body", key = `text.${style}.${value.slice(0, 24)}`, options = {}) {
      const s = STYLES[style];
      const indent = options.indent ?? 0;
      const inset = style === "code" ? 10 : style === "quote" ? 12 : 0;
      const x = S.pad + indent + inset;
      const fitted = fit(faces, value, s.slot, width - x - S.pad - inset / 2);
      const out: Row[] = [];
      for (let at = 0, part = 0; at < Math.max(1, fitted.lines.length); at += LINES_PER_ROW, part++) {
        const lines = fitted.lines.slice(at, at + LINES_PER_ROW);
        const first = at === 0;
        const last = at + LINES_PER_ROW >= fitted.lines.length;
        const top = first ? s.top : 0;
        out.push({
          ...blank(`${key}.${part}`),
          h: top + lines.length * s.leading + (last ? s.bottom : 0),
          text: lines.join("\n"), slot: fitted.slot, color: s.color, leading: s.leading, x, top,
          block: style === "code", bar: style === "quote", rule: (style === "h1" || style === "h2") && last,
          bullet: first ? options.bullet ?? "" : "", bulletX: x - (options.bullet && options.bullet.length > 1 ? 24 : 14),
        });
      }
      return out;
    },
    strip(options, key, even = false) {
      const out: Row[] = [];
      let items: StripItem[] = [];
      let x = S.pad;
      const available = width - S.pad * 2;
      const evenW = even ? Math.floor((available - (options.length - 1) * 6) / options.length) : 0;
      const flush = () => {
        if (!items.length) return;
        const h = Math.max(...items.map((item) => item.h));
        for (const item of items) item.y = 7 + (h - item.h) / 2;
        out.push({ kind: "strip", key: `${key}.${out.length}`, y: 0, h: h + 14, items });
        items = [];
        x = S.pad;
      };
      options.forEach((o, index) => {
        const tone = o.tone ?? "button";
        const stat = tone === "stat";
        const label = fit(faces, o.label, stat ? F.small : F.smallBold, available - 40, 1).lines[0] ?? "";
        const natural = Math.ceil(textWidth(faces, label, stat ? F.small : F.smallBold)) + (o.icon ? 20 : 0) + (stat ? 2 : 22);
        const w = even ? evenW : natural;
        if (items.length === 4 || (items.length && x + w > S.pad + available)) flush();
        items.push({ id: o.id ?? `${key}.${index}`, label, x, w, h: ITEM_H[tone], y: 0, icon: o.icon ?? "", tone, run: o.run });
        x += w + (stat ? 14 : 6);
      });
      flush();
      return out;
    },
    message(o) {
      const out: Row[] = [api.space(36, `${o.key}.top`), ...api.text(o.title, "h3", `${o.key}.title`)];
      if (o.detail) out.push(...api.text(o.detail, "small", `${o.key}.detail`));
      if (o.action) out.push(...api.strip([{ id: `${o.key}.action`, label: o.action.label, tone: "button", run: o.action.run }], `${o.key}.actions`));
      return out;
    },
    space: (h, key) => ({ ...blank(key), h }),
  };
  return api;
}

export { ICONS };
