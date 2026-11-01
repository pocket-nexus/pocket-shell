// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/weather/views.tsx — the pages of Weather: the saved places as a
// grouped table (ui/table.tsx) with each place's current reading, a place's
// forecast (the conditions now, the next hours in a strip, seven days as
// rows) and the search that adds a place.
//
// A forecast page is a few dozen nodes laid out by arithmetic from the
// Forecast object: no slot pool, since seven days and a strip of hours fit
// in one screen's worth of rows. The sky glyphs are drawn from Views (a disc,
// a cloud, bars and dots), so no picture is baked for them.

import { createMemo, For, Show, type Accessor, type JSX } from "solid-js";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { Text, View } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { barButtonWidth, type NavButton } from "../ui/bar.tsx";
import { viewHeight, type LayerContext, type NavStack, type PageContent, type PageSpec } from "../ui/nav.tsx";
import { COMPACT, SCREEN_W, appletTouch } from "../ui/screen.ts";
import { tableContent, type Cell, type Section } from "../ui/table.tsx";
import { ellipsize, FONT, toAscii, wrap } from "../ui/text.ts";
import type { Press, Target } from "../ui/touch.ts";
import type { Day, Forecast, Hour, Place, Units } from "./api.ts";
import type { WeatherModel } from "./model.ts";
import { conditionText, skyOf, type Sky } from "./wmo.ts";

export interface WeatherEnv {
  model: WeatherModel;
  press: Press;
  keys: Accessor<boolean>;
  /** The keyboard's text with its caret while it is open, else null. */
  draft: Accessor<string | null>;
}

/** On a surface larger than the 3DS's, the bar keeps a Reload button. */
const RELOAD: NavButton = { id: "forecast.reload", label: "Reload", kind: "plain", run: () => {} };

// Sized to the surface by fitSurface(), which each page calls first.
let W = 320;
let VIEW_H = 204;

function fitSurface(): void {
  W = SCREEN_W;
  VIEW_H = viewHeight();
}

// ---- units and words ------------------------------------------------------------------

/** "21°" in the chosen units, from Celsius. */
export function degrees(celsius: number, units: Units): string {
  if (!Number.isFinite(celsius)) return "--";
  return `${Math.round(units === "f" ? (celsius * 9) / 5 + 32 : celsius)}°`;
}

/** "12 km/h" or "7 mph". */
export function windText(kmh: number, units: Units): string {
  if (!Number.isFinite(kmh)) return "--";
  return units === "f" ? `${Math.round(kmh / 1.609)} mph` : `${Math.round(kmh)} km/h`;
}

/** The hour of "YYYY-MM-DDTHH:MM" as "2PM"; "" for a time that is not one. */
export function hourLabel(time: string): string {
  const hour = Number(time.slice(11, 13));
  if (!Number.isFinite(hour) || time.length < 13) return "";
  if (hour === 0) return "12AM";
  if (hour === 12) return "12PM";
  return hour < 12 ? `${hour}AM` : `${hour - 12}PM`;
}

