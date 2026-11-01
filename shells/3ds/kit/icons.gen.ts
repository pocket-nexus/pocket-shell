#!/usr/bin/env bun
// bun applets/kit/icons.gen.ts — writes applets/ui/art/kit/*.svg and
// applets/kit/icons.ts. Icons are geometry on a 16 px grid, in the colours the
// table asks for, so a new icon is one entry here and no hand-drawn file. The
// SVG baker fills paths and has no arcs or strokes: circles are beziers, lines
// are quads.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { T } from "./theme.ts";

const K = 0.5523;
const n = (v: number) => +v.toFixed(3);
const disc = (x: number, y: number, r: number) =>
  `M${n(x + r)} ${n(y)}C${n(x + r)} ${n(y + K * r)} ${n(x + K * r)} ${n(y + r)} ${n(x)} ${n(y + r)}C${n(x - K * r)} ${n(y + r)} ${n(x - r)} ${n(y + K * r)} ${n(x - r)} ${n(y)}C${n(x - r)} ${n(y - K * r)} ${n(x - K * r)} ${n(y - r)} ${n(x)} ${n(y - r)}C${n(x + K * r)} ${n(y - r)} ${n(x + r)} ${n(y - K * r)} ${n(x + r)} ${n(y)}Z`;
const ring = (x: number, y: number, r: number, t = 1.5) => disc(x, y, r) + disc(x, y, r - t);
/** A line of width `w` with square ends. */
function line(x0: number, y0: number, x1: number, y1: number, w = 1.5): string {
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const ax = (-dy / l) * (w / 2), ay = (dx / l) * (w / 2);
  return `M${n(x0 + ax)} ${n(y0 + ay)}L${n(x1 + ax)} ${n(y1 + ay)}L${n(x1 - ax)} ${n(y1 - ay)}L${n(x0 - ax)} ${n(y0 - ay)}Z`;
}
const poly = (...p: number[]) => `M${p.slice(0, 2).join(" ")}L${p.slice(2).reduce<string[]>((o, v, i) => (i % 2 ? [...o.slice(0, -1), `${o[o.length - 1]} ${v}`] : [...o, String(v)]), []).join("L")}Z`;
function star(fill: boolean): string[] {
  const pts = (r0: number, r1: number) => Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? r1 : r0;
    return [n(8 + r * Math.cos(a)), n(8.3 + r * Math.sin(a))];
  }).flat();
  return fill ? [poly(...pts(7.4, 3.1))] : [poly(...pts(7.4, 3.1)) + poly(...pts(5.2, 2.1))];
}
const prBase = [ring(4, 3.2, 2), ring(4, 12.8, 2), line(4, 5.2, 4, 10.8)];

