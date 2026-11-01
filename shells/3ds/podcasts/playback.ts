// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/podcasts/playback.ts — the episode playing, outside any page. The
// player page shows it and the show page marks its row; both come and go
// while the stream runs, and the object is kept across a remount
// (ui/keep.ts), so an episode plays on while the reader browses or the
// window's tile changes.
//
// The host plays a companion media stream (`globalThis.media`,
// @pocketjs/framework/media): `start` asks the service for a stream from a
// position and opens it; a seek is a new stream at the new position, as
// YouTube's player does. `poll`, called every sixth frame by the app, reads
// the worker's status into the phase and the position, and writes where
// the episode is to the library every SAVE_EVERY_MS and at every pause, so
// the episode resumes there next time.

import { createSignal, type Accessor } from "solid-js";
import { mediaPlayer, type MediaStatus } from "@pocketjs/framework/media";
import type { PodcastClient } from "./api.ts";
import type { Playing, PodcastModel } from "./model.ts";

export type Phase = "idle" | "starting" | "buffering" | "playing" | "paused" | "ended" | "error";

const SAVE_EVERY_MS = 15_000;
/** An episode stopped this close to its end starts over next time. */
const END_SLACK_S = 10;

export interface Playback {
  /** The media player exists on this host. */
  available: boolean;
  now: Accessor<Playing | null>;
  phase: Accessor<Phase>;
  /** Seconds into the episode. */
  position: Accessor<number>;
  /** The episode's length in seconds; 0 while unknown. */
  duration: Accessor<number>;
  volume: Accessor<number>;
  error: Accessor<string>;
  /** Play `next` from where it stopped last (or `at`). */
  start(next: Playing, at?: number): void;
  /** Pause or resume; after the end or an error, play again. */
  toggle(): void;
  seek(seconds: number): void;
  skip(by: number): void;
  nudgeVolume(by: number): void;
  /** Close the stream and forget the episode. */
  stop(): void;
  /** Read the worker's status; the app calls this every sixth frame. */
  poll(): void;
}

export function createPlayback(client: PodcastClient, model: PodcastModel): Playback {
  const media = (globalThis as { media?: unknown }).media ? mediaPlayer() : null;
  const [now, setNow] = createSignal<Playing | null>(null);
  const [phase, setPhase] = createSignal<Phase>("idle");
  const [position, setPosition] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [volume, setVolume] = createSignal(0.8);
  const [error, setError] = createSignal("");
  let generation = 0;
  let paused = false;
  let savedAt = 0;

  const remember = (seconds: number) => {
    const playing = now();
    if (!playing) return;
    const length = duration() || playing.episode.durationS;
    const done = length > 0 && seconds >= length - END_SLACK_S;
    model.savePosition(playing.episode.audioUrl, done ? 0 : seconds);
    savedAt = Date.now();
  };

  const open = (at: number) => {
    const playing = now();
    if (!playing || !media) return;
    const owner = ++generation;
    paused = false;
    setPhase("starting");
    setError("");
    setPosition(at);
    media.close();
    client.play(playing.episode.audioUrl, at, playing.episode.durationS).then(
      (info) => {
        if (owner !== generation) return;
        if (info.durationS > 0) setDuration(info.durationS);
        setPosition(info.position);
        let opened = false;
        try {
          opened = media.open(info.source);
        } catch (failure) {
          setPhase("error");
          setError(failure instanceof Error ? failure.message : String(failure));
          return;
        }
        if (!opened) {
          setPhase("error");
          setError("The media player is busy. Try again.");
          return;
        }
        media.volume(volume());
        savedAt = Date.now();
      },
      (failure: Error) => {
        if (owner !== generation) return;
        setPhase("error");
        setError(failure.message);
      },
    );
  };

  const seek = (seconds: number) => {
    const length = duration();
    open(Math.max(0, length > 0 ? Math.min(seconds, Math.max(0, length - 1)) : seconds));
  };

  return {
    available: media !== null,
    now,
    phase,
    position,
    duration,
    volume,
    error,
    start(next, at) {
      if (now()) remember(position());
      setNow(next);
      setDuration(next.episode.durationS);
      const saved = model.position(next.episode.audioUrl);
      open(at ?? (next.episode.durationS > 0 && saved >= next.episode.durationS - END_SLACK_S ? 0 : saved));
    },
    toggle() {
      if (!media || !now()) return;
      const p = phase();
      if (p === "ended") return open(0);
      if (p === "error") return open(position());
      if (p === "starting" || p === "idle") return;
      paused = !paused;
      media.pause(paused);
      setPhase(paused ? "paused" : "playing");
      if (paused) remember(position());
    },
    seek,
    skip: (by) => seek(position() + by),
    nudgeVolume(by) {
      const next = Math.round(Math.max(0, Math.min(1, volume() + by)) * 10) / 10;
      setVolume(next);
      media?.volume(next);
    },
    stop() {
      if (!now()) return;
      if (phase() !== "error" && phase() !== "starting") remember(position());
      generation++;
      media?.close();
      client.stop();
      setNow(null);
      setPhase("idle");
      setPosition(0);
      setDuration(0);
      setError("");
    },
    poll() {
      if (!media || !now()) return;
      const status: MediaStatus = media.status();
      if (phase() === "starting" && status.phase === "idle") return;
      if (status.phase === "error") {
        if (phase() !== "error") {
          setPhase("error");
          setError(status.error || "Playback stopped.");
        }
        return;
      }
      if (status.phase === "playing" || status.phase === "paused" || status.phase === "buffering" || status.phase === "ended") {
        setPosition(status.positionMs / 1000);
        const next: Phase = paused ? "paused" : status.phase === "ended" ? "ended" : status.phase === "buffering" ? "buffering" : "playing";
        if (next !== phase()) {
          setPhase(next);
          if (next === "ended") remember(duration() || position());
        }
        if (next === "playing" && Date.now() - savedAt >= SAVE_EVERY_MS) remember(position());
      }
    },
  };
}