/** "HH:MM" of a "YYYY-MM-DDTHH:MM" time. */
export function clockLabel(time: string): string {
  return time.length >= 16 ? time.slice(11, 16) : "";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The weekday of a "YYYY-MM-DD" date; "" for a date that is not one. */
export function weekday(date: string): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

/** The hours from the current one on: the first whose time is not before
 *  the current reading's hour. */
export function hoursFrom(forecast: Forecast, count: number): Hour[] {
  const now = `${forecast.current.time.slice(0, 13)}:00`;
  let start = forecast.hourly.findIndex((hour) => hour.time >= now);
  if (start < 0) start = 0;
  return forecast.hourly.slice(start, start + count);
}

// ---- the sky glyphs -------------------------------------------------------------------

const SUN = "#f5b400";
const CLOUD = "#9aa4b1";
const CLOUD_DARK = "#5b6675";
const RAIN = "#3b82f6";
const SNOW = "#bfdbfe";

function Disc(props: { x: number; y: number; r: number; color: string }) {
  return <View class="absolute" style={{ insetL: props.x - props.r, insetT: props.y - props.r, width: props.r * 2, height: props.r * 2, radius: props.r, bgColor: props.color }} />;
}

/** A cloud: a rounded base with a disc bulging from its top. */
function Cloud(props: { x: number; y: number; w: number; color: string }) {
  const h = () => Math.round(props.w * 0.5);
  return (
    <>
      <View class="absolute" style={{ insetL: props.x - props.w / 2, insetT: props.y - h() / 2, width: props.w, height: h(), radius: Math.round(h() / 2), bgColor: props.color }} />
      <Disc x={props.x + props.w * 0.08} y={props.y - h() * 0.45} r={Math.round(props.w * 0.26)} color={props.color} />
    </>
  );
}

/** The glyph for a sky, drawn in a size x size box at (x, y). */
export function SkyGlyph(props: { sky: Sky; x: number; y: number; size: number }) {
  const s = () => props.size;
  const cx = () => props.x + s() / 2;
  const cy = () => props.y + s() / 2;
  const drops = (color: string, dots: boolean) => (
    <For each={[-0.22, 0, 0.22]}>
      {(dx) => dots
        ? <Disc x={cx() + dx * s()} y={cy() + s() * 0.36} r={Math.max(1, Math.round(s() * 0.07))} color={color} />
        : <View class="absolute" style={{ insetL: cx() + dx * s() - 1, insetT: cy() + s() * 0.28, width: 2, height: Math.round(s() * 0.18), radius: 1, bgColor: color }} />}
    </For>
  );
  return (
    <>
      <Show when={props.sky === "clear"}>
        <Disc x={cx()} y={cy()} r={Math.round(s() * 0.3)} color={SUN} />
      </Show>
      <Show when={props.sky === "partly"}>
        <Disc x={cx() - s() * 0.16} y={cy() - s() * 0.16} r={Math.round(s() * 0.22)} color={SUN} />
        <Cloud x={cx() + s() * 0.08} y={cy() + s() * 0.14} w={Math.round(s() * 0.62)} color={CLOUD} />
      </Show>
      <Show when={props.sky === "cloudy"}>
        <Cloud x={cx()} y={cy() + s() * 0.06} w={Math.round(s() * 0.72)} color={CLOUD} />
      </Show>
      <Show when={props.sky === "fog"}>
        <For each={[-0.18, 0, 0.18]}>
          {(dy) => <View class="absolute" style={{ insetL: cx() - s() * 0.32, insetT: cy() + dy * s() - 1, width: Math.round(s() * 0.64), height: 3, radius: 1, bgColor: CLOUD }} />}
        </For>
      </Show>
      <Show when={props.sky === "drizzle" || props.sky === "rain"}>
        <Cloud x={cx()} y={cy() - s() * 0.1} w={Math.round(s() * 0.64)} color={props.sky === "rain" ? CLOUD_DARK : CLOUD} />
        {drops(RAIN, false)}
      </Show>
      <Show when={props.sky === "sleet"}>
        <Cloud x={cx()} y={cy() - s() * 0.1} w={Math.round(s() * 0.64)} color={CLOUD_DARK} />
        {drops(RAIN, false)}
        <Disc x={cx()} y={cy() + s() * 0.4} r={Math.max(1, Math.round(s() * 0.07))} color={SNOW} />
      </Show>
      <Show when={props.sky === "snow"}>
        <Cloud x={cx()} y={cy() - s() * 0.1} w={Math.round(s() * 0.64)} color={CLOUD} />
        {drops(SNOW, true)}
      </Show>
      <Show when={props.sky === "thunder"}>
        <Cloud x={cx()} y={cy() - s() * 0.12} w={Math.round(s() * 0.66)} color={CLOUD_DARK} />
        <View class="absolute" style={{ insetL: cx() - 2, insetT: cy() + s() * 0.14, width: 4, height: Math.round(s() * 0.3), bgColor: SUN }} />
        <View class="absolute" style={{ insetL: cx() - 5, insetT: cy() + s() * 0.26, width: 4, height: Math.round(s() * 0.18), bgColor: SUN }} />
      </Show>
    </>
  );
}

// ---- shared pieces --------------------------------------------------------------------

function Centered(props: { title: string; detail: string; spinner?: boolean; button?: { id: string; label: string }; press: Press }) {
  const lines = () => wrap(props.detail, FONT.xs, 260, 4);
  return (
    <>
      <Show when={props.spinner}>
        <View class="absolute top-[40]" style={{ insetL: W / 2 - 11 }}>
          <ClassicSpinner size={22} color={"#8a9099"} />
        </View>
      </Show>
      <Text class="absolute left-0 top-[74] text-base text-[#4c566c] font-bold text-center" style={{ width: W }}>{props.title}</Text>
      <For each={lines()}>
        {(line, index) => <Text class="absolute w-[260] text-xs text-[#6d7584] text-center" style={{ insetL: (W - 260) / 2, insetT: 98 + index() * 15 }}>{line}</Text>}
      </For>
      <Show when={props.button}>
        {(button) => (
          <>
            <View
              class={props.press.is(button().id)
                ? "absolute top-[160] w-[120] h-[30] rounded-[6] border border-[#6f7680] bg-gradient-to-b from-[#9aa1ab] to-[#bfc5cc]"
                : "absolute top-[160] w-[120] h-[30] rounded-[6] border border-[#9aa1aa] bg-gradient-to-b from-[#ffffff] to-[#dde1e6]"}
              style={{ insetL: (W - 120) / 2 }}
            />
            <Text class="absolute top-[167] w-[120] text-sm text-[#1f5fbf] font-bold text-center" style={{ insetL: (W - 120) / 2 }}>{button().label}</Text>
          </>
        )}
      </Show>
    </>
  );
}

/** "Tokyo, Japan" or "Austin, Texas, United States". */
export function placeDetail(place: Place): string {
  return toAscii([place.region, place.country].filter((part) => part).join(", "));
}

// ---- the places page ------------------------------------------------------------------

export function placesPage(env: WeatherEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press } = env;
  const open = (place: Place) => {
    model.open(place);
    stack.push("forecast");
  };
  const reading = (place: Place): string => {
    const state = model.forecast(place.id);
    if (!state) return "";
    if (state.forecast) return `${degrees(state.forecast.current.temperature, model.units())}  ${conditionText(state.forecast.current.code)}`;
    return state.status === "error" ? "--" : "...";
  };
  const sections = createMemo((): Section[] => {
    const out: Section[] = [];
    const places = model.places();
    const editing = model.editing();
    if (places.length) {
      out.push({
        header: "Places",
        cells: places.map((place): Cell => ({
          id: `place.${place.id}`,
          label: toAscii(place.name),
          detail: placeDetail(place),
          value: reading(place),
          ...(editing
            ? { button: { id: `remove.${place.id}`, label: "Remove", tone: "red", run: () => model.remove(place.id) } }
            : { accessory: "chevron" as const, run: () => open(place) }),
        })),
      });
    }
    const storeError = model.storeError();
    out.push({
      cells: [{ id: "places.add", label: "Add a Place...", tone: "action", run: () => stack.push("search") }],
      footer: model.store() === "loading"
        ? "Reading the saved places."
        : model.store() === "error"
          ? `The saved places could not be read: ${storeError?.detail ?? "the store did not answer"}.`
          : storeError
            ? `A change could not be saved: ${storeError.detail}`
            : places.length
              ? ""
              : "A place is found by its name and kept on this device.",
    });
    out.push({
      header: "Units",
      cells: [{ id: "places.units", label: "Temperature", value: model.units() === "f" ? "Fahrenheit" : "Celsius", run: () => model.toggleUnits() }],
    });
    return out;
  });
  const table = tableContent({ sections, width: W, press, focus: layer.focus, keys: env.keys });
  const content: PageContent = {
    view: table.view,
    height: table.height,
    focusOrder: table.focusOrder,
    targets: table.targets,
    span: table.span,
    activate: table.activate,
  };
  const editButton = (): NavButton | null =>
    model.places().length === 0 ? null : model.editing()
      ? { id: "places.done", label: "Done", kind: "done", run: () => model.setEditing(false) }
      : { id: "places.edit", label: "Edit", kind: "plain", run: () => model.setEditing(true) };
  return {
    title: () => "Weather",
    backLabel: "Places",
    right: editButton,
    content,
    legend: () => [
      { button: "triangle", label: "Reload" },
      { button: "square", label: "Add" },
      ...(model.places().length ? [{ button: "start" as const, label: model.editing() ? "Done" : "Edit" }] : []),
    ],
    key(pressed) {
      if (pressed & BTN.TRIANGLE) model.refresh();
      else if (pressed & BTN.SQUARE) stack.push("search");
      else if (pressed & BTN.START && model.places().length) model.setEditing(!model.editing());
      else return false;
      return true;
    },
  };
}