/** name -> its shapes (each path filled even-odd) and the colours it comes in. */
const ICONS: Record<string, { shapes: string[]; colors: (keyof typeof T)[] }> = {
  "issue-open": { shapes: [ring(8, 8, 7), disc(8, 8, 1.8)], colors: ["green", "muted"] },
  "issue-closed": { shapes: [ring(8, 8, 7), line(5, 8.2, 7.2, 10.4), line(6.65, 10.4, 11.2, 5.8)], colors: ["purple", "muted"] },
  "issue-skip": { shapes: [ring(8, 8, 7), line(5, 11, 11, 5)], colors: ["muted"] },
  "pr-open": { shapes: [...prBase, ring(12, 12.8, 2), line(12, 10.8, 12, 5), line(12.75, 4.25, 8.5, 4.25), poly(9.8, 1.6, 9.8, 6.9, 7, 4.25)], colors: ["green", "muted"] },
  "pr-merged": { shapes: [...prBase, ring(12, 9, 2), line(4.4, 5, 10.2, 8.2)], colors: ["purple"] },
  "pr-closed": { shapes: [...prBase, ring(12, 12.8, 2), line(12, 10.8, 12, 8), line(9.8, 1.8, 14.2, 6.2), line(14.2, 1.8, 9.8, 6.2)], colors: ["red"] },
  "pr-draft": { shapes: [...prBase, ring(12, 12.8, 2), disc(12, 8.5, 0.9), disc(12, 4.5, 0.9)], colors: ["muted"] },
  repo: { shapes: ["M3 1.2H13V14.8H5.2C3.9 14.8 3 13.9 3 12.7ZM4.5 2.7V10.1C4.7 10 5 10 5.2 10H11.5V2.7ZM5.2 11.5C4.8 11.5 4.5 11.9 4.5 12.3C4.5 12.8 4.8 13.3 5.2 13.3H11.5V11.5Z"], colors: ["muted", "accent"] },
  star: { shapes: star(false), colors: ["muted", "text"] },
  "star-fill": { shapes: star(true), colors: ["yellow"] },
  fork: { shapes: [ring(4, 3.2, 2), ring(12, 3.2, 2), ring(8, 12.8, 2), line(4, 5.2, 4, 7.2), line(12, 5.2, 12, 7.2), line(3.25, 7.2, 12.75, 7.2), line(8, 7.2, 8, 10.8)], colors: ["muted"] },
  commit: { shapes: [ring(8, 8, 3.2), line(0.5, 8, 4.8, 8), line(11.2, 8, 15.5, 8)], colors: ["muted", "green"] },
  branch: { shapes: [ring(4, 3.2, 2), ring(4, 12.8, 2), ring(12, 4.2, 2), line(4, 5.2, 4, 10.8), line(4.3, 9.6, 10.6, 6)], colors: ["muted", "accent"] },
  tag: { shapes: ["M1.5 1.5H8L14.5 8L8 14.5L1.5 8ZM3 3V7.4L8 12.4L12.4 8L7.4 3Z", disc(5.4, 5.4, 1.1)], colors: ["muted", "green"] },
  check: { shapes: [line(2.8, 8.4, 6.4, 12), line(5.85, 12, 13.4, 4.2)], colors: ["green", "text"] },
  "check-circle": { shapes: [ring(8, 8, 7), line(5, 8.2, 7.2, 10.4), line(6.65, 10.4, 11.2, 5.8)], colors: ["green"] },
  "x-circle": { shapes: [ring(8, 8, 7), line(5.4, 5.4, 10.6, 10.6), line(10.6, 5.4, 5.4, 10.6)], colors: ["red"] },
  "dot-run": { shapes: [ring(8, 8, 7), disc(8, 8, 3)], colors: ["yellow"] },
  clock: { shapes: [ring(8, 8, 7), line(8, 4, 8, 8.6), line(7.5, 8.2, 10.8, 10)], colors: ["muted"] },
  bell: { shapes: ["M8 1.2C10.8 1.2 12.5 3.2 12.5 6V9.2L14.2 12H1.8L3.5 9.2V6C3.5 3.2 5.2 1.2 8 1.2ZM8 2.7C6 2.7 5 4.1 5 6V9.6L4.5 10.5H11.5L11 9.6V6C11 4.1 10 2.7 8 2.7Z", disc(8, 13.6, 1.5)], colors: ["muted", "accent"] },
  search: { shapes: [ring(6.8, 6.8, 5.2), line(10.5, 10.5, 14.6, 14.6, 1.8)], colors: ["muted", "accent", "text"] },
  file: { shapes: ["M3 1H9.8L13 4.2V15H3ZM4.5 2.5V13.5H11.5V5.2H8.8V2.5Z"], colors: ["muted"] },
  folder: { shapes: ["M1.2 2.5H6.2L7.7 4.2H14.8V13.5H1.2Z"], colors: ["accent"] },
  play: { shapes: [ring(8, 8, 7), poly(6.3, 4.8, 11.3, 8, 6.3, 11.2)], colors: ["muted", "accent"] },
  gear: { shapes: [ring(8, 8, 5, 2.2), ...[0, 45, 90, 135].map((a) => { const c = Math.cos((a * Math.PI) / 180), s = Math.sin((a * Math.PI) / 180); return line(8 - 7.2 * c, 8 - 7.2 * s, 8 + 7.2 * c, 8 + 7.2 * s, 2) ; }), disc(8, 8, 3.6) + disc(8, 8, 2)], colors: ["muted"] },
  comment: { shapes: ["M1.2 2H14.8V11.5H7.5L4 14.8V11.5H1.2ZM2.7 3.5V10H5.5V11.4L7 10H13.3V3.5Z"], colors: ["muted"] },
  person: { shapes: [ring(8, 4.8, 3.3), "M1.8 14.8C1.8 11.3 4.5 9.2 8 9.2C11.5 9.2 14.2 11.3 14.2 14.8H12.7C12.7 12.1 10.7 10.7 8 10.7C5.3 10.7 3.3 12.1 3.3 14.8Z"], colors: ["muted", "accent"] },
  code: { shapes: [line(5.6, 3.4, 1.4, 8), line(1.4, 8, 5.6, 12.6), line(10.4, 3.4, 14.6, 8), line(14.6, 8, 10.4, 12.6)], colors: ["muted"] },
  lock: { shapes: ["M3 7H13V15H3ZM4.5 8.5V13.5H11.5V8.5Z", "M4.6 7V5C4.6 2.8 6 1.2 8 1.2C10 1.2 11.4 2.8 11.4 5V7H9.9V5C9.9 3.6 9.2 2.7 8 2.7C6.8 2.7 6.1 3.6 6.1 5V7Z"], colors: ["muted"] },
  eye: { shapes: ["M8 3C11.2 3 13.8 5.2 15.2 8C13.8 10.8 11.2 13 8 13C4.8 13 2.2 10.8 0.8 8C2.2 5.2 4.8 3 8 3ZM8 4.5C5.7 4.5 3.7 6 2.5 8C3.7 10 5.7 11.5 8 11.5C10.3 11.5 12.3 10 13.5 8C12.3 6 10.3 4.5 8 4.5Z", disc(8, 8, 2.1)], colors: ["muted", "text"] },
  plus: { shapes: [line(8, 2, 8, 14, 1.8), line(2, 8, 14, 8, 1.8)], colors: ["accent", "text"] },
  chevron: { shapes: [line(5.6, 3.2, 10.6, 8.5), line(10.6, 7.5, 5.6, 12.8)], colors: ["faint"] },
  back: { shapes: [line(10.6, 2.6, 4.8, 8.5), line(4.8, 7.5, 10.6, 13.4)], colors: ["accent"] },
  mail: { shapes: ["M1.2 3H14.8V13H1.2ZM2.7 5.2V11.5H13.3V5.2L8 9ZM3.6 4.5L8 7.2L12.4 4.5Z"], colors: ["muted"] },
  gist: { shapes: [line(5.6, 3.4, 1.4, 8), line(1.4, 8, 5.6, 12.6), line(10.4, 3.4, 14.6, 8), line(14.6, 8, 10.4, 12.6), line(9, 2.6, 7, 13.4)], colors: ["muted", "accent"] },
};

