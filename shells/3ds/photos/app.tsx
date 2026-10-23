// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/photos/app.tsx — Photos: the console's Camera Roll, every JPEG
// under sdmc:/DCIM (Camera's and the console's own camera application's),
// newest first, as an iOS 6 grid of square thumbnails; a photo full screen,
// swiped left and right; delete with a confirmation.
//
// The host decodes on a worker (camera.photo, @pocketjs/framework/camera):
// loadPhoto queues a decode and a "loaded" event hands back a texture. The
// grid asks for the thumbnails of the rows near the visible band, keeps at
// most THUMBS_KEPT of them and frees the ones furthest away; its rows are a
// fixed pool of slots whose images are set with setImage, so scrolling
// creates no nodes.

import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { AuxiliarySurface, Image, Text, View } from "@pocketjs/framework/components";
import {
  deletePhoto,
  freePhoto,
  listPhotos,
  loadPhoto,
  PHOTO_KIND,
  PHOTO_PENDING,
  photoEvents,
  type PhotoEntry,
} from "@pocketjs/framework/camera";
import { getOps } from "@pocketjs/framework/host";
import { BTN } from "@pocketjs/framework/input";
import { onButtonPress, onFrame } from "@pocketjs/framework/lifecycle";
import { registerTexture, type NodeMirror } from "@pocketjs/framework/renderer";
import { createAlerts } from "../ui/alert.tsx";
import { NAV_H } from "../ui/bar.tsx";
import { createNavStack, type LayerContext, type NavStack, type PageContent, type PageSpec } from "../ui/nav.tsx";
import { createSlotPool, type PlacedRow, type SlotPool } from "../ui/slots.ts";
import { createPress, createTouchRouter, type Press, type Target } from "../ui/touch.ts";

const W = 320;
const VIEW_H = 240 - NAV_H;
const COLUMNS = 4;
/** A cell is the 78 px thumbnail and a 2 px gap; rows start 2 px down. */
const CELL = 80;
const THUMB = 78;
const TOP = 2;
/** Thumbnails asked for beyond the visible band, in rows. */
const AHEAD_ROWS = 2;
const THUMBS_KEPT = 48;
const MAX_IN_FLIGHT = 6;
const ALL_BUTTONS = 0xffff;
const SWIPE = 60;
/** The full view under the bar: 240 px of photo in the 204 px below it. */
const FIT = VIEW_H / 240;

interface Thumb {
  handle: number;
}

interface GridRow extends PlacedRow {
  index: number;
  names: string[];
}

export interface PhotosModel {
  photos: Accessor<readonly PhotoEntry[]>;
  reload(): void;
  /** Bumped when a thumbnail arrives or leaves. */
  thumbs: Accessor<number>;
  thumb(name: string): Thumb | undefined;
  /** Ask for the thumbnails of photos [from, to); free the far ones. */
  want(from: number, to: number): void;
  /** The full view of `name`, once loaded: a texture key. */
  full: Accessor<{ name: string; key: string } | null>;
  showFull(name: string | null): void;
  remove(name: string): void;
  dispose(): void;
}