// ---- the forecast page ----------------------------------------------------------------

const CURRENT_H = 118;
const STRIP_H = 84;
const DAY_H = 34;
const SECTION_GAP = 10;
const HEADING_H = 22;

interface ForecastLayout {
  hours: Hour[];
  days: Day[];
  columnW: number;
  stripY: number;
  daysY: number;
  height: number;
}

function layoutForecast(forecast: Forecast): ForecastLayout {
  const columnW = Math.max(38, Math.floor((W - 16) / (COMPACT ? 8 : 12)));
  const count = Math.floor((W - 16) / columnW);
  const hours = hoursFrom(forecast, count);
  const days = forecast.daily.slice(0, 7);
  const stripY = CURRENT_H + SECTION_GAP;
  const daysY = stripY + HEADING_H + STRIP_H + SECTION_GAP;
  return { hours, days, columnW, stripY, daysY, height: daysY + HEADING_H + days.length * DAY_H + 12 };
}

function Current(props: { forecast: Forecast; units: Units; place: Place }) {
  const current = () => props.forecast.current;
  const details = () => {
    const today = props.forecast.daily[0];
    const parts = [`Feels like ${degrees(current().apparent, props.units)}`, `Wind ${windText(current().wind, props.units)}`];
    if (Number.isFinite(current().humidity)) parts.push(`Humidity ${Math.round(current().humidity)}%`);
    if (today?.sunrise) parts.push(`Sunrise ${clockLabel(today.sunrise)}`);
    if (today?.sunset) parts.push(`Sunset ${clockLabel(today.sunset)}`);
    return wrap(parts.join("   "), FONT.xs, W - 24, 2).join("\n");
  };
  const today = () => props.forecast.daily[0];
  return (
    <>
      <View class="absolute left-0 top-0 bg-gradient-to-b from-[#3b82f6] to-[#60a5fa]" style={{ width: W, height: CURRENT_H }} />
      <Text class="absolute left-[12] top-[8] text-sm text-[#dbeafe] font-bold" style={{ width: W - 24 }}>{placeDetail(props.place) || toAscii(props.place.name)}</Text>
      <Text class="absolute left-[12] top-[22] text-4xl text-white font-bold">{degrees(current().temperature, props.units)}</Text>
      <SkyGlyph sky={skyOf(current().code)} x={W - 12 - 56} y={14} size={56} />
      <Text class="absolute top-[62] text-sm text-white font-bold" style={{ insetL: 12, width: W - 24 }}>{conditionText(current().code)}</Text>
      <Show when={today()}>
        {(day) => <Text class="absolute top-[62] text-sm text-[#dbeafe] text-right" style={{ insetL: W - 12 - 120, width: 120 }}>{`H ${degrees(day().max, props.units)}  L ${degrees(day().min, props.units)}`}</Text>}
      </Show>
      <Text class="absolute left-[12] top-[82] text-xs text-[#dbeafe] leading-[15]">{details()}</Text>
    </>
  );
}

