// SPDX-License-Identifier: GPL-3.0-or-later
// applets/kit/theme.ts — the design system's one palette and its metrics. A
// page never names a colour or a size of its own: it says what a thing is
// (T.muted, S.pad), so every applet made with the kit looks like one family.
export const T = {
  bg: "#0d1117",
  surface: "#161b22",
  raised: "#21262d",
  line: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  faint: "#6e7681",
  accent: "#58a6ff",
  accentFill: "#1f6feb",
  green: "#3fb950",
  greenFill: "#238636",
  red: "#f85149",
  redFill: "#da3633",
  purple: "#a371f7",
  yellow: "#d29922",
  wash: "#1f6feb40",
  addBg: "#12261e",
  delBg: "#2d1417",
  hunkBg: "#121d2f",
  shade: "#000000a0",
} as const;

/** Space and sizes, in logical px. */
export const S = {
  pad: 12,
  gap: 8,
  rowPad: 10,
  icon: 16,
  avatar: 32,
  barH: 36,
  tabH: 44,
  chipH: 26,
  buttonH: 32,
} as const;

/** Baked font slots by role (framework/compiler/tailwind.ts). */
export const F = {
  small: 0, // 12 px
  body: 1, // 14 px
  title: 8, // 14 px bold
  smallBold: 7,
  h3: 9, // 16 px bold
  h2: 10, // 18 px bold
  h1: 11, // 20 px bold
  mono: 16, // 12 px monospace
  richBody: 21,
  richBold: 22,
} as const;

/** A GitHub label's colour as a pill: its hue on a dark tint, its text lightened enough to read. */
export function pillColors(hex: string): { bg: string; fg: string } {
  const value = hex.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return { bg: `${T.raised}`, fg: T.muted };
  const c = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16));
  const luma = (0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!) / 255;
  const lift = luma < 0.55 ? (0.55 - luma) / (1 - luma) : 0;
  const fg = c.map((v) => Math.round(v + (255 - v) * lift).toString(16).padStart(2, "0")).join("");
  return { bg: `#${value}38`, fg: `#${fg}` };
}
