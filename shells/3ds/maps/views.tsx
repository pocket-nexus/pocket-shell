// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/maps/views.tsx — the pages of Maps: the map under the bar, and the
// list of places a search found.
//
// The map is two layers of tile slots, each a pool of COLS x ROWS (one more
// each way than the window holds at the smallest a tile is drawn), after
// pocket-map's camera. The zoom is continuous: a layer's tiles keep their
// level's 256 px inside a world node, whose translate and scale carry the
// view. When the zoom leaves a level's reach, what the front layer has drawn
// moves to the back layer, which stays on screen, scaled with the view, until
// the new level's tiles cover the window. A pinch through a level asks for
// none of its tiles, and an unseen parent level is never fetched. Tiles past
// the world's top and bottom edges hide; the x axis wraps. Once the view has
// stopped, the ring of tiles one beyond the window is asked for behind the
// visible ones; requests for tiles the view left are dropped from the queue.
//
// A pan is the map's hit target picked up by a drag (ui/touch.ts): the pad's
// two-finger scroll and its Hold-and-slide both reach the applet as one
// moving contact, and each move shifts the centre by the contact's travel.
// Two contacts zoom about their centroid and ease to a level when they lift.
// The controls at the right edge zoom about the centre and recentre on the
// device's position; the field at the top opens the keyboard.