export function createPhotosModel(): PhotosModel {
  const [photos, setPhotos] = createSignal<readonly PhotoEntry[]>(listPhotos());
  const [thumbs, setThumbs] = createSignal(0);
  const [full, setFull] = createSignal<{ name: string; key: string } | null>(null);
  const loaded = new Map<string, Thumb>();
  const pending = new Set<string>();
  let fullName: string | null = null;
  let fullHandle = -1;
  let wanted: [number, number] = [0, 0];

  const drop = (name: string) => {
    const thumb = loaded.get(name);
    if (!thumb) return;
    freePhoto(thumb.handle);
    loaded.delete(name);
  };
  const releaseFull = () => {
    if (fullHandle >= 0) freePhoto(fullHandle);
    fullHandle = -1;
  };

  onFrame(() => {
    const events = photoEvents();
    if (events.length === 0) return;
    let changed = false;
    for (const event of events) {
      if (event.t === "loaded") {
        if (event.kind === PHOTO_KIND.thumb) {
          pending.delete(event.name);
          const index = photos().findIndex((entry) => entry.name === event.name);
          if (index < 0 || loaded.has(event.name) || index < wanted[0] - COLUMNS * AHEAD_ROWS || index >= wanted[1] + COLUMNS * AHEAD_ROWS) {
            freePhoto(event.handle);
            continue;
          }
          loaded.set(event.name, { handle: event.handle });
          changed = true;
        } else if (event.name === fullName && fullHandle < 0) {
          fullHandle = event.handle;
          const key = `photo.full.${event.handle}`;
          registerTexture(key, event.handle);
          setFull({ name: event.name, key });
        } else {
          freePhoto(event.handle);
        }
      } else if (event.t === "error" && event.name) {
        pending.delete(event.name);
      }
    }
    if (changed) setThumbs(thumbs() + 1);
    pump();
  });

  /** Keep up to MAX_IN_FLIGHT thumbnail decodes going for the wanted range. */
  const pump = () => {
    const list = photos();
    for (let index = wanted[0]; index < Math.min(wanted[1], list.length) && pending.size < MAX_IN_FLIGHT; index += 1) {
      const name = list[index]!.name;
      if (loaded.has(name) || pending.has(name)) continue;
      if (loadPhoto(name, PHOTO_KIND.thumb) === PHOTO_PENDING) pending.add(name);
      else break;
    }
  };

  return {
    photos,
    reload() {
      setPhotos(listPhotos());
      const names = new Set(photos().map((entry) => entry.name));
      for (const name of [...loaded.keys()]) if (!names.has(name)) drop(name);
      setThumbs(thumbs() + 1);
      pump();
    },
    thumbs,
    thumb: (name) => loaded.get(name),
    want(from, to) {
      wanted = [Math.max(0, from), to];
      if (loaded.size > THUMBS_KEPT) {
        const list = photos();
        const centre = (from + to) / 2;
        const far = [...loaded.keys()]
          .map((name) => ({ name, distance: Math.abs(list.findIndex((entry) => entry.name === name) - centre) }))
          .sort((a, b) => b.distance - a.distance);
        for (const { name } of far.slice(0, loaded.size - THUMBS_KEPT)) drop(name);
        setThumbs(thumbs() + 1);
      }
      pump();
    },
    full,
    showFull(name) {
      if (name === fullName) return;
      releaseFull();
      fullName = name;
      setFull(null);
      if (name && loadPhoto(name, PHOTO_KIND.full) !== PHOTO_PENDING) fullName = null;
    },
    remove(name) {
      deletePhoto(name);
      drop(name);
      if (name === fullName) {
        releaseFull();
        fullName = null;
        setFull(null);
      }
      setPhotos(photos().filter((entry) => entry.name !== name));
      setThumbs(thumbs() + 1);
    },
    dispose() {
      for (const name of [...loaded.keys()]) drop(name);
      releaseFull();
    },
  };
}

interface PhotosEnv {
  model: PhotosModel;
  press: Press;
  /** The photo the viewer shows. */
  current: Accessor<number>;
  setCurrent(index: number): void;
  askDelete(name: string): void;
}

// ---- the grid ---------------------------------------------------------------------

function GridSlot(props: { pool: SlotPool<GridRow>; slot: number; env: PhotosEnv; lit: (index: number) => boolean }) {
  let box!: NodeMirror;
  const images: NodeMirror[] = [];
  const cellBoxes: NodeMirror[] = [];
  const [rowIndex, setRowIndex] = createSignal(-1000);
  let row: GridRow | null = null;
  let y = -1;
  let used = -1;
  const shown: number[] = [-2, -2, -2, -2];
  const paintImages = () => {
    for (let column = 0; column < COLUMNS; column += 1) {
      const name = row?.names[column];
      const handle = name ? props.env.model.thumb(name)?.handle ?? -1 : -1;
      if (shown[column] === handle) continue;
      shown[column] = handle;
      getOps().setImage(images[column]!.id, handle);
      jump(images[column]!, "opacity", handle >= 0 ? 1 : 0);
    }
  };
  onMount(() => {
    props.pool.attach(props.slot, (next, skeleton) => {
      row = next;
      if (!next) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        paintImages();
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (next.y !== y) jump(box, "translateY", (y = next.y));
      if (next.names.length !== used) {
        used = next.names.length;
        for (let column = 0; column < COLUMNS; column += 1) jump(cellBoxes[column]!, "opacity", column < used ? 1 : 0);
      }
      setRowIndex(next.index);
      // A skeleton is the grey cells: the thumbnails bind in a later frame.
      if (skeleton) {
        for (let column = 0; column < COLUMNS; column += 1) {
          if (shown[column] === -2) continue;
          shown[column] = -2;
          jump(images[column]!, "opacity", 0);
        }
        return;
      }
      paintImages();
    });
    // A thumbnail arrived or left.
    createEffect(() => {
      props.env.model.thumbs();
      paintImages();
    });
  });
  const cells = [0, 1, 2, 3];
  return (
    <View ref={(node: NodeMirror) => { box = node; jump(node, "opacity", 0); }} class="absolute left-0 top-0 w-[320] h-[80]">
      <For each={cells}>
        {(column) => (
          <View ref={(node: NodeMirror) => (cellBoxes[column] = node)} class="absolute w-[78] h-[78] bg-[#d9dce1] overflow-hidden" style={{ insetL: 2 + column * CELL, insetT: 0 }}>
            <Image ref={(node: NodeMirror) => (images[column] = node)} class="absolute left-0 top-0 w-[128] h-[128]" />
            <View class={props.lit(rowIndex() + column) ? "absolute left-0 top-0 w-[78] h-[78] bg-[#00000060]" : "absolute left-0 top-0 w-[78] h-[78] bg-[#00000000]"} />
          </View>
        )}
      </For>
    </View>
  );
}

