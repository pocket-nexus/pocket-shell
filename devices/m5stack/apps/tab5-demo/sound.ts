// Interface sounds and the music test, synthesized on the guest and played
// through `globalThis.audio` (audio.pcm). Tones go to one mono stream that
// stays playing; the music test pours a mono stream within its credit.
//
// The synthesis is integer arithmetic over a sine table: QuickJS numbers are
// doubles, and the ESP32-P4's FPU is single precision, so a Math.sin per
// sample costs more than the frame has.
import { AUDIO_RING_FRAMES, audioHost } from "@pocketjs/framework/audio";

const RATE = 22050;
const MUSIC_RATE = 11025;
const FREQUENCIES = Array.from({ length: 128 }, (_, midi) => 440 * Math.pow(2, (midi - 69) / 12));
/** One cycle, 1024 entries, full scale. */
const SINE = Int16Array.from({ length: 1024 }, (_, i) => Math.round(32767 * Math.sin(2 * Math.PI * i / 1024)));
/** Phases are 24-bit fractions of a cycle; the table index is the top 10. */
function increment(midi: number, rate: number): number {
  return Math.round(FREQUENCIES[midi]! / rate * 0x1000000);
}
/** The per-sample Q15 factor that decays to `floor` of the start in `frames`. */
function decay(frames: number, floor: number): number {
  return Math.round(32768 * Math.pow(floor, 1 / Math.max(1, frames)));
}

const tones = new Map<number, Int16Array>();
/** A short tone: a 3 ms attack, then an exponential release; cached. */
function tone(midi: number, millis: number): Int16Array {
  const key = midi * 10000 + millis;
  const cached = tones.get(key);
  if (cached) return cached;
  const frames = Math.floor(RATE * millis / 1000);
  const out = new Int16Array(frames);
  const step = increment(midi, RATE), fall = decay(frames, 0.02);
  let phase = 0, level = 11000;
  for (let i = 0; i < frames; ++i) {
    const attack = i < 64 ? i : 64;
    out[i] = (((SINE[phase >>> 14]! * level) >> 15) * attack) >> 6;
    phase = (phase + step) & 0xffffff;
    level = (level * fall) >> 15;
  }
  tones.set(key, out);
  return out;
}

let sfx = -1;
function sfxStream(): number {
  const ns = audioHost();
  if (!ns) return -1;
  if (sfx < 0) {
    sfx = ns.createStream(RATE, 1);
    if (sfx >= 0) ns.play(sfx);
  }
  return sfx;
}

/** Play notes one after another (MIDI numbers, each `millis` long). */
export function melody(notes: readonly number[], millis = 70): void {
  const ns = audioHost();
  const handle = sfxStream();
  if (!ns || handle < 0) return;
  for (const note of notes) ns.writePcm(handle, tone(note, millis).buffer as ArrayBuffer);
  ns.play(handle);
}

const PROGRESSION = [72, 76, 79, 84, 79, 76];
let progression = 0;
/** A press: the next step of a rising arpeggio, as the vendor demo does. */
export function click(): void {
  melody([PROGRESSION[progression++ % PROGRESSION.length]!], 60);
}

export function up(): void { melody([88], 60); }
export function down(): void { melody([84], 60); }
export function plugged(on: boolean): void { melody(on ? [84, 88] : [88, 84], 80); }

/** Route this tick's audio events to the players that are running. */
export function drainAudioEvents(): void {
  const ns = audioHost();
  if (!ns) return;
  for (let line = ns.poll(); line !== undefined; line = ns.poll()) {
    let event: { t?: string; h?: number; free?: number };
    try { event = JSON.parse(line); } catch { continue; }
    for (const player of players) player.event(event);
  }
}

// ---- players ------------------------------------------------------------------

export interface Player {
  playing(): boolean;
  /** Feed the stream within its credit; call once per frame. */
  pump(): void;
  stop(): void;
}

interface Running extends Player {
  event(event: { t?: string; h?: number; free?: number }): void;
}
const players = new Set<Running>();

/** Play `frames` frames that `fill` writes on demand (interleaved s16 at
 *  `rate`, from frame `offset`), pouring at most 1024 frames a frame within
 *  the stream's credit. */