const root = resolve(import.meta.dir, "..");
const art = join(root, "ui", "art", "kit");
mkdirSync(art, { recursive: true });
for (const file of readdirSync(art)) rmSync(join(art, file));
const rows: string[] = [];
for (const [name, icon] of Object.entries(ICONS)) {
  const colors: string[] = [];
  for (const color of icon.colors) {
    const paths = icon.shapes.map((d) => `<path fill="${T[color]}" fill-rule="evenodd" d="${d}"/>`).join("");
    writeFileSync(join(art, `${name}-${color}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${paths}</svg>\n`);
    colors.push(`${color}: "art/kit/${name}-${color}.svg"`);
  }
  rows.push(`  ${JSON.stringify(name)}: { ${colors.join(", ")} },`);
}
writeFileSync(join(root, "kit", "icons.ts"), `// SPDX-License-Identifier: GPL-3.0-or-later
// Written by icons.gen.ts. The paths are whole literals because the compiler
// bakes the images a bundle names.
export const ICONS = {
${rows.join("\n")}
} as const;

export type IconName = keyof typeof ICONS;
/** An icon in one of the colours it comes in: \`ICONS["pr-open"].green\`. */
export type IconSrc = { [K in IconName]: (typeof ICONS)[K][keyof (typeof ICONS)[K]] }[IconName];
`);
console.log(`${rows.length} icons, ${readdirSync(art).length} files`);