function gridPage(env: PhotosEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { model, press } = env;
  const layout = createMemo(() => {
    const list = model.photos();
    const rows: GridRow[] = [];
    for (let index = 0; index < list.length; index += COLUMNS) {
      rows.push({ index, y: TOP + (index / COLUMNS) * CELL, h: CELL, names: list.slice(index, index + COLUMNS).map((entry) => entry.name) });
    }
    return { rows, height: Math.max(VIEW_H, TOP + rows.length * CELL + 30) };
  });
  const pool = createSlotPool(() => layout().rows, layer.offset, { view: VIEW_H, overscan: CELL, minRowH: CELL });
  const lit = (index: number) => press.is(`photo.${index}`) || (layer.focus() === `photo.${index}`);
  const open = (index: number) => {
    if (index < 0 || index >= model.photos().length) return;
    env.setCurrent(index);
    stack.push("photo");
  };
  // The thumbnails of the visible rows and AHEAD_ROWS beyond them.
  let wantedRow = -1;
  onFrame(() => {
    const visible = Math.max(0, Math.floor((layer.offset() - TOP) / CELL));
    if (visible === wantedRow) return;
    wantedRow = visible;
    const first = Math.max(0, visible - AHEAD_ROWS);
    const end = visible + Math.ceil(VIEW_H / CELL) + 1 + AHEAD_ROWS;
    model.want(first * COLUMNS, end * COLUMNS);
  });

  const content: PageContent = {
    view: () => (
      <>
        <For each={pool.slots}>{(slot) => <GridSlot pool={pool} slot={slot} env={env} lit={lit} />}</For>
        <Show when={model.photos().length === 0}>
          <Text class="absolute left-0 top-[64] w-[320] text-lg text-[#7a8088] font-bold text-center">No Photos</Text>
          <Text class="absolute left-0 top-[92] w-[320] text-sm text-[#8a9099] text-center">Photos you take with Camera appear here.</Text>
        </Show>
        <Show when={model.photos().length > 0}>
          <Text class="absolute left-0 w-[320] text-sm text-[#7a8088] text-center" style={{ insetT: layout().height - 24 }}>
            {`${model.photos().length} ${model.photos().length === 1 ? "Photo" : "Photos"}`}
          </Text>
        </Show>
      </>
    ),
    height: () => layout().height,
    focusOrder: () => model.photos().map((_, index) => `photo.${index}`),
    targets(top, offset, bottom) {
      const out: Target[] = [];
      for (const row of layout().rows) {
        const y = top + row.y - offset;
        if (y + row.h <= top || y >= bottom) continue;
        row.names.forEach((_, column) => {
          const index = row.index + column;
          out.push({ id: `photo.${index}`, x: 2 + column * CELL, y, w: THUMB, h: THUMB, run: () => open(index) });
        });
      }
      return out;
    },
    span(id) {
      const index = Number(id.slice(6));
      const y = TOP + Math.floor(index / COLUMNS) * CELL;
      return [y, y + CELL];
    },
    activate(id) {
      open(Number(id.slice(6)));
    },
  };

  return {
    title: () => "Camera Roll",
    backLabel: "Camera Roll",
    tint: "black",
    bare: "white",
    content,
    key(pressed) {
      if (pressed & BTN.TRIANGLE) {
        model.reload();
        return true;
      }
      return false;
    },
  };
}

// ---- one photo --------------------------------------------------------------------