export function startPlayer(rate: number, channels: number, frames: number,
  fill: (into: Int16Array, offset: number, count: number) => void, onEnd?: () => void): Player | undefined {
  const ns = audioHost();
  if (!ns) return undefined;
  const handle = ns.createStream(rate, channels);
  if (handle < 0) return undefined;
  let cursor = 0, free = AUDIO_RING_FRAMES, started = false, playing = true;
  const self: Running = {
    playing: () => playing,
    pump() {
      if (!playing || cursor >= frames) return;
      const count = Math.min(free, 1024, frames - cursor);
      if (count <= 0) return;
      const chunk = new Int16Array(count * channels);
      fill(chunk, cursor, count);
      const accepted = ns.writePcm(handle, chunk.buffer as ArrayBuffer);
      cursor += accepted;
      free -= accepted;
      if (!started) { ns.play(handle); started = true; }
      if (cursor >= frames) ns.endStream(handle);
    },
    event(event) {
      if (event.h !== handle) return;
      if (event.t === "credit" && typeof event.free === "number") free = event.free;
      else if (event.t === "ended") { self.stop(); onEnd?.(); }
    },
    stop() {
      if (!playing) return;
      playing = false;
      players.delete(self);
      ns.destroyStream(handle);
    },
  };
  players.add(self);
  return self;
}

// ---- music --------------------------------------------------------------------

/** An original eight-bar tune: melody, bass and an arpeggio over
 *  C, A minor, F and G, two bars each, at 112 beats a minute. */
const BEAT = Math.round(MUSIC_RATE * 60 / 112);
const HALF = BEAT >> 1;
const CHORDS = [[48, 60, 64, 67], [45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 59, 62]];
const LEAD = [
  76, 0, 79, 76, 74, 72, 74, 76, 72, 0, 69, 72, 76, 74, 72, 69,
  69, 0, 72, 77, 76, 74, 72, 74, 71, 74, 79, 77, 76, 74, 72, 0,
];
const SONG_BEATS = 64;
const BASS_FALL = decay(BEAT, 0.08), ARP_FALL = decay(HALF, 0.01), LEAD_FALL = decay(BEAT, 0.05);

/** The music test: the tune twice through, about 34 seconds, mono. */
export function startMusic(onEnd?: () => void): Player | undefined {
  let beat = -1, position = BEAT - 1, eighth = 0;
  let bassPhase = 0, bassStep = 0, bass = 0;
  let arpPhase = 0, arpStep = 0, arp = 0;
  let leadPhase = 0, leadStep = 0, lead = 0;
  return startPlayer(MUSIC_RATE, 1, BEAT * SONG_BEATS, (into, _offset, count) => {
    for (let i = 0; i < count; ++i) {
      if (++position === BEAT) position = 0;
      if (position === 0) {
        ++beat;
        const chord = CHORDS[Math.floor(beat / 8) % CHORDS.length]!;
        bassStep = increment(chord[0]!, MUSIC_RATE); bass = 9000;
        const note = LEAD[beat % LEAD.length]!;
        leadStep = note ? increment(note, MUSIC_RATE) : 0; lead = note ? 3200 : 0;
      }
      if (position === 0 || position === HALF) {
        const chord = CHORDS[Math.floor(beat / 8) % CHORDS.length]!;
        arpStep = increment(chord[1 + (eighth++ % 3)]!, MUSIC_RATE); arp = 5000;
      }
      // Bass: sine. Arpeggio: triangle. Lead: square.
      const triangle = (Math.abs((arpPhase >>> 8) - 32768) << 1) - 32768;
      let value = ((SINE[bassPhase >>> 14]! * bass) >> 15) + ((triangle * arp) >> 15) +
        ((leadPhase & 0x800000) ? lead : -lead);
      value = value > 32767 ? 32767 : value < -32768 ? -32768 : value;
      into[i] = value;
      bassPhase = (bassPhase + bassStep) & 0xffffff;
      arpPhase = (arpPhase + arpStep) & 0xffffff;
      leadPhase = (leadPhase + leadStep) & 0xffffff;
      bass = (bass * BASS_FALL) >> 15; arp = (arp * ARP_FALL) >> 15; lead = (lead * LEAD_FALL) >> 15;
    }
  }, onEnd);
}
