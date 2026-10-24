// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/youtube/views.tsx — the pages of YouTube on the touch screen: a
// list of videos under a Tech/Music/Gaming/News/Search segmented control,
// and the player.
//
// The list is a fixed pool of slots (ui/slots.ts), each a thumbnail texture
// with its duration over it, a two-line title and a line of channel and
// views. The player draws the console's media texture under the bar: an
// H.264 picture fills the 512x256 texture, a PAL8 picture sits in its
// top-left corner, so the picture is scaled to its 16:9 box (320x180 on the
// 3DS, as large as fits over the control bar elsewhere) either way and the
// rest of the texture stays clipped away.

import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { jump } from "@pocketjs/framework/animation";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { createGesture } from "@pocketjs/framework/gesture";
import { Image, Text, View } from "@pocketjs/framework/components";
import { getOps } from "@pocketjs/framework/host";
import { BTN } from "@pocketjs/framework/input";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { createMediaScrubber, mediaPlayer } from "@pocketjs/framework/media";
import type { NodeMirror } from "@pocketjs/framework/renderer";
import { barButtonWidth, NAV_H, type NavButton } from "../ui/bar.tsx";
import { viewHeight, type LayerContext, type NavStack, type PageContent, type PageSpec } from "../ui/nav.tsx";
import { COMPACT, SCREEN_H, SCREEN_W } from "../ui/screen.ts";
import { createSlotPool, paintText, type SlotPool } from "../ui/slots.ts";
import { ellipsize, FONT, toAscii, wrap } from "../ui/text.ts";
import type { Press, Target } from "../ui/touch.ts";
import { durationText, TOPICS, viewsText, type Codec, type PlayInfo, type Video, type YtClient } from "./api.ts";
import type { YtModel } from "./model.ts";

const ROW_H = 64;
const OVERSCAN = 128;
const THUMB_W = 112;
const THUMB_H = 56;
const TEXT_X = 126;
const TITLE_LINE = 16;

/** On a surface larger than the 3DS's, the bar keeps room for a Reload
 *  button right of the segmented control: the touch path for X's reload. */
const RELOAD: NavButton = { id: "list.reload", label: "Reload", kind: "plain", run: () => {} };

export interface YtEnv {
  model: YtModel;
  client: YtClient;
  press: Press;
  keys: Accessor<boolean>;
}

// ---- the segmented control -------------------------------------------------------

const SECTIONS = [...TOPICS.map((topic) => ({ id: topic.id as string, label: topic.label })), { id: "search", label: "Search" }];
const SEG_X = 8;

// Sized to the surface by fitSurface(), which each page calls first.
let W = 320;
let VIEW_H = 204;
let TEXT_W = 0;
let SEG_W = 0;

function fitSurface(): void {
  W = SCREEN_W;
  VIEW_H = viewHeight();
  TEXT_W = W - TEXT_X - 8;
  SEG_W = (W - SEG_X * 2 - (COMPACT ? 0 : barButtonWidth(RELOAD) + 10)) / SECTIONS.length;
}

export function segmentTargets(env: YtEnv): Target[] {
  return SECTIONS.map((section, index) => ({
    id: `section.${section.id}`,
    x: SEG_X + index * SEG_W,
    y: 0,
    w: SEG_W,
    h: 36,
    run: () => env.model.setSection(section.id),
  }));
}

function Segments(props: { env: YtEnv }) {
  const { model, press } = props.env;
  return (
    <>
      <View class="absolute left-[8] top-[5] h-[26] rounded-[5] border border-[#000000] bg-gradient-to-b from-[#5a5a5a] via-[#2e2e2e] to-[#1c1c1c]" style={{ width: SEG_W * SECTIONS.length }} />
      <For each={SECTIONS}>
        {(section, index) => (
          <>
            <View
              class={model.section() === section.id || press.is(`section.${section.id}`)
                ? "absolute top-[6] h-[24] bg-gradient-to-b from-[#b31217] via-[#d41a1f] to-[#e52d27]"
                : "hidden"}
              style={{ insetL: SEG_X + 1 + index() * SEG_W, width: SEG_W - 1 }}
            />
            <Show when={index() > 0}>
              <View class="absolute top-[6] w-[1] h-[24] bg-[#000000]" style={{ insetL: SEG_X + index() * SEG_W }} />
            </Show>
            <Text class="absolute top-[12] text-xs text-white font-bold text-center" style={{ insetL: SEG_X + index() * SEG_W, width: SEG_W }}>{section.label}</Text>
          </>
        )}
      </For>
    </>
  );
}