function HourStrip(props: { layout: ForecastLayout; units: Units }) {
  return (
    <>
      <Text class="absolute left-[12] text-xs text-[#4c566c] font-bold" style={{ insetT: props.layout.stripY + 4 }}>NEXT HOURS</Text>
      <View class="absolute left-[8] rounded-[8] border border-[#d6dbe2] bg-white" style={{ insetT: props.layout.stripY + HEADING_H, width: W - 16, height: STRIP_H }} />
      <For each={props.layout.hours}>
        {(hour, index) => {
          const x = () => 8 + index() * props.layout.columnW;
          const top = () => props.layout.stripY + HEADING_H;
          return (
            <>
              <Text class="absolute text-2xs text-[#6d7584] text-center" style={{ insetL: x(), insetT: top() + 7, width: props.layout.columnW }}>{index() === 0 ? "Now" : hourLabel(hour.time)}</Text>
              <SkyGlyph sky={skyOf(hour.code)} x={x() + (props.layout.columnW - 26) / 2} y={top() + 22} size={26} />
              <Text class="absolute text-sm text-[#111111] font-bold text-center" style={{ insetL: x(), insetT: top() + 50, width: props.layout.columnW }}>{degrees(hour.temperature, props.units)}</Text>
              <Show when={Number.isFinite(hour.precipitation) && hour.precipitation >= 20}>
                <Text class="absolute text-2xs text-[#2563eb] text-center" style={{ insetL: x(), insetT: top() + 68, width: props.layout.columnW }}>{`${Math.round(hour.precipitation)}%`}</Text>
              </Show>
            </>
          );
        }}
      </For>
    </>
  );
}