import { createEffect, createMemo, For, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { Image, Text, View } from "@pocketjs/framework/components";
import { createGesture } from "@pocketjs/framework/gesture";
import { getOps } from "@pocketjs/framework/host";
import { BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
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
/** Frames a level holds still during a pinch before its tiles are asked for. */
const LEVEL_SETTLE_FRAMES = 12;
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

/** A level is drawn this far from its own zoom before the next takes over:
 *  its tiles shrink to about 66% or grow to about 152%. */
const LEVEL_REACH = 0.6;

function fitSurface(): void {
  W = SCREEN_W;
  MAP_Y = NAV_H;
  MAP_H = SCREEN_H - NAV_H;
  const smallest = TILE * 2 ** -LEVEL_REACH;
  COLS = Math.ceil(W / smallest) + 1;
  ROWS = Math.ceil(MAP_H / smallest) + 1;
  BUTTON = COMPACT ? 28 : 32;
  CONTROL_X = W - BUTTON - 8;
  FIELD_W = CONTROL_X - 16;
}

// ---- the tile layers ------------------------------------------------------------------

interface TileSlot {
  box?: NodeMirror;
  image?: NodeMirror;
  shown: boolean;
  x: number;
  y: number;
  handle: number;
  /** The tile bound, for keeping it from being freed. */
  key: string;
}

/** One level's tiles: a pool of slots in a world node. Tiles stay at their
 *  level's 256 px inside it, and the node's translate and scale carry the
 *  view, so a pan or a pinch writes four props a frame. */
interface TileLayer {
  world?: NodeMirror;
  slots: TileSlot[];
  level: number;
  /** The tile the world node's origin stands for. */
  column: number;
  row: number;
  active: boolean;
}

const newLayer = (): TileLayer => ({
  slots: Array.from({ length: COLS * ROWS }, () => ({ shown: false, x: 0, y: 0, handle: -1, key: "" })),
  level: 0,
  column: 0,
  row: 0,
  active: false,
});

function TileSlotView(props: { slot: TileSlot }) {
  return (
    <View ref={(node: NodeMirror) => (props.slot.box = node)} class="absolute left-0 top-0 w-[256] h-[256] opacity-0">
      <Image ref={(node: NodeMirror) => (props.slot.image = node)} class="absolute left-0 top-0 w-[256] h-[256]" />
    </View>
  );
}

function LayerView(props: { layer: TileLayer }) {
  // A 1x1 box whose transform origin is its top-left corner.
  return (
    <View ref={(node: NodeMirror) => (props.layer.world = node)} class="absolute left-0 top-0" style={{ width: 1, height: 1, originX: -0.5, originY: -0.5 }}>
      <For each={props.layer.slots}>{(slot) => <TileSlotView slot={slot} />}</For>
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

function showSlot(slot: TileSlot, x: number, y: number, handle: number, key: string): void {
  if (!slot.box || !slot.image) return;
  slot.key = key;
  if (slot.x !== x) jump(slot.box, "translateX", (slot.x = x));
  if (slot.y !== y) jump(slot.box, "translateY", (slot.y = y));
  if (slot.handle !== handle) {
    slot.handle = handle;
    getOps().setImage(slot.image.id, handle);
  }
  if (!slot.shown) {
    slot.shown = true;
    jump(slot.box, "opacity", 1);
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
  const back = newLayer();
  const front = newLayer();
  let marker: NodeMirror | undefined;
  let markerShown = false;
  /** Frames the front level has held still, so a pinch through a level asks
   *  for none of its tiles. */
  let levelFrames = 0;

  const onScreen = (layer: TileLayer) => layer.slots.reduce((count, slot) => count + (slot.shown ? 1 : 0), 0);

  /** The front level gives way to `level`: what it has drawn moves to the back
   *  layer and stays on screen until the new tiles cover it. The back layer
   *  keeps its picture when the front one had less to offer, so a pinch through
   *  two levels never blanks the map. */
  const changeLevel = (level: number) => {
    if (onScreen(front) >= onScreen(back) || !back.active) {
      back.level = front.level;
      back.column = front.column;
      back.row = front.row;
      back.active = front.active;
      back.slots.forEach((slot, index) => {
        const from = front.slots[index]!;
        if (from.shown) showSlot(slot, from.x, from.y, from.handle, from.key);
        else hideSlot(slot);
      });
    }
    for (const slot of front.slots) hideSlot(slot);
    front.level = level;
    front.active = false;
    levelFrames = 0;
  };

  /** Write a layer's transform for the view. */
  const carry = (layer: TileLayer, lat: number, lon: number, zoom: number, nearest: boolean) => {
    if (!layer.world) return;
    const scale = 2 ** (zoom - layer.level);
    const centre = toWorld(lat, lon, layer.level);
    let dx = layer.column * TILE - centre.x;
    // The front layer's slots follow the centre across the date line; the back
    // layer's stay, so it takes the copy of the world nearest the view.
    if (nearest) dx -= Math.round(dx / (TILE * 2 ** layer.level)) * (TILE * 2 ** layer.level);
    const x = W / 2 + dx * scale;
    const y = MAP_H / 2 + (layer.row * TILE - centre.y) * scale;
    // At rest on the level a tile is drawn texel for texel.
    jump(layer.world, "translateX", scale === 1 ? Math.round(x) : x);
    jump(layer.world, "translateY", scale === 1 ? Math.round(y) : y);
    jump(layer.world, "scaleX", scale);
    jump(layer.world, "scaleY", scale);
  };

  /** Place every slot for the view and bind the tiles the client has. */
  const place = () => {
    const { lat, lon, zoom } = model.view();
    client.tiles();
    if (!front.active || Math.abs(zoom - front.level) > LEVEL_REACH) {
      const level = Math.round(zoom);
      if (level !== front.level || !front.active) changeLevel(level);
    }
    const level = front.level;
    const n = 2 ** level;
    const scale = 2 ** (zoom - level);
    const centre = toWorld(lat, lon, level);
    const left = centre.x - W / 2 / scale;
    const top = centre.y - MAP_H / 2 / scale;
    const tx0 = Math.floor(left / TILE);
    const ty0 = Math.floor(top / TILE);
    if (!front.active) {
      front.active = true;
      front.column = tx0;
      front.row = ty0;
    }
    const moving = model.moving();
    const asking = !moving || levelFrames >= LEVEL_SETTLE_FRAMES;
    const keep = new Set<string>();
    let index = 0;
    let covered = true;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const slot = front.slots[index++]!;
        const tx = tx0 + c, ty = ty0 + r;
        const sx = (tx * TILE - left) * scale, sy = (ty * TILE - top) * scale;
        if (ty < 0 || ty >= n || sx >= W || sy >= MAP_H) {
          hideSlot(slot);
          continue;
        }
        const wx = ((tx % n) + n) % n;
        const handle = client.tile(level, wx, ty);
        if (asking) {
          keep.add(tileKey(level, wx, ty));
          if (handle < 0) client.want(level, wx, ty, true);
        }
        if (handle < 0) {
          covered = false;
          hideSlot(slot);
        } else showSlot(slot, (tx - front.column) * TILE, (ty - front.row) * TILE, handle, tileKey(level, wx, ty));
      }
    }
    // The ring one tile beyond the window, once the view has stopped.
    if (!moving) {
      for (let ty = ty0 - 1; ty <= ty0 + ROWS; ty++) {
        if (ty < 0 || ty >= n) continue;
        for (let tx = tx0 - 1; tx <= tx0 + COLS; tx++) {
          const wx = ((tx % n) + n) % n;
          const key = tileKey(level, wx, ty);
          if (keep.has(key)) continue;
          keep.add(key);
          if (!client.has(level, wx, ty)) client.want(level, wx, ty, false);
        }
      }
    }
    client.prune(keep);
    // The back layer goes once the front one covers the window; its tiles stay
    // drawn (and last in line to be freed) until then.
    if (back.active) {
      if (covered && !moving) {
        for (const slot of back.slots) hideSlot(slot);
        back.active = false;
      } else {
        for (const slot of back.slots) if (slot.shown) client.touch(slot.key);
      }
    }
    if (back.active) carry(back, lat, lon, zoom, true);
    carry(front, lat, lon, zoom, false);
    // The marker, hidden while it is off screen.
    const pin = model.marker();
    if (!marker) return;
    if (!pin) {
      if (markerShown) jump(marker, "opacity", (markerShown = false) ? 1 : 0);
      return;
    }
    const at = toWorld(pin.lat, pin.lon, zoom);
    const here = toWorld(lat, lon, zoom);
    // The nearest copy of a wrapped world.
    let mx = at.x - here.x + W / 2;
    const world = TILE * 2 ** zoom;
    if (mx < -world / 2) mx += world;
    else if (mx > world / 2) mx -= world;
    const my = at.y - here.y + MAP_H / 2;
    const on = mx > -20 && mx < W + 20 && my > -24 && my < MAP_H + 8;
    if (on) {
      jump(marker, "translateX", Math.round(mx) - 8);
      jump(marker, "translateY", Math.round(my) - 22);
    }
    if (on !== markerShown) jump(marker, "opacity", (markerShown = on) ? 1 : 0);
  };
  onMount(() => createEffect(place));
  onFrame(() => {
    model.tick();
    if (!model.moving()) return;
    // A pinch resting on a level starts asking for its tiles.
    if (++levelFrames === LEVEL_SETTLE_FRAMES) place();
  });

  // A drag of the map target: each move shifts the centre by the travel.
  let last = { x: 0, y: 0 };
  let afterPinch = false;
  const pan: TargetDrag = {
    start(x, y) {
      last = { x, y };
      afterPinch = false;
    },
    move(x, y) {
      if (model.pinching()) {
        afterPinch = true;
        return;
      }
      // The finger left behind by a pinch picks the map up from where it is.
      if (afterPinch) {
        afterPinch = false;
        last = { x, y };
        return;
      }
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
  // two fingers): the zoom follows the span, about their centroid.
  const fromCentre = (x: number, y: number) => ({ x: x - W / 2, y: y - (MAP_Y + MAP_H / 2) });
  const pinch = createGesture({
    surface: appletSurfaceId(),
    pinchSlop: 6,
    onPinchStart: (p) => {
      const at = fromCentre(p.cx, p.cy);
      model.pinchStart(at.x, at.y, p.span);
    },
    onPinchMove: (p) => {
      const at = fromCentre(p.cx, p.cy);
      model.pinchMove(at.x, at.y, p.span);
    },
    onPinchEnd: () => model.pinchEnd(),
  });
  onCleanup(() => pinch.dispose());

  const FIELD_X = 8;
  const FIELD_Y = MAP_Y + 8;
  const buttons = [
    { id: "map.in", y: MAP_Y + 8, run: () => model.zoomBy(1) },
    { id: "map.out", y: MAP_Y + 8 + BUTTON + 6, run: () => model.zoomBy(-1) },
    { id: "map.locate", y: MAP_Y + 8 + (BUTTON + 6) * 2 + 8, run: () => model.locate() },
  ];
  const shownZoom = createMemo(() => Math.round(model.view().zoom));
  const scale = createMemo(() => scaleBar(model.view().lat, shownZoom()), undefined, { equals: (a, b) => a.px === b.px && a.label === b.label });
  const scaleText = () => `${scale().label}  z${shownZoom()}`;
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
        <View class="absolute left-0 overflow-hidden bg-[#e8e4dc]" style={{ insetT: MAP_Y, width: W, height: MAP_H }}>
          <LayerView layer={back} />
          <LayerView layer={front} />
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