// ---- video rows -------------------------------------------------------------------

export interface VideoRow {
  video: Video;
  key: string;
  title: string;
  meta: string;
  duration: string;
  y: number;
  h: number;
}

const rowCache = new Map<string, VideoRow>();

function videoRows(videos: readonly Video[], top: number): VideoRow[] {
  return videos.map((video, index) => {
    const y = top + index * ROW_H;
    const cached = rowCache.get(video.id);
    if (cached && cached.y === y && cached.video === video) return cached;
    const row: VideoRow = {
      video,
      key: `video.${video.id}`,
      title: wrap(toAscii(video.title), FONT.smBold, TEXT_W, 2).join("\n"),
      meta: ellipsize(toAscii([video.channel, video.views ? viewsText(video.views) : ""].filter(Boolean).join("  ")), FONT.xs, TEXT_W),
      duration: durationText(video.duration),
      y,
      h: ROW_H,
    };
    if (rowCache.size > 400) rowCache.clear();
    rowCache.set(video.id, row);
    return row;
  });
}

/** One slot of the list's pool: its nodes mount once and the painter moves
 *  it, rewrites its texts and binds its thumbnail for each new row. */
function VideoSlot(props: { env: YtEnv; pool: SlotPool<VideoRow>; slot: number; lit: (key: string) => boolean }) {
  let box!: NodeMirror;
  let wash!: NodeMirror;
  let image!: NodeMirror;
  let title!: NodeMirror;
  let meta!: NodeMirror;
  let badge!: NodeMirror;
  const [key, setKey] = createSignal("");
  const [id, setId] = createSignal("");
  const lit = createMemo(() => key() !== "" && props.lit(key()));
  let y = -1;
  createEffect(() => {
    const on = lit();
    jump(wash, "opacity", on ? 1 : 0);
    jump(title, "textColor", on ? "#ffffff" : "#111111");
    jump(meta, "textColor", on ? "#ffd6d6" : "#8a9099");
  });
  // A thumbnail that arrives after its row was painted binds then.
  createEffect(() => {
    props.env.client.thumbs();
    const video = id();
    getOps().setImage(image.id, video ? props.env.client.thumb(video) : -1);
  });
  onMount(() => {
    props.pool.attach(props.slot, (row) => batch(() => {
      if (!row) {
        if (y >= 0) jump(box, "opacity", 0);
        y = -1;
        for (const text of [title, meta, badge]) paintText(text, "");
        setKey("");
        setId("");
        return;
      }
      if (y < 0) jump(box, "opacity", 1);
      if (row.y !== y) jump(box, "translateY", (y = row.y));
      paintText(title, row.title);
      paintText(meta, row.meta);
      paintText(badge, row.duration);
      props.env.client.want(row.video.id);
      setKey(row.key);
      setId(row.video.id);
    }));
  });
  return (
    <View ref={box} class="absolute left-0 top-0 h-[64] opacity-0 contain-strict" style={{ width: W }}>
      <View ref={wash} class="absolute inset-0 opacity-0 bg-gradient-to-b from-[#e52d27] to-[#b31217]" />
      <View class="absolute left-[124] right-0 bottom-0 h-[1] bg-[#e0e0e0]" />
      <View class="absolute left-[6] top-[4] w-[112] h-[56] bg-[#202020]" />
      <Image ref={image} class="absolute left-[6] top-[4] w-[112] h-[56]" />
      <View class="absolute left-[80] top-[44] w-[36] h-[14] rounded-[3] bg-[#000000c0] flex-col justify-center items-center">
        <Text ref={badge} class="text-xs text-white font-bold">{" "}</Text>
      </View>
      <View class="absolute left-[126] top-[6] flex-col">
        <Text ref={title} class="text-sm text-[#111111] font-bold leading-[16]">{" "}</Text>
        <Text ref={meta} class="mt-[2] text-xs text-[#8a9099]">{" "}</Text>
      </View>
    </View>
  );
}

