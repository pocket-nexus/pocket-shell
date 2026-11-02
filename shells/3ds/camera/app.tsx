// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/camera/app.tsx — Camera: the console's camera filling the touch
// screen, an iOS 6 camera bar under it, and the photo it took last. On a
// larger landscape surface the preview is as tall as the surface and the bar
// runs down its right side, as on an iPhone held sideways; in portrait the
// preview spans the width over the bar.
//
// The preview is the camera module's texture (camera.photo,
// @pocketjs/framework/camera). The shutter (A, R or the bar's button) asks
// the host for a 640x480 still; the host saves it as a JPEG under
// sdmc:/DCIM/100POCKT and answers with a "saved" event, after which the
// bar's thumbnail loads the new photo. X switches between the outer and the
// inner camera. The thumbnail opens a review of the last photo, where B
// goes back and the trash deletes it.

import { createSignal, onCleanup, Show } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { AuxiliarySurface, Image, Text, View } from "@pocketjs/framework/components";
import {
  capturePhoto,
  closeCamera,
  deletePhoto,
  freePhoto,
  listPhotos,
  loadPhoto,
  openCamera,
  PHOTO_KIND,
  PHOTO_PENDING,
  photoEvents,
} from "@pocketjs/framework/camera";
import { BTN } from "@pocketjs/framework/input";
import { onButtonPress, onFrame } from "@pocketjs/framework/lifecycle";
import { registerTexture, type NodeMirror } from "@pocketjs/framework/renderer";
import { createAlerts } from "../ui/alert.tsx";
import { COMPACT, SCREEN_H, SCREEN_W, TALL } from "../ui/screen.ts";
import { createPress, createTouchRouter, type Target } from "../ui/touch.ts";

const BAR_H = 46;
/** The camera image's size in its 512x256 preview texture, and a photo's
 *  in its full view's texture. */
const IMAGE_W = 320;
const IMAGE_H = 240;
const PREVIEW_KEY = "camera.preview";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the preview and the bar's controls sit on this surface. */
function cameraGeometry() {
  const W = SCREEN_W;
  const H = SCREEN_H;
  if (COMPACT || TALL) {
    // The bar along the bottom; the preview over it, filling the width.
    const BAR_Y = H - BAR_H;
    const zoom = W / IMAGE_W;
    const previewH = Math.round(IMAGE_H * zoom);
    const previewY = COMPACT ? 0 : Math.round((BAR_Y - previewH) / 2);
    return {
      zoom,
      preview: { x: 0, y: previewY, w: W, h: previewH },
      bar: { x: 0, y: BAR_Y, w: W, h: BAR_H },
      shutter: { x: (W - 88) / 2, y: BAR_Y + 7, w: 88, h: 32 },
      thumb: { x: 10, y: BAR_Y + 6, w: 34, h: 34 },
      switch: { x: W - 54, y: 8, w: 46, h: 30 },
      trash: { x: W - 50, y: BAR_Y + 7, w: 42, h: 32 },
      done: { x: 10, y: BAR_Y + 9, w: 60, h: 28 },
      saving: { x: (W - 88) / 2 + 96, y: BAR_Y + 16, w: 100, right: true },
      note: { x: (W - 280) / 2, y: COMPACT ? 150 : BAR_Y - 44 },
    };
  }
  // Landscape: the preview as tall as the surface, the bar down the right.
  const zoom = Math.min(H / IMAGE_H, (W - 96) / IMAGE_W);
  const previewW = Math.round(IMAGE_W * zoom);
  const previewH = Math.round(IMAGE_H * zoom);
  const barX = previewW;
  const barW = W - previewW;
  const center = (w: number) => barX + (barW - w) / 2;
  return {
    zoom,
    preview: { x: 0, y: Math.round((H - previewH) / 2), w: previewW, h: previewH },
    bar: { x: barX, y: 0, w: barW, h: H },
    shutter: { x: center(88), y: H / 2 - 16, w: 88, h: 32 },
    thumb: { x: center(34), y: H - 50, w: 34, h: 34 },
    switch: { x: center(46), y: 12, w: 46, h: 30 },
    trash: { x: center(42), y: H - 48, w: 42, h: 32 },
    done: { x: center(60), y: 12, w: 60, h: 28 },
    saving: { x: barX, y: H / 2 + 24, w: barW, right: false },
    note: { x: (previewW - 280) / 2, y: H - 60 },
  };
}
const ALL_BUTTONS = 0xffff;

