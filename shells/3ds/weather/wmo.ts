// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/weather/wmo.ts — the WMO 4677 weather codes Open-Meteo reports, as
// the words a forecast shows and the glyph drawn for them (views.tsx
// SkyGlyph). A code outside the table reads "Unknown" and draws a cloud.

export type Sky = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "sleet" | "snow" | "thunder";

const CODES: Record<number, readonly [text: string, sky: Sky]> = {
  0: ["Clear", "clear"],
  1: ["Mainly clear", "clear"],
  2: ["Partly cloudy", "partly"],
  3: ["Overcast", "cloudy"],
  45: ["Fog", "fog"],
  48: ["Rime fog", "fog"],
  51: ["Light drizzle", "drizzle"],
  53: ["Drizzle", "drizzle"],
  55: ["Heavy drizzle", "drizzle"],
  56: ["Freezing drizzle", "sleet"],
  57: ["Freezing drizzle", "sleet"],
  61: ["Light rain", "rain"],
  63: ["Rain", "rain"],
  65: ["Heavy rain", "rain"],
  66: ["Freezing rain", "sleet"],
  67: ["Freezing rain", "sleet"],
  71: ["Light snow", "snow"],
  73: ["Snow", "snow"],
  75: ["Heavy snow", "snow"],
  77: ["Snow grains", "snow"],
  80: ["Light showers", "rain"],
  81: ["Showers", "rain"],
  82: ["Heavy showers", "rain"],
  85: ["Snow showers", "snow"],
  86: ["Heavy snow showers", "snow"],
  95: ["Thunderstorm", "thunder"],
  96: ["Thunderstorm, hail", "thunder"],
  99: ["Thunderstorm, hail", "thunder"],
};

/** The words for a weather code. */
export function conditionText(code: number): string {
  return CODES[code]?.[0] ?? "Unknown";
}

/** The glyph for a weather code. */
export function skyOf(code: number): Sky {
  return CODES[code]?.[1] ?? "cloudy";
}