function Centered(props: { title: string; detail: string; spinner?: boolean; button?: { id: string; label: string }; press: Press; top?: number }) {
  const lines = () => wrap(props.detail, FONT.xs, 260, 4);
  const top = () => props.top ?? 0;
  return (
    <>
      <Show when={props.spinner}>
        <View class="absolute" style={{ insetL: W / 2 - 11, insetT: top() + 40 }}>
          <ClassicSpinner size={22} color={"#8a9099"} />
        </View>
      </Show>
      <Text class="absolute left-0 text-base text-[#4c566c] font-bold text-center" style={{ insetT: top() + 74, width: W }}>{props.title}</Text>
      <For each={lines()}>
        {(line, index) => <Text class="absolute w-[260] text-xs text-[#6d7584] text-center" style={{ insetL: (W - 260) / 2, insetT: top() + 98 + index() * 15 }}>{line}</Text>}
      </For>
      <Show when={props.button}>
        {(button) => (
          <>
            <View
              class={props.press.is(button().id)
                ? "absolute w-[120] h-[30] rounded-[6] border border-[#6f7680] bg-gradient-to-b from-[#9aa1ab] to-[#bfc5cc]"
                : "absolute w-[120] h-[30] rounded-[6] border border-[#9aa1aa] bg-gradient-to-b from-[#ffffff] to-[#dde1e6]"}
              style={{ insetL: (W - 120) / 2, insetT: top() + 160 }}
            />
            <Text class="absolute w-[120] text-sm text-[#d41a1f] font-bold text-center" style={{ insetL: (W - 120) / 2, insetT: top() + 167 }}>{button().label}</Text>
          </>
        )}
      </Show>
    </>
  );
}

/** The search field drawn at the top of the Search section's content. */
const SEARCH_H = 40;

export function listPage(env: YtEnv, stack: NavStack, layer: LayerContext): PageSpec {
  fitSurface();
  const { model, press } = env;
  const searching = () => model.section() === "search";
  const top = () => (searching() ? SEARCH_H : 0);
  const rows = createMemo(() => videoRows(model.state().items, top()));
  const listed = () => model.state().status === "ready" && model.state().items.length > 0;
  const pool = createSlotPool(() => (listed() ? rows() : []), layer.offset, { view: VIEW_H, overscan: OVERSCAN, minRowH: ROW_H });
  const pressedKey = createMemo(() => press.id());
  const focusedKey = createMemo(() => (env.keys() ? layer.focus() : ""));
  const lit = (key: string) => key === pressedKey() || key === focusedKey();
  const byKey = createMemo(() => new Map(rows().map((row) => [row.key, row])));
  const open = (row: VideoRow) => {
    model.open(row.video);
    stack.push("player");
  };
  const step = (by: number) => {
    const at = SECTIONS.findIndex((section) => section.id === model.section());
    model.setSection(SECTIONS[(at + by + SECTIONS.length) % SECTIONS.length]!.id);
  };
  const height = () => top() + (listed() ? rows().length * ROW_H : VIEW_H);

  const content: PageContent = {
    view: () => (
      <>
        <Show when={searching()}>
          <View class="absolute left-[8] top-[8] h-[26] rounded-[13] border border-[#b8bec6] bg-[#ffffff]" style={{ width: W - 16 }} />
          <Text class={model.query() ? "absolute left-[22] top-[13] text-sm text-[#111111]" : "absolute left-[22] top-[13] text-sm text-[#a0a6ae]"} style={{ width: W - 40 }}>
            {model.query() ? ellipsize(toAscii(model.query()), FONT.sm, W - 40) : "Search YouTube"}
          </Text>
        </Show>
        <For each={pool.slots}>{(slot) => <VideoSlot env={env} pool={pool} slot={slot} lit={lit} />}</For>
        <Show when={!listed()}>
          {model.state().status === "error"
            ? <Centered title={model.state().error!.title} detail={model.state().error!.detail} button={{ id: "list.retry", label: "Try Again" }} press={press} top={top()} />
            : model.state().status === "idle"
              ? <Centered title="Search YouTube" detail="Tap the field above and type what to look for." press={press} top={top()} />
              : model.state().status === "ready"
                ? <Centered title="No Videos" detail="Nothing came back for this list." press={press} top={top()} />
                : <Centered title="Loading" detail="Asking YouTube through your Mac." spinner press={press} top={top()} />}
        </Show>
      </>
    ),
    height,
    focusOrder: () => rows().map((row) => row.key),
    targets(contentTop, offset, bottom) {
      const out: Target[] = [];
      if (searching()) out.push({ id: "search.field", x: 8, y: contentTop + 4 - offset, w: W - 16, h: 34, run: () => model.editQuery() });
      if (model.state().status === "error") out.push({ id: "list.retry", x: (W - 120) / 2, y: contentTop + top() + 160 - offset, w: 120, h: 30, run: () => model.reload() });
      if (!listed()) return out;
      for (const row of rows()) {
        const y = contentTop + row.y - offset;
        if (y + row.h <= contentTop || y >= bottom) continue;
        out.push({ id: row.key, x: 0, y, w: W, h: row.h, run: () => open(row) });
      }
      return out;
    },
    span(id) {
      const row = byKey().get(id);
      return row ? [row.y, row.y + row.h] : null;
    },
    activate(id) {
      const row = byKey().get(id);
      if (row) open(row);
      else if (id === "list.retry") model.reload();
      else if (id === "search.field") model.editQuery();
    },
  };

  return {
    title: () => "YouTube",
    backLabel: "Videos",
    tint: "black",
    bare: "white",
    titleView: () => <Segments env={env} />,
    right: COMPACT ? undefined : () => ({ ...RELOAD, run: () => model.reload() }),
    fixedTargets: () => segmentTargets(env),
    content,
    key(pressed) {
      if (pressed & BTN.LTRIGGER) step(-1);
      else if (pressed & BTN.RTRIGGER) step(1);
      else if (pressed & BTN.TRIANGLE) model.reload();
      else if (pressed & BTN.SQUARE && searching()) model.editQuery();
      else if (pressed & BTN.CIRCLE && model.state().status === "error") model.reload();
      else return false;
      return true;
    },
  };
}