function DayRows(props: { layout: ForecastLayout; units: Units }) {
  const rowsY = () => props.layout.daysY + HEADING_H;
  return (
    <>
      <Text class="absolute left-[12] text-xs text-[#4c566c] font-bold" style={{ insetT: props.layout.daysY + 4 }}>{`${props.layout.days.length} DAYS`}</Text>
      <View class="absolute left-[8] rounded-[8] border border-[#d6dbe2] bg-white" style={{ insetT: rowsY(), width: W - 16, height: props.layout.days.length * DAY_H }} />
      <For each={props.layout.days}>
        {(day, index) => {
          const y = () => rowsY() + index() * DAY_H;
          return (
            <>
              <Show when={index() > 0}>
                <View class="absolute left-[20] h-[1] bg-[#e6e9ee]" style={{ insetT: y(), width: W - 40 }} />
              </Show>
              <Text class="absolute left-[20] text-sm text-[#111111] font-bold" style={{ insetT: y() + 9, width: 60 }}>{index() === 0 ? "Today" : weekday(day.date)}</Text>
              <SkyGlyph sky={skyOf(day.code)} x={84} y={y() + 4} size={26} />
              <Text class="absolute text-xs text-[#6d7584]" style={{ insetL: 118, insetT: y() + 10, width: W - 118 - 100 }}>{ellipsize(conditionText(day.code), FONT.xs, W - 118 - 100)}</Text>
              <Text class="absolute text-sm text-[#111111] text-right" style={{ insetL: W - 20 - 90, insetT: y() + 9, width: 90 }}>{`${degrees(day.max, props.units)}  ${degrees(day.min, props.units)}`}</Text>
            </>
          );
        }}
      </For>
    </>
  );
}

/** The bar's Reload button on a surface larger than the 3DS's. */
function reloadButton(run: () => void): (() => NavButton) | undefined {
  return COMPACT ? undefined : () => ({ ...RELOAD, run });
}

export function forecastPage(env: WeatherEnv, _stack: NavStack, _layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press } = env;
  const place = () => model.current();
  const state = () => {
    const current = place();
    return current ? model.forecast(current.id) : undefined;
  };
  const forecast = () => state()?.forecast ?? null;
  const layout = createMemo(() => {
    const current = forecast();
    return current ? layoutForecast(current) : null;
  });
  const reload = () => {
    const current = place();
    if (current) model.load(current, true);
  };
  const content: PageContent = {
    view: () => (
      <>
        <Show when={forecast() && place()}>
          <Current forecast={forecast()!} units={model.units()} place={place()!} />
          <HourStrip layout={layout()!} units={model.units()} />
          <DayRows layout={layout()!} units={model.units()} />
        </Show>
        <Show when={!forecast()}>
          {state()?.status === "error"
            ? <Centered title={state()!.error!.title} detail={state()!.error!.detail} button={{ id: "forecast.retry", label: "Try Again" }} press={press} />
            : <Centered title="Loading" detail="Asking Open-Meteo for the forecast." spinner press={press} />}
        </Show>
      </>
    ),
    height: () => layout()?.height ?? VIEW_H,
    focusOrder: () => [],
    targets(top, offset) {
      if (state()?.status === "error" && !forecast()) return [{ id: "forecast.retry", x: (W - 120) / 2, y: top + 160 - offset, w: 120, h: 30, run: reload }];
      return [];
    },
    span: () => null,
    activate(id) {
      if (id === "forecast.retry") reload();
    },
  };
  return {
    title: () => toAscii(place()?.name ?? "Forecast"),
    backLabel: "Forecast",
    bare: "white",
    right: reloadButton(reload),
    content,
    activateLabel: () => "",
    legend: () => [{ button: "triangle", label: "Reload" }],
    key(pressed) {
      if (pressed & BTN.TRIANGLE) reload();
      else if (pressed & BTN.CIRCLE && state()?.status === "error" && !forecast()) reload();
      else return false;
      return true;
    },
  };
}

// ---- the search page ------------------------------------------------------------------

const FIELD_H = 40;
const RESULT_H = 48;