interface Shot {
  name: string;
  /** The thumbnail's texture key, "" until it loads. */
  thumb: string;
  thumbHandle: number;
}

export default function Camera() {
  const g = cameraGeometry();
  const SHUTTER: Box = g.shutter;
  const THUMB: Box = g.thumb;
  const SWITCH: Box = g.switch;
  const TRASH: Box = g.trash;
  const DONE: Box = g.done;
  const press = createPress();
  const alerts = createAlerts(press);
  const [inner, setInner] = createSignal(false);
  /** The preview's texture key, "" while no camera runs. A key per handle:
   *  an Image re-resolves its texture only when its src changes. */
  const [preview, setPreview] = createSignal("");
  const live = () => preview() !== "";
  const [last, setLast] = createSignal<Shot | null>(null);
  /** The review of the last photo: its full view's key, "" while loading. */
  const [review, setReview] = createSignal<{ name: string; key: string; handle: number } | null>(null);
  // `review` and `last` are set as whole new objects; their keyed Shows mount
  // a fresh Image per texture key.
  const [saving, setSaving] = createSignal(0);
  const [note, setNote] = createSignal("");
  let flash: NodeMirror | undefined;
  let noteFrames = 0;

  const open = () => {
    const handle = openCamera({ inner: inner(), scan: false });
    if (handle < 0) {
      setPreview("");
      return;
    }
    const key = `${PREVIEW_KEY}.${handle}`;
    registerTexture(key, handle);
    setPreview(key);
  };
  open();
  onCleanup(() => {
    closeCamera();
    const shot = last();
    if (shot && shot.thumbHandle >= 0) freePhoto(shot.thumbHandle);
    const shown = review();
    if (shown && shown.handle >= 0) freePhoto(shown.handle);
  });

  /** Show `name` in the bar: drop the previous thumbnail, ask for this one. */
  const showLast = (name: string) => {
    const previous = last();
    if (previous && previous.thumbHandle >= 0) freePhoto(previous.thumbHandle);
    setLast({ name, thumb: "", thumbHandle: -1 });
    loadPhoto(name, PHOTO_KIND.thumb);
  };
  const newest = listPhotos()[0];
  if (newest) showLast(newest.name);

  const say = (text: string) => {
    setNote(text);
    noteFrames = 120;
  };

  const shoot = () => {
    if (!live() || review() || alerts.current()) return;
    const job = capturePhoto();
    if (job < 0) return;
    setSaving(saving() + 1);
    if (flash) {
      jump(flash, "opacity", 1);
      animate(flash, "opacity", 0, { dur: 260, easing: "out" });
    }
  };
  const flip = () => {
    if (review() || alerts.current()) return;
    setInner(!inner());
    open();
  };
  const openReview = () => {
    const shot = last();
    if (!shot || review()) return;
    setReview({ name: shot.name, key: "", handle: -1 });
    if (loadPhoto(shot.name, PHOTO_KIND.full) !== PHOTO_PENDING) {
      setReview(null);
      say("That photo could not be opened.");
    }
  };
  const closeReview = () => {
    const shown = review();
    if (shown && shown.handle >= 0) freePhoto(shown.handle);
    setReview(null);
  };
  const askDelete = () => {
    const shown = review();
    if (!shown) return;
    alerts.show({
      title: "Delete Photo?",
      message: "This photo will be deleted from the SD card.",
      action: "Delete",
      run: () => {
        deletePhoto(shown.name);
        closeReview();
        const previous = last();
        if (previous && previous.thumbHandle >= 0) freePhoto(previous.thumbHandle);
        setLast(null);
        const next = listPhotos()[0];
        if (next) showLast(next.name);
      },
    });
  };

  onFrame(() => {
    if (noteFrames > 0 && --noteFrames === 0) setNote("");
    for (const event of photoEvents()) {
      if (event.t === "saved") {
        setSaving(Math.max(0, saving() - 1));
        showLast(event.name);
      } else if (event.t === "loaded") {
        const key = `photo.${event.kind}.${event.handle}`;
        registerTexture(key, event.handle);
        const shot = last();
        const shown = review();
        if (event.kind === PHOTO_KIND.thumb && shot && shot.name === event.name && shot.thumbHandle < 0) {
          setLast({ name: event.name, thumb: key, thumbHandle: event.handle });
        } else if (event.kind === PHOTO_KIND.full && shown && shown.name === event.name && shown.handle < 0) {
          setReview({ name: event.name, key, handle: event.handle });
        } else {
          freePhoto(event.handle);
        }
      } else if (event.t === "error") {
        if (event.job !== undefined) setSaving(Math.max(0, saving() - 1));
        say(event.message);
      }
    }
  });

  const targets = (): Target[] => {
    if (review()) {
      return [
        { id: "review.done", ...DONE, run: closeReview },
        { id: "review.trash", ...TRASH, run: askDelete },
      ];
    }
    const out: Target[] = [{ id: "shutter", ...SHUTTER, run: shoot }];
    if (live()) out.push({ id: "switch", ...SWITCH, run: flip });
    if (last()) out.push({ id: "thumb", ...THUMB, run: openReview });
    return out;
  };
  createTouchRouter({
    surface: "auxiliary",
    press,
    page: () => alerts.touch() ?? { targets },
  });

  onButtonPress(ALL_BUTTONS, (pressed) => {
    if (alerts.key(pressed)) return;
    if (review()) {
      if (pressed & BTN.CROSS) closeReview();
      else if (pressed & BTN.SQUARE) askDelete();
      return;
    }
    if (pressed & (BTN.CIRCLE | BTN.RTRIGGER)) shoot();
    else if (pressed & BTN.TRIANGLE) flip();
    else if (pressed & BTN.SQUARE) openReview();
  });

  const lit = (id: string) => press.is(id);

  return (
    <AuxiliarySurface>
      <View class="relative bg-black overflow-hidden" style={{ width: SCREEN_W, height: SCREEN_H }}>
        {/* the viewfinder */}
        <Show
          when={preview() || null}
          keyed
          fallback={
            <>
              <Image class="absolute w-[32] h-[32]" src="art/switch.svg" style={{ insetL: g.preview.x + g.preview.w / 2 - 16, insetT: g.preview.y + g.preview.h / 2 - 56 }} />
              <Text class="absolute text-sm text-white font-bold text-center" style={{ insetL: g.preview.x, insetT: g.preview.y + g.preview.h / 2 - 14, width: g.preview.w }}>Camera unavailable</Text>
              <Text class="absolute text-xs text-[#ffffffa0] text-center" style={{ insetL: g.preview.x, insetT: g.preview.y + g.preview.h / 2 + 6, width: g.preview.w }}>This console did not start its camera.</Text>
            </>
          }
        >
          {(key) => (
            <View class="absolute overflow-hidden" style={{ insetL: g.preview.x, insetT: g.preview.y, width: g.preview.w, height: g.preview.h }}>
              <Image class="absolute left-0 top-0" src={key} style={{ width: 512 * g.zoom, height: 256 * g.zoom }} />
            </View>
          )}
        </Show>
        <View ref={(node: NodeMirror) => { flash = node; jump(node, "opacity", 0); }} class="absolute bg-white" style={{ insetL: g.preview.x, insetT: g.preview.y, width: g.preview.w, height: g.preview.h }} />

        {/* the review of the last photo */}
        <Show when={review()}>
          <View class="absolute left-0 top-0 bg-black" style={{ width: SCREEN_W, height: SCREEN_H }} />
          <Show when={review()?.key || null} keyed>
            {(key) => (
              <View class="absolute overflow-hidden" style={{ insetL: g.preview.x, insetT: g.preview.y, width: g.preview.w, height: g.preview.h }}>
                <Image class="absolute left-0 top-0" src={key} style={{ width: 512 * g.zoom, height: 256 * g.zoom }} />
              </View>
            )}
          </Show>
        </Show>

        {/* the bar: brushed dark steel, a lit top (or left) edge */}
        <View class="absolute bg-gradient-to-b from-[#5a5d63] to-[#1d1e21]" style={{ insetL: g.bar.x, insetT: g.bar.y, width: g.bar.w, height: g.bar.h }} />
        <View class="absolute bg-[#8a8e95]" style={{ insetL: g.bar.x, insetT: g.bar.y, width: g.bar.y === 0 ? 1 : g.bar.w, height: g.bar.y === 0 ? g.bar.h : 1 }} />
        <Show
          when={!review()}
          fallback={
            <>
              <View
                class={lit("review.done") ? "absolute rounded-[6] bg-gradient-to-b from-[#3b5d9c] to-[#1d3a73] border border-[#0d1a33]" : "absolute rounded-[6] bg-gradient-to-b from-[#5c7fbf] to-[#2c4f93] border border-[#0d1a33]"}
                style={{ insetL: DONE.x, insetT: DONE.y, width: DONE.w, height: DONE.h }}
              />
              <Text class="absolute text-sm text-white font-bold text-center" style={{ insetL: DONE.x, insetT: DONE.y + 6, width: DONE.w }}>Done</Text>
              <View
                class={lit("review.trash") ? "absolute rounded-[6] bg-[#ffffff40]" : "absolute rounded-[6] bg-[#00000000]"}
                style={{ insetL: TRASH.x, insetT: TRASH.y, width: TRASH.w, height: TRASH.h }}
              />
              <Image class="absolute w-[24] h-[24]" src="art/trash.svg" style={{ insetL: TRASH.x + 9, insetT: TRASH.y + 4 }} />
            </>
          }
        >
          {/* the last photo */}
          <View class="absolute rounded-[4] bg-[#111214] border border-[#c9ced6]" style={{ insetL: THUMB.x, insetT: THUMB.y, width: THUMB.w, height: THUMB.h }} />
          <Show when={last()?.thumb || null} keyed>
            {(key) => (
              <View class="absolute overflow-hidden" style={{ insetL: THUMB.x + 2, insetT: THUMB.y + 2, width: THUMB.w - 4, height: THUMB.h - 4 }}>
                {/* the 78 px thumbnail drawn at 30 px: its 128 px texture at 30/78 */}
                <Image class="absolute left-0 top-0" src={key} style={{ width: (128 * 30) / 78, height: (128 * 30) / 78 }} />
              </View>
            )}
          </Show>
          {/* the shutter: a silver pill with the camera on it */}
          <View
            class={lit("shutter")
              ? "absolute rounded-[16] bg-gradient-to-b from-[#9aa0a8] to-[#d8dce2] border border-[#0b0c0e]"
              : "absolute rounded-[16] bg-gradient-to-b from-[#f4f6f8] to-[#a9afb8] border border-[#0b0c0e]"}
            style={{ insetL: SHUTTER.x, insetT: SHUTTER.y, width: SHUTTER.w, height: SHUTTER.h }}
          />
          <Image class="absolute w-[26] h-[26]" src="art/shutter.svg" style={{ insetL: SHUTTER.x + 31, insetT: SHUTTER.y + 3 }} />
          <Show when={saving() > 0}>
            <Text class={g.saving.right ? "absolute text-xs text-[#c9ced6] text-right" : "absolute text-xs text-[#c9ced6] text-center"} style={{ insetL: g.saving.x, insetT: g.saving.y, width: g.saving.w }}>Saving...</Text>
          </Show>
        </Show>

        {/* switch cameras */}
        <Show when={live() && !review()}>
          <View
            class={lit("switch") ? "absolute rounded-[15] bg-[#ffffff60] border border-[#ffffff80]" : "absolute rounded-[15] bg-[#00000070] border border-[#ffffff50]"}
            style={{ insetL: SWITCH.x, insetT: SWITCH.y, width: SWITCH.w, height: SWITCH.h }}
          />
          <Image class="absolute w-[24] h-[24]" src="art/switch.svg" style={{ insetL: SWITCH.x + 11, insetT: SWITCH.y + 3 }} />
        </Show>

        <Show when={note()}>
          <View class="absolute w-[280] h-[26] rounded-[13] bg-[#000000c0]" style={{ insetL: g.note.x, insetT: g.note.y }} />
          <Text class="absolute w-[280] text-xs text-white text-center" style={{ insetL: g.note.x, insetT: g.note.y + 5 }}>{note()}</Text>
        </Show>
        {alerts.view()}
      </View>
    </AuxiliarySurface>
  );
}