// ---- the player -------------------------------------------------------------------

const TRACK_X = 116;
const SEEK_STEP = 10;
/** The control bar under the picture. */
const BAR_H = 24;
/** The volume buttons at the bar's right end where no Up/Down keys are. */
const VOLUME_W = 28;

/** The picture's 16:9 box and the control bar under it: 320x180 under the
 *  bar on the 3DS; elsewhere as large as fits between the bar and the
 *  control bar, centred across. */
function playerGeometry() {
  if (COMPACT) return { videoX: 0, videoY: 36, videoW: 320, videoH: 180, trackW: 192 };
  const videoH = Math.min(Math.floor((SCREEN_W * 9) / 16), SCREEN_H - NAV_H - BAR_H);
  const videoW = Math.round((videoH * 16) / 9);
  return { videoX: Math.round((SCREEN_W - videoW) / 2), videoY: NAV_H, videoW, videoH, trackW: SCREEN_W - TRACK_X - 12 - 2 * VOLUME_W - 8 };
}

/** Shown while the media worker plays muted because NDSP could not start:
 *  the console's SD card has no dump of the DSP firmware. */
const SOUND_HINT =
  "Sound needs the 3DS sound firmware: open the Rosalina menu (L + Down + SELECT) > Miscellaneous options > Dump DSP firmware, then reopen YouTube.";

type PlayerPhase = "starting" | "buffering" | "playing" | "paused" | "ended" | "error";

/** The media worker's status, with the field this PocketJS version adds. */
interface MediaSnapshot {
  phase: string;
  positionMs: number;
  bufferedMs: number;
  presentedFrames: number;
  droppedFrames: number;
  receivedBytes: number;
  audioUnderruns: number;
  h264?: boolean;
  /** False when the console's sound could not start (no DSP firmware). */
  audio?: boolean;
  error: string;
}

/** What a test or the agent reads about playback. */
export interface PlayerProbe {
  codec: Codec;
  phase: PlayerPhase;
  positionS: number;
  info: PlayInfo | null;
  status: MediaSnapshot | null;
}

