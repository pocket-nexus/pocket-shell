// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/maps/views.tsx — the pages of Maps: the map under the bar, and the
// list of places a search found.
//
// The map is a fixed pool of tile slots, COLS x ROWS of them (one more each
// way than the window holds in 256 px tiles), each a flat placeholder with
// an Image over it. A view change places every slot by arithmetic (jump):
// the tile's world px less the view's top-left corner, and binds the slot's
// Image to the tile's texture once the client has it. Tiles past the world's
// top and bottom edges hide; the x axis wraps. The ring of tiles one beyond
// the window is asked for behind the visible ones, and requests for tiles
// the view left are dropped from the queue.
//
// A pan is the map's hit target picked up by a drag (ui/touch.ts): the pad's
// two-finger scroll and its Hold-and-slide both reach the applet as one
// moving contact, and each move shifts the centre by the contact's travel.
// The controls at the right edge zoom about the centre and recentre on the
// device's position; the field at the top opens the keyboard.

import { createEffect, createMemo, For, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { Image, Text, View } from "@pocketjs/framework/components";
import { createGesture } from "@pocketjs/framework/gesture";
import { getOps } from "@pocketjs/framework/host";
import { BTN } from "@pocketjs/framework/input";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import { NAV_H } from "../ui/bar.tsx";
import { viewHeight, type LayerContext, type NavStack, type PageContent, type PageSpec } from "../ui/nav.tsx";
import { COMPACT, SCREEN_H, SCREEN_W, appletSurfaceId, appletTouch } from "../ui/screen.ts";
import { ellipsize, FONT, measure, toAscii, wrap } from "../ui/text.ts";
import type { Press, Target, TargetDrag } from "../ui/touch.ts";
import { TILE, tileKey, type MapsClient, type Place } from "./api.ts";
import { metresPerPx, toWorld, type MapsModel } from "./model.ts";

export interface MapsEnv {
  model: MapsModel;
  client: MapsClient;
  press: Press;
  keys: Accessor<boolean>;
  /** The keyboard's text with its caret while it is open, else null. */
  draft: Accessor<string | null>;
}

/** Px the d-pad moves the centre a press. */
const KEY_STEP = 96;
/** The span ratio between zoom levels under a pinch. */
const PINCH_STEP = 1.35;
const FIELD_H = 26;
/** The scale bar's longest length. */
const SCALE_MAX_PX = 90;
const ATTRIBUTION = "© OpenStreetMap contributors";

// Sized to the surface by fitSurface(), which each page calls first.
let W = 320;
let MAP_Y = NAV_H;
let MAP_H = 204;
let COLS = 3;
let ROWS = 2;
let BUTTON = 28;
let CONTROL_X = 0;
let FIELD_W = 0;

function fitSurface(): void {
  W = SCREEN_W;
  MAP_Y = NAV_H;
  MAP_H = SCREEN_H - NAV_H;
  COLS = Math.ceil(W / TILE) + 1;
  ROWS = Math.ceil(MAP_H / TILE) + 1;
  BUTTON = COMPACT ? 28 : 32;
  CONTROL_X = W - BUTTON - 8;
  FIELD_W = CONTROL_X - 16;
}

// ---- the tile pool -------------------------------------------------------------------

interface TileSlot {
  box?: NodeMirror;
  image?: NodeMirror;
  shown: boolean;
  x: number;
  y: number;
  handle: number;
}

/** One slot of the pool: a flat placeholder with the tile's Image over it;
 *  the painter moves the box and binds the Image. */
function TileSlotView(props: { slot: TileSlot }) {
  return (
    <View ref={(node: NodeMirror) => (props.slot.box = node)} class="absolute left-0 top-0 w-[256] h-[256] opacity-0 bg-[#e8e4dc] contain-strict">
      <View class="absolute right-0 top-0 w-[1] h-[256] bg-[#d9d4ca]" />
      <View class="absolute left-0 bottom-0 w-[256] h-[1] bg-[#d9d4ca]" />
      <Image ref={(node: NodeMirror) => (props.slot.image = node)} class="absolute left-0 top-0 w-[256] h-[256]" />
    </View>
  );
}

function hideSlot(slot: TileSlot): void {
  if (!slot.shown || !slot.box || !slot.image) return;
  slot.shown = false;
  jump(slot.box, "opacity", 0);
  if (slot.handle !== -1) {
    slot.handle = -1;
    getOps().setImage(slot.image.id, -1);
  }
}

/** The scale bar for the view: a length in px under SCALE_MAX_PX and the
 *  round distance it covers. */
function scaleBar(lat: number, zoom: number): { px: number; label: string } {
  const mpp = metresPerPx(lat, zoom);
  let metres = 1;
  for (const next of [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000]) {
    if (next / mpp > SCALE_MAX_PX) break;
    metres = next;
  }
  return { px: Math.max(2, Math.round(metres / mpp)), label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m` };
}

// ---- controls -------------------------------------------------------------------------

function Button(props: { id: string; x: number; y: number; press: Press; children: JSX.Element }) {
  return (
    <>
      <View
        class={props.press.is(props.id)
          ? "absolute rounded-[6] border border-[#6f7680] bg-gradient-to-b from-[#c3c8cf] to-[#a9afb8]"
          : "absolute rounded-[6] border border-[#8a9099] bg-gradient-to-b from-[#ffffff] to-[#e4e7eb]"}
        style={{ insetL: props.x, insetT: props.y, width: BUTTON, height: BUTTON }}
      />
      {props.children}
    </>
  );
}

/** The recentre mark: a ring with a dot in it. */
function Reticle(props: { x: number; y: number }) {
  return (
    <>
      <View class="absolute" style={{ insetL: props.x - 8, insetT: props.y - 8, width: 16, height: 16, radius: 8, borderWidth: 2, borderColor: "#1f2937" }} />
      <View class="absolute" style={{ insetL: props.x - 3, insetT: props.y - 3, width: 6, height: 6, radius: 3, bgColor: "#1f2937" }} />
    </>
  );
}

// ---- the map page -------------------------------------------------------------------

export function mapPage(env: MapsEnv, _stack: NavStack): PageSpec {
  fitSurface();
  const { model, client, press } = env;
  const slots: TileSlot[] = Array.from({ length: COLS * ROWS }, () => ({ shown: false, x: 0, y: 0, handle: -1 }));
  let marker: NodeMirror | undefined;
  let markerShown = false;

  /** Place every slot for the view and bind the tiles the client has. */
  const place = () => {
    const { lat, lon, zoom } = model.view();
    client.tiles();
    const n = 2 ** zoom;
    const centre = toWorld(lat, lon, zoom);
    const left = centre.x - W / 2;
    const top = centre.y - MAP_H / 2;
    const tx0 = Math.floor(left / TILE);
    const ty0 = Math.floor(top / TILE);
    const keep = new Set<string>();
    let index = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const slot = slots[index++]!;
        const tx = tx0 + c, ty = ty0 + r;
        const sx = Math.round(tx * TILE - left), sy = Math.round(ty * TILE - top);
        if (ty < 0 || ty >= n || sx >= W || sy >= MAP_H) {
          hideSlot(slot);
          continue;
        }
        const wx = ((tx % n) + n) % n;
        keep.add(tileKey(zoom, wx, ty));
        const handle = client.tile(zoom, wx, ty);
        if (handle < 0) client.want(zoom, wx, ty, true);
        if (!slot.box || !slot.image) continue;
        if (!slot.shown) {
          slot.shown = true;
          jump(slot.box, "opacity", 1);
        }
        if (slot.x !== sx) jump(slot.box, "translateX", (slot.x = sx));
        if (slot.y !== sy) jump(slot.box, "translateY", (slot.y = sy));
        if (slot.handle !== handle) {
          slot.handle = handle;
          getOps().setImage(slot.image.id, handle);
        }
      }
    }
    // The ring one tile beyond the window, behind the visible tiles.
    for (let ty = ty0 - 1; ty <= ty0 + ROWS; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = tx0 - 1; tx <= tx0 + COLS; tx++) {
        const wx = ((tx % n) + n) % n;
        const key = tileKey(zoom, wx, ty);
        if (keep.has(key)) continue;
        keep.add(key);
        if (!client.has(zoom, wx, ty)) client.want(zoom, wx, ty, false);
      }
    }
    client.prune(keep);
    // The marker, hidden while it is off screen.
    const pin = model.marker();
    if (!marker) return;
    if (!pin) {
      if (markerShown) jump(marker, "opacity", (markerShown = false) ? 1 : 0);
      return;
    }
    const at = toWorld(pin.lat, pin.lon, zoom);
    // The nearest copy of a wrapped world.
    let mx = at.x - left;
    const world = n * TILE;
    if (mx < -world / 2) mx += world;
    else if (mx > world / 2) mx -= world;
    const my = at.y - top;
    const on = mx > -20 && mx < W + 20 && my > -24 && my < MAP_H + 8;
    if (on) {
      jump(marker, "translateX", Math.round(mx) - 8);
      jump(marker, "translateY", Math.round(my) - 22);
    }
    if (on !== markerShown) jump(marker, "opacity", (markerShown = on) ? 1 : 0);
  };
  onMount(() => createEffect(place));

  // A drag of the map target: each move shifts the centre by the travel.
  let last = { x: 0, y: 0 };
  const pan: TargetDrag = {
    start(x, y) {
      last = { x, y };
    },
    move(x, y) {
      if (x === last.x && y === last.y) return;
      model.panBy(last.x - x, last.y - y);
      last = { x, y };
    },
    end: () => model.settle(),
    cancel: () => model.settle(),
  };
  const nudge = (dx: number, dy: number) => {
    model.panBy(dx, dy);
    model.settle();
  };
  // Two contacts spreading or squeezing (the deck's pinch, a touch screen's
  // two fingers): a level in or out each time the span grows or shrinks by
  // PINCH_STEP from where the last step was taken.
  let pinchSpan = 0;
  const pinch = createGesture({
    surface: appletSurfaceId(),
    pinchSlop: 6,
    onPinchStart: (p) => {
      pinchSpan = p.span;
    },
    onPinchMove: (p) => {
      if (pinchSpan <= 0) pinchSpan = p.span;
      if (p.span >= pinchSpan * PINCH_STEP) {
        model.zoomBy(1);
        pinchSpan = p.span;
      } else if (p.span <= pinchSpan / PINCH_STEP) {
        model.zoomBy(-1);
        pinchSpan = p.span;
      }
    },
    onPinchEnd: () => {
      pinchSpan = 0;
    },
  });
  onCleanup(() => pinch.dispose());

  const FIELD_X = 8;
  const FIELD_Y = MAP_Y + 8;
  const buttons = [
    { id: "map.in", y: MAP_Y + 8, run: () => model.zoomBy(1) },
    { id: "map.out", y: MAP_Y + 8 + BUTTON + 6, run: () => model.zoomBy(-1) },
    { id: "map.locate", y: MAP_Y + 8 + (BUTTON + 6) * 2 + 8, run: () => model.locate() },
  ];
  const scale = createMemo(() => scaleBar(model.view().lat, model.view().zoom));
  const scaleText = () => `${scale().label}  z${model.view().zoom}`;
  const scaleW = () => Math.max(scale().px, Math.ceil(measure(scaleText(), FONT.xxs))) + 14;
  const attributionW = Math.ceil(measure(ATTRIBUTION, FONT.xxs)) + 10;
  const fieldText = () => {
    const typing = env.draft();
    const text = typing ?? model.query();
    return text ? ellipsize(toAscii(text), FONT.sm, FIELD_W - 44) : typing !== null ? "|" : "Search places";
  };
  const busy = () => model.locating() || model.results().status === "loading";

  return {
    title: () => "Maps",
    backLabel: "Map",
    bare: true,
    activateLabel: () => "",
    fixed: () => (
      <>
        <View class="absolute left-0 overflow-hidden bg-[#aad3df]" style={{ insetT: MAP_Y, width: W, height: MAP_H }}>
          <For each={slots}>{(slot) => <TileSlotView slot={slot} />}</For>
          <View ref={(node: NodeMirror) => (marker = node)} class="absolute left-0 top-0 w-[16] h-[24] opacity-0">
            <View class="absolute left-[7] top-[10] w-[2] h-[14] bg-[#7f1d1d]" />
            <View class="absolute left-0 top-0 w-[16] h-[16] rounded-[8] border border-[#7f1d1d] bg-[#ef4444]" />
            <View class="absolute left-[5] top-[5] w-[6] h-[6] rounded-[3] bg-white" />
          </View>
        </View>
        <View
          class={press.is("map.search") ? "absolute rounded-[13] border border-[#8a9099] bg-[#e4e7eb]" : "absolute rounded-[13] border border-[#8a9099] bg-[#ffffff]"}
          style={{ insetL: FIELD_X, insetT: FIELD_Y, width: FIELD_W, height: FIELD_H }}
        />
        <Text class={model.query() || env.draft() !== null ? "absolute text-sm text-[#111111]" : "absolute text-sm text-[#8a9099]"} style={{ insetL: FIELD_X + 12, insetT: FIELD_Y + 5, width: FIELD_W - 44 }}>
          {fieldText()}
        </Text>
        <Show when={busy()}>
          <View class="absolute" style={{ insetL: FIELD_X + FIELD_W - 24, insetT: FIELD_Y + 5 }}>
            <ClassicSpinner size={16} color={"#8a9099"} />
          </View>
        </Show>
        <For each={buttons}>
          {(button) => (
            <Button id={button.id} x={CONTROL_X} y={button.y} press={press}>
              {button.id === "map.locate"
                ? <Reticle x={CONTROL_X + BUTTON / 2} y={button.y + BUTTON / 2} />
                : <Text class="absolute text-lg text-[#1f2937] font-bold text-center" style={{ insetL: CONTROL_X, insetT: button.y + BUTTON / 2 - 11, width: BUTTON }}>{button.id === "map.in" ? "+" : "-"}</Text>}
            </Button>
          )}
        </For>
        <View class="absolute rounded-[4] bg-[#ffffffc0]" style={{ insetL: 8, insetT: SCREEN_H - 36, width: scaleW(), height: 28 }} />
        <Text class="absolute text-2xs text-[#1f2937] font-bold" style={{ insetL: 15, insetT: SCREEN_H - 34 }}>{scaleText()}</Text>
        <View class="absolute h-[2] bg-[#1f2937]" style={{ insetL: 15, insetT: SCREEN_H - 14, width: scale().px }} />
        <View class="absolute w-[2] h-[6] bg-[#1f2937]" style={{ insetL: 15, insetT: SCREEN_H - 18 }} />
        <View class="absolute w-[2] h-[6] bg-[#1f2937]" style={{ insetL: 15 + scale().px - 2, insetT: SCREEN_H - 18 }} />
        <View class="absolute bg-[#ffffffc0]" style={{ insetL: W - attributionW, insetT: SCREEN_H - 15, width: attributionW, height: 15 }} />
        <Text class="absolute text-2xs text-[#333333]" style={{ insetL: W - attributionW + 5, insetT: SCREEN_H - 14 }}>{ATTRIBUTION}</Text>
        <Show when={model.notice()}>
          <View class="absolute w-[280] h-[28] rounded-[14] bg-[#1f2937e8]" style={{ insetL: (W - 280) / 2, insetT: SCREEN_H - 72 }} />
          <Text class="absolute w-[260] text-xs text-white text-center" style={{ insetL: (W - 260) / 2, insetT: SCREEN_H - 65 }}>{ellipsize(toAscii(model.notice()), FONT.xs, 260)}</Text>
        </Show>
      </>
    ),
    fixedTargets: () => [
      { id: "map.pan", x: 0, y: MAP_Y, w: W, h: MAP_H, drag: pan },
      { id: "map.search", x: FIELD_X, y: FIELD_Y - 4, w: FIELD_W, h: FIELD_H + 8, run: () => model.editQuery() },
      ...buttons.map((button) => ({ id: button.id, x: CONTROL_X - 4, y: button.y - 3, w: BUTTON + 8, h: BUTTON + 6, run: button.run })),
    ],
    legend: () => [
      { button: "lr", label: "Zoom" },
      { button: "dpad-h", label: "Pan" },
      { button: "dpad-v", label: "Pan" },
      { button: "triangle", label: "Locate" },
      { button: "square", label: "Search" },
    ],
    key(pressed) {
      if (pressed & BTN.LTRIGGER) model.zoomBy(-1);
      else if (pressed & BTN.RTRIGGER) model.zoomBy(1);
      else if (pressed & BTN.LEFT) nudge(-KEY_STEP, 0);
      else if (pressed & BTN.RIGHT) nudge(KEY_STEP, 0);
      else if (pressed & BTN.UP) nudge(0, -KEY_STEP);
      else if (pressed & BTN.DOWN) nudge(0, KEY_STEP);
      else if (pressed & BTN.TRIANGLE) model.locate();
      else if (pressed & BTN.SQUARE) model.editQuery();
      else return false;
      return true;
    },
  };
}

// ---- the results page ----------------------------------------------------------------

const ROW_H = 48;
const NAME_LINE = 16;

interface ResultRow {
  key: string;
  place: Place;
  name: string;
  y: number;
}

function Centered(props: { title: string; detail: string; spinner?: boolean }) {
  const lines = () => wrap(props.detail, FONT.xs, 260, 4);
  return (
    <>
      <Show when={props.spinner}>
        <View class="absolute" style={{ insetL: W / 2 - 11, insetT: 40 }}>
          <ClassicSpinner size={22} color={"#8a9099"} />
        </View>
      </Show>
      <Text class="absolute left-0 text-base text-[#4c566c] font-bold text-center" style={{ insetT: 74, width: W }}>{props.title}</Text>
      <For each={lines()}>
        {(line, index) => <Text class="absolute w-[260] text-xs text-[#6d7584] text-center" style={{ insetL: (W - 260) / 2, insetT: 98 + index() * 15 }}>{line}</Text>}
      </For>
    </>
  );
}

export function resultsPage(env: MapsEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press } = env;
  const VIEW_H = viewHeight();
  const rows = createMemo((): ResultRow[] =>
    model.results().items.map((place, index) => ({
      key: `place.${index}`,
      place,
      name: wrap(toAscii(place.name), FONT.sm, W - 24, 2).join("\n"),
      y: index * ROW_H,
    })),
  );
  const listed = () => model.results().status === "ready" && rows().length > 0;
  const lit = (key: string) => key === press.id() || (env.keys() && key === layer.focus());
  const byKey = createMemo(() => new Map(rows().map((row) => [row.key, row])));
  const choose = (row: ResultRow) => {
    model.choose(row.place);
    stack.pop();
  };
  const content: PageContent = {
    view: () => (
      <>
        <For each={rows()}>
          {(row) => (
            <View class="absolute left-0 h-[48]" style={{ insetT: row.y, width: W }}>
              <View class={lit(row.key) ? "absolute inset-0 bg-gradient-to-b from-[#5a8de0] to-[#2f6ad0]" : "hidden"} />
              <View class="absolute left-[12] right-0 bottom-0 h-[1] bg-[#e0e0e0]" />
              <Text class={lit(row.key) ? "absolute left-[12] top-[7] text-sm text-white leading-[16]" : "absolute left-[12] top-[7] text-sm text-[#111111] leading-[16]"} style={{ width: W - 24 }}>{row.name}</Text>
            </View>
          )}
        </For>
        <Show when={!listed()}>
          {model.results().status === "error"
            ? <Centered title="Could not search" detail={model.results().error} />
            : model.results().status === "loading"
              ? <Centered title="Searching" detail={`Asking OpenStreetMap for "${toAscii(model.query())}".`} spinner />
              : model.results().status === "ready"
                ? <Centered title="No Places" detail={`Nothing matched "${toAscii(model.query())}".`} />
                : <Centered title="Search Places" detail={appletTouch() ? "Tap the field on the map and type a place." : "Press the square button on the map and type a place."} />}
        </Show>
      </>
    ),
    height: () => (listed() ? rows().length * ROW_H + 8 : VIEW_H),
    focusOrder: () => rows().map((row) => row.key),
    targets(top, offset, bottom) {
      const out: Target[] = [];
      if (!listed()) return out;
      for (const row of rows()) {
        const y = top + row.y - offset;
        if (y + ROW_H <= top || y >= bottom) continue;
        out.push({ id: row.key, x: 0, y, w: W, h: ROW_H, run: () => choose(row) });
      }
      return out;
    },
    span(id) {
      const row = byKey().get(id);
      return row ? [row.y, row.y + ROW_H] : null;
    },
    activate(id) {
      const row = byKey().get(id);
      if (row) choose(row);
    },
  };
  return {
    title: () => "Places",
    backLabel: "Places",
    bare: "white",
    content,
    activateLabel: () => "Show",
    legend: () => [],
  };
}

export const RESULT_ROW_H = ROW_H;
export const RESULT_NAME_LINE = NAME_LINE;