function photoPage(env: PhotosEnv, stack: NavStack): PageSpec {
  const { model } = env;
  const name = () => model.photos()[env.current()]?.name ?? null;
  let image: NodeMirror | undefined;
  let dragX = 0;
  const show = () => model.showFull(name());
  show();
  onCleanup(() => model.showFull(null));
  const step = (by: number) => {
    const next = env.current() + by;
    if (next < 0 || next >= model.photos().length) {
      if (image) animate(image, "translateX", 0, { dur: 180, easing: "out" });
      return;
    }
    env.setCurrent(next);
    show();
    if (image) {
      jump(image, "translateX", by * 60);
      animate(image, "translateX", 0, { dur: 200, easing: "out" });
    }
  };
  const drag = {
    start(x: number) {
      dragX = x;
    },
    move(x: number) {
      if (image) jump(image, "translateX", x - dragX);
    },
    end(x: number) {
      const dx = x - dragX;
      if (dx <= -SWIPE) step(1);
      else if (dx >= SWIPE) step(-1);
      else if (image) animate(image, "translateX", 0, { dur: 160, easing: "out" });
    },
    cancel() {
      if (image) animate(image, "translateX", 0, { dur: 160, easing: "out" });
    },
  };
  const remove = () => {
    const current = name();
    if (current) env.askDelete(current);
  };
  return {
    title: () => (model.photos().length ? `${env.current() + 1} of ${model.photos().length}` : "Photo"),
    tint: "black",
    bare: true,
    right: () => (name() ? { id: "photo.delete", label: "Delete", kind: "plain", run: remove } : null),
    fixed: () => (
      <>
        <View class="absolute left-0 top-0 w-[320] h-[240] bg-black" />
        <View ref={(node: NodeMirror) => (image = node)} class="absolute left-0 top-0 w-[320] h-[240]">
          <Show
            when={model.full()?.name === name() ? model.full() : null}
            keyed
            fallback={<Text class="absolute left-0 top-[132] w-[320] text-sm text-[#8a9099] text-center">Loading...</Text>}
          >
            {(full) => (
              /* The host fits the photo to 320x240 in a 512x256 texture; drawn at
                 FIT of that size it fills the 204 px under the bar, centred. */
              <View class="absolute overflow-hidden" style={{ insetL: (W - 320 * FIT) / 2, insetT: NAV_H, width: 320 * FIT, height: 240 * FIT }}>
                <Image class="absolute left-0 top-0" src={full.key} style={{ width: 512 * FIT, height: 256 * FIT }} />
              </View>
            )}
          </Show>
        </View>
      </>
    ),
    fixedTargets: () => [{ id: "photo.view", x: 0, y: NAV_H, w: W, h: 240 - NAV_H, drag }],
    key(pressed) {
      if (pressed & BTN.LEFT) step(-1);
      else if (pressed & BTN.RIGHT) step(1);
      else if (pressed & BTN.SQUARE) remove();
      else return false;
      return true;
    },
  };
}

export default function Photos() {
  const press = createPress();
  const [keys, setKeys] = createSignal(false);
  const [current, setCurrent] = createSignal(0);
  const alerts = createAlerts(press);
  const model = createPhotosModel();
  onCleanup(() => model.dispose());
  let stack!: NavStack;

  const env: PhotosEnv = {
    model,
    press,
    current,
    setCurrent,
    askDelete(name) {
      alerts.show({
        title: "Delete Photo?",
        message: "This photo will be deleted from the SD card.",
        action: "Delete",
        run: () => {
          const at = current();
          batch(() => {
            model.remove(name);
            const count = model.photos().length;
            if (count === 0) stack.pop();
            else setCurrent(Math.min(at, count - 1));
          });
          if (model.photos().length > 0) model.showFull(model.photos()[current()]!.name);
        },
      });
    },
  };

  stack = createNavStack({
    press,
    keys,
    setKeys,
    onExit: () => undefined,
    rootBack: null,
    page(id, nav, layer) {
      return id === "photo" ? photoPage(env, nav) : gridPage(env, nav, layer);
    },
  });
  stack.reset("grid");

  createTouchRouter({
    surface: "auxiliary",
    press,
    page: () => alerts.touch() ?? stack.touch(),
    active: () => !stack.busy(),
    onTouch: () => setKeys(false),
  });
  onButtonPress(ALL_BUTTONS, (pressed) => {
    if (alerts.key(pressed)) return;
    stack.key(pressed);
  });

  return (
    <AuxiliarySurface>
      <View class="relative w-full h-full bg-white overflow-hidden">
        {stack.view()}
        {alerts.view()}
      </View>
    </AuxiliarySurface>
  );
}