export function playerPage(env: YtEnv, stack: NavStack): PageSpec {
  fitSurface();
  const { videoX: VIDEO_X, videoY: VIDEO_Y, videoW: VIDEO_W, videoH: VIDEO_H, trackW: TRACK_W } = playerGeometry();
  const BAR_Y = VIDEO_Y + VIDEO_H;
  const TRACK_Y = BAR_Y + 11;
  const { model, client, press } = env;
  const video = model.current();
  const media = (globalThis as { media?: unknown }).media ? mediaPlayer() : null;
  const snapshot = () => (media ? (media.status() as unknown as MediaSnapshot) : null);
  let codec: Codec = snapshot()?.h264 ? "h264" : "pal8";
  const [info, setInfo] = createSignal<PlayInfo | null>(null);
  const [phase, setPhase] = createSignal<PlayerPhase>("starting");
  const [position, setPosition] = createSignal(0);
  const [error, setError] = createSignal("");
  const [volume, setVolume] = createSignal(0.8);
  const [volumeShown, setVolumeShown] = createSignal(0);
  const [preview, setPreview] = createSignal(-1);
  const [muted, setMuted] = createSignal(false);
  const soundHint = createMemo(() => (muted() ? wrap(SOUND_HINT, FONT.xs, VIDEO_W - 28) : []));
  let image!: NodeMirror;
  let generation = 0;
  let paused = false;

  const duration = () => info()?.durationS || video?.duration || 0;

  const start = (at: number) => {
    if (!video || !media) return;
    const owner = ++generation;
    paused = false;
    setPhase("starting");
    setError("");
    setPosition(at);
    media.close();
    client.play(video.id, codec, at).then(
      (playing) => {
        if (owner !== generation) return;
        setInfo(playing);
        setPosition(playing.position);
        if (!media.open(playing.source)) {
          setPhase("error");
          setError("The console's media player is busy. Try again.");
          return;
        }
        media.volume(volume());
        getOps().setImage(image.id, media.texture());
      },
      (failure: Error) => {
        if (owner !== generation) return;
        setPhase("error");
        setError(failure.message);
      },
    );
  };

  const toggle = () => {
    if (!media) return;
    const p = phase();
    if (p === "ended" || p === "error") return start(p === "ended" ? 0 : position());
    if (p === "starting") return;
    paused = !paused;
    media.pause(paused);
    setPhase(paused ? "paused" : "playing");
  };
  const seek = (seconds: number) => start(Math.max(0, Math.min(seconds, Math.max(0, duration() - 1))));
  const scrubber = createMediaScrubber(seek);
  const nudgeVolume = (by: number) => {
    const next = Math.round(Math.max(0, Math.min(1, volume() + by)) * 10) / 10;
    setVolume(next);
    media?.volume(next);
    setVolumeShown(90);
  };

  let frames = 0;
  onFrame(() => {
    if (volumeShown() > 0) setVolumeShown(volumeShown() - 1);
    if (!media || ++frames % 6) return;
    const status = snapshot();
    if (!status || phase() === "starting" && status.phase === "idle") return;
    if (status.phase === "error") {
      if (codec === "h264" && /H\.264/.test(status.error)) {
        // The console has no hardware decoder: the same video as PAL8.
        codec = "pal8";
        start(position());
        return;
      }
      if (phase() !== "error") {
        setPhase("error");
        setError(status.error || "Playback stopped.");
      }
      return;
    }
    if (status.audio === false && !muted()) setMuted(true);
    if (status.phase === "playing" || status.phase === "paused" || status.phase === "buffering" || status.phase === "ended") {
      if (!scrubber.active()) setPosition(status.positionMs / 1000);
      const next: PlayerPhase = paused ? "paused" : status.phase === "ended" ? "ended" : status.phase === "buffering" ? "buffering" : "playing";
      if (next !== phase()) setPhase(next);
    }
    (globalThis as { __pocketYoutube?: PlayerProbe }).__pocketYoutube = { codec, phase: phase(), positionS: position(), info: info(), status };
  });

  onCleanup(() => {
    generation++;
    media?.close();
    client.stop();
  });
  if (media) start(0);
  else {
    setPhase("error");
    setError("This console's runtime has no media player. Update Pocket Home on the console.");
  }

  /** The picture's box: H.264 fills the texture, PAL8 its top-left corner. */
  const imageBox = () => {
    const playing = info();
    const frameW = playing?.frameW ?? 512, frameH = playing?.frameH ?? 256;
    return { width: Math.round((512 * VIDEO_W) / frameW), height: Math.round((256 * VIDEO_H) / frameH) };
  };
  const shown = () => (preview() >= 0 ? preview() : position());
  const fraction = () => (duration() > 0 ? Math.max(0, Math.min(1, shown() / duration())) : 0);
  const clock = () => `${durationText(Math.floor(shown())) === "LIVE" ? "0:00" : durationText(Math.floor(shown()))} / ${duration() ? durationText(duration()) : "--:--"}`;
  const trackFraction = (x: number) => (x - TRACK_X) / TRACK_W;
  // The track scrubs: down previews, a slide moves the preview, the release
  // seeks once (createMediaScrubber). The router gets the same contact and
  // finds no target there.
  let scrubbing = false;
  createGesture({
    surface: "auxiliary",
    onDown(contact) {
      scrubbing = stack.top()?.page === "player" && !stack.busy() && duration() > 0 && phase() !== "error"
        && contact.x >= TRACK_X - 8 && contact.x < TRACK_X + TRACK_W + 8 && contact.y >= BAR_Y && contact.y < BAR_Y + 24;
      if (!scrubbing) return;
      scrubber.begin(trackFraction(contact.x), duration());
      setPreview(scrubber.preview());
    },
    onMove(contact) {
      if (!scrubbing) return;
      scrubber.move(trackFraction(contact.x), duration());
      setPreview(scrubber.preview());
    },
    onUp() {
      if (!scrubbing) return;
      scrubbing = false;
      setPreview(-1);
      scrubber.commit();
    },
    onCancel() {
      scrubbing = false;
      setPreview(-1);
      scrubber.cancel();
    },
  });

  return {
    title: () => ellipsize(toAscii(video?.title ?? "YouTube"), FONT.baseBold, SCREEN_W - 120),
    tint: "black",
    bare: true,
    fixed: () => (
      <>
        <View class="absolute left-0 top-0 bg-[#000000]" style={{ width: SCREEN_W, height: SCREEN_H }} />
        <View class="absolute overflow-hidden bg-[#000000]" style={{ insetL: VIDEO_X, insetT: VIDEO_Y, width: VIDEO_W, height: VIDEO_H }}>
          <Image ref={image} class="absolute left-0 top-0" style={{ width: imageBox().width, height: imageBox().height }} />
        </View>
        <Show when={phase() === "starting" || phase() === "buffering"}>
          <View class="absolute" style={{ insetL: VIDEO_X + VIDEO_W / 2 - 11, insetT: VIDEO_Y + VIDEO_H / 2 - 11 }}>
            <ClassicSpinner size={22} color={"#ffffff"} />
          </View>
        </Show>
        <Show when={phase() === "error"}>
          <Text class="absolute text-sm text-white font-bold text-center" style={{ insetL: VIDEO_X, insetT: VIDEO_Y + VIDEO_H / 2 - 28, width: VIDEO_W }}>Can't play this video</Text>
          <For each={wrap(toAscii(error()), FONT.xs, 280, 3)}>
            {(line, index) => <Text class="absolute w-[280] text-xs text-[#b0b0b0] text-center" style={{ insetL: VIDEO_X + (VIDEO_W - 280) / 2, insetT: VIDEO_Y + VIDEO_H / 2 - 6 + index() * 15 }}>{line}</Text>}
          </For>
          <Text class="absolute text-xs text-[#e52d27] font-bold text-center" style={{ insetL: VIDEO_X, insetT: VIDEO_Y + VIDEO_H / 2 + 46, width: VIDEO_W }}>{COMPACT ? "A to try again" : "Tap to try again"}</Text>
        </Show>
        <Show when={phase() === "ended"}>
          <Text class="absolute text-sm text-white font-bold text-center" style={{ insetL: VIDEO_X, insetT: VIDEO_Y + VIDEO_H / 2 - 10, width: VIDEO_W }}>{COMPACT ? "A to watch again" : "Tap to watch again"}</Text>
        </Show>
        <Show when={muted() && phase() !== "error"}>
          <View class="absolute rounded-[8] bg-[#000000c0]" style={{ insetL: VIDEO_X + 6, insetT: VIDEO_Y + 6, width: VIDEO_W - 12, height: soundHint().length * 15 + 8 }} />
          <For each={soundHint()}>
            {(line, index) => <Text class="absolute text-xs text-white" style={{ insetL: VIDEO_X + 14, insetT: VIDEO_Y + 10 + index() * 15, width: VIDEO_W - 28 }}>{line}</Text>}
          </For>
        </Show>
        <Show when={volumeShown() > 0}>
          <View class="absolute w-[100] h-[24] rounded-[12] bg-[#000000b0]" style={{ insetL: VIDEO_X + VIDEO_W / 2 - 50, insetT: VIDEO_Y + 8 }} />
          <View class="absolute h-[6] rounded-[3] bg-[#ffffff]" style={{ insetL: VIDEO_X + VIDEO_W / 2 - 40, insetT: VIDEO_Y + 17, width: Math.max(2, volume() * 80) }} />
        </Show>
        <View class="absolute left-0 h-[24] bg-gradient-to-b from-[#3a3a3a] to-[#111111]" style={{ insetT: BAR_Y, width: SCREEN_W }} />
        <View
          class={press.is("player.toggle") ? "absolute left-[4] w-[28] h-[20] rounded-[4] bg-[#ffffff30]" : "absolute left-[4] w-[28] h-[20] rounded-[4]"}
          style={{ insetT: BAR_Y + 2 }}
        />
        <Show
          when={phase() === "playing" || phase() === "buffering" || phase() === "starting"}
          fallback={
            <For each={[12, 10, 8, 6, 4, 2]}>
              {(height, index) => <View class="absolute w-[2] bg-[#ffffff]" style={{ insetL: 13 + index() * 2, insetT: BAR_Y + 12 - height / 2, height }} />}
            </For>
          }
        >
          <View class="absolute left-[12] w-[4] h-[12] bg-[#ffffff]" style={{ insetT: BAR_Y + 6 }} />
          <View class="absolute left-[19] w-[4] h-[12] bg-[#ffffff]" style={{ insetT: BAR_Y + 6 }} />
        </Show>
        <Text class="absolute left-[36] w-[76] text-xs text-white" style={{ insetT: BAR_Y + 5 }}>{clock()}</Text>
        <View class="absolute h-[4] rounded-[2] bg-[#5a5a5a]" style={{ insetL: TRACK_X, insetT: TRACK_Y, width: TRACK_W }} />
        <View class="absolute h-[4] rounded-[2] bg-[#e52d27]" style={{ insetL: TRACK_X, insetT: TRACK_Y, width: Math.round(TRACK_W * fraction()) }} />
        <View class="absolute w-[10] h-[10] rounded-[5] bg-[#ffffff]" style={{ insetL: TRACK_X + Math.round(TRACK_W * fraction()) - 5, insetT: TRACK_Y - 3 }} />
        <Show when={!COMPACT}>
          <For each={[{ id: "player.quieter", label: "-" }, { id: "player.louder", label: "+" }]}>
            {(button, index) => (
              <>
                <View
                  class={press.is(button.id) ? "absolute w-[24] h-[20] rounded-[4] bg-[#ffffff30]" : "absolute w-[24] h-[20] rounded-[4] bg-[#ffffff12]"}
                  style={{ insetL: SCREEN_W - 8 - (2 - index()) * VOLUME_W, insetT: BAR_Y + 2 }}
                />
                <Text class="absolute w-[24] text-sm text-white font-bold text-center" style={{ insetL: SCREEN_W - 8 - (2 - index()) * VOLUME_W, insetT: BAR_Y + 3 }}>{button.label}</Text>
              </>
            )}
          </For>
        </Show>
      </>
    ),
    fixedTargets: () => [
      { id: "player.toggle", x: 0, y: BAR_Y, w: 34, h: 24, run: toggle },
      { id: "player.video", x: VIDEO_X, y: VIDEO_Y, w: VIDEO_W, h: VIDEO_H, run: toggle },
      ...(COMPACT
        ? []
        : [
            { id: "player.quieter", x: SCREEN_W - 8 - 2 * VOLUME_W, y: BAR_Y, w: VOLUME_W, h: BAR_H, run: () => nudgeVolume(-0.1) },
            { id: "player.louder", x: SCREEN_W - 8 - VOLUME_W, y: BAR_Y, w: VOLUME_W, h: BAR_H, run: () => nudgeVolume(0.1) },
          ]),
    ],
    key(pressed) {
      if (pressed & BTN.CIRCLE) toggle();
      else if (pressed & BTN.LEFT) seek(position() - SEEK_STEP);
      else if (pressed & BTN.RIGHT) seek(position() + SEEK_STEP);
      else if (pressed & BTN.UP) nudgeVolume(0.1);
      else if (pressed & BTN.DOWN) nudgeVolume(-0.1);
      else return false;
      return true;
    },
  };
}
