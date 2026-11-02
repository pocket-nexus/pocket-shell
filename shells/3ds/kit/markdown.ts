// SPDX-License-Identifier: GPL-3.0-or-later
// applets/kit/markdown.ts — GitHub-flavoured markdown as rows: headings, lists
// and task lists, quotes, fenced code, rules, tables as aligned code and images
// as a line with their alt text. Inline marks are taken out: one text node has
// one face.
import type { Row, Rows } from "./rows.ts";

/** `text` without inline marks: [a](b) is a, `c` is c, **d** is d. */
export function inline(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => (alt ? `[${alt}]` : ""))
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (_, alt: string) => (alt ? `[${alt}]` : ""))
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[\s(])[*_](?=\S)(.+?)(?<=\S)[*_](?=$|[\s).,:;!?])/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .trim();
}

export function markdownRows(rows: Rows, source: string, key: string): Row[] {
  const out: Row[] = [];
  const lines = source.replace(/\r/g, "").replace(/<!--[\s\S]*?-->/g, "").split("\n");
  let index = 0;
  let serial = 0;
  const id = () => `${key}.${serial++}`;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index++;
      continue;
    }
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index]!.trim().startsWith(fence[1]!)) code.push(lines[index++]!);
      index++;
      out.push(...rows.text(code.join("\n") || " ", "code", id()));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(...rows.text(inline(heading[2]!), level === 1 ? "h1" : level === 2 ? "h2" : "h3", id()));
      index++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(...rows.text(" ", "small", id()));
      index++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index]!)) quote.push(lines[index++]!.replace(/^\s*>\s?/, ""));
      out.push(...rows.text(inline(quote.join(" ")) || " ", "quote", id()));
      continue;
    }
    if (/\|/.test(line) && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[index + 1] ?? "")) {
      const table: string[][] = [];
      while (index < lines.length && lines[index]!.includes("|")) {
        if (!/^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[index]!)) table.push(lines[index]!.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => inline(cell)));
        index++;
      }
      const widths = table[0]!.map((_, column) => Math.max(...table.map((row) => (row[column] ?? "").length)));
      out.push(...rows.text(table.map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd()).join("\n"), "code", id()));
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (item) {
      const depth = Math.min(3, Math.floor(item[1]!.length / 2));
      const words = [item[4]!];
      index++;
      while (index < lines.length && /^\s{2,}\S/.test(lines[index]!) && !/^\s*([-*+]|\d+[.)])\s/.test(lines[index]!)) words.push(lines[index++]!.trim());
      const box = item[3]?.trim().toLowerCase();
      const bullet = box === "[x]" ? "[x]" : box ? "[ ]" : /\d/.test(item[2]!) ? item[2]! : "\u2022";
      out.push(...rows.text(inline(words.join(" ")) || " ", "li", id(), { indent: (box || /\d/.test(item[2]!) ? 24 : 16) + depth * 14, bullet }));
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() !== "" && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[index]!)) paragraph.push(lines[index++]!.trim());
    if (!paragraph.length) paragraph.push(lines[index++]!.trim());
    const words = inline(paragraph.join(" "));
    if (words) out.push(...rows.text(words, "body", id()));
  }
  return out;
}