export function searchPage(env: WeatherEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press } = env;
  const results = () => model.search().results;
  const listed = () => model.search().status === "ready" && results().length > 0;
  const lit = (key: string) => key === press.id() || (env.keys() && key === layer.focus());
  const choose = (place: Place) => {
    model.add(place);
    model.clearSearch();
    stack.pop();
  };
  const fieldText = () => {
    const typing = env.draft();
    const text = typing ?? model.search().query;
    return text ? ellipsize(toAscii(text), FONT.sm, W - 40) : typing !== null ? "|" : "City or town";
  };
  const rowY = (index: number) => FIELD_H + index * RESULT_H;
  const content: PageContent = {
    view: () => (
      <>
        <View class={press.is("search.field") ? "absolute left-[8] top-[6] rounded-[14] border border-[#8a9099] bg-[#e4e7eb]" : "absolute left-[8] top-[6] rounded-[14] border border-[#8a9099] bg-white"} style={{ width: W - 16, height: 28 }} />
        <Text class={model.search().query || env.draft() !== null ? "absolute left-[22] top-[12] text-sm text-[#111111]" : "absolute left-[22] top-[12] text-sm text-[#8a9099]"} style={{ width: W - 40 }}>{fieldText()}</Text>
        <For each={results()}>
          {(place, index) => (
            <View class="absolute left-0 h-[48]" style={{ insetT: rowY(index()), width: W }}>
              <View class={lit(`result.${place.id}`) ? "absolute inset-0 bg-gradient-to-b from-[#5a8de0] to-[#2f6ad0]" : "hidden"} />
              <View class="absolute left-[12] right-0 bottom-0 h-[1] bg-[#e0e0e0]" />
              <Text class={lit(`result.${place.id}`) ? "absolute left-[12] top-[8] text-sm text-white font-bold" : "absolute left-[12] top-[8] text-sm text-[#111111] font-bold"} style={{ width: W - 24 }}>{ellipsize(toAscii(place.name), FONT.smBold, W - 24)}</Text>
              <Text class={lit(`result.${place.id}`) ? "absolute left-[12] top-[27] text-xs text-[#d6e6ff]" : "absolute left-[12] top-[27] text-xs text-[#8a9099]"} style={{ width: W - 24 }}>{ellipsize(placeDetail(place), FONT.xs, W - 24)}</Text>
            </View>
          )}
        </For>
        <Show when={!listed()}>
          <View class="absolute left-0" style={{ insetT: FIELD_H, width: W, height: VIEW_H - FIELD_H }}>
            {model.search().status === "error"
              ? <Centered title={model.search().error!.title} detail={model.search().error!.detail} press={press} />
              : model.search().status === "loading"
                ? <Centered title="Searching" detail={`Asking Open-Meteo for "${toAscii(model.search().query)}".`} spinner press={press} />
                : model.search().status === "ready"
                  ? <Centered title="No Places" detail={`Nothing matched "${toAscii(model.search().query)}".`} press={press} />
                  : <Centered title="Find a Place" detail={appletTouch() ? "Tap the field and type a city." : "Press the square button and type a city."} press={press} />}
          </View>
        </Show>
      </>
    ),
    height: () => (listed() ? FIELD_H + results().length * RESULT_H + 8 : VIEW_H),
    focusOrder: () => ["search.field", ...results().map((place) => `result.${place.id}`)],
    targets(top, offset, bottom) {
      const out: Target[] = [{ id: "search.field", x: 8, y: top + 2 - offset, w: W - 16, h: 36, run: () => model.editQuery() }];
      for (const [index, place] of results().entries()) {
        const y = top + rowY(index) - offset;
        if (y + RESULT_H <= top || y >= bottom) continue;
        out.push({ id: `result.${place.id}`, x: 0, y, w: W, h: RESULT_H, run: () => choose(place) });
      }
      return out;
    },
    span(id) {
      if (id === "search.field") return [0, FIELD_H];
      const index = results().findIndex((place) => `result.${place.id}` === id);
      return index < 0 ? null : [rowY(index), rowY(index) + RESULT_H];
    },
    activate(id) {
      if (id === "search.field") return model.editQuery();
      const place = results().find((candidate) => `result.${candidate.id}` === id);
      if (place) choose(place);
    },
  };
  return {
    title: () => "Add a Place",
    backLabel: "Search",
    bare: "white",
    content,
    activateLabel: () => "Add",
    legend: () => [{ button: "square", label: "Type" }],
    key(pressed) {
      if (pressed & BTN.SQUARE) model.editQuery();
      else return false;
      return true;
    },
  };
}

export const FORECAST_CURRENT_H = CURRENT_H;
export type { JSX };
