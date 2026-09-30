// SPDX-License-Identifier: GPL-3.0-or-later
// film/tape.ts — the scripted runs. One tape is a frame-indexed function from
// frame number to buttons and touch contacts; the console's capture build
// bakes it in and dumps one frame per index, so a run is a pure function of
// its tape and every frame is reproducible byte for byte.
//
// The same tapes serve three consumers, which is the point: the animations in
// the README, the byte-exact frames in test/goldens/3ds/, and the headless
// replay in test/sim.test.ts. An animation can therefore never show behaviour
// the tests do not pin.

import type { GoldenSpec } from "../../../vendor/pocketjs/tests/golden-specs.ts";
import { BTN } from "../../../vendor/pocketjs/contracts/spec/spec.ts";

/** The shell tape: open three windows, walk the whole chord grammar, then
 *  close a window by touch. 245 frames at 60 Hz. */
export const SHELL_TAPE: GoldenSpec = {
  name: "pocket-shell",
  frames: 245,
  capture: [3, 48, 60, 84, 112, 126, 160, 176, 214, 240],
  // Three dock taps open term, notes and a second term (it stacks under notes:
  // dwindle splits the taller side). Then the shoulder grammar: L + LEFT
  // focuses term with the deck showing the L chord map (frame 60); R +
  // RIGHT swaps term with notes (84); L + START turns the workspace into
  // the scrolling layout (112); L+R + RIGHT lands on the empty workspace 2
  // with the L+R map up (126) and L+R + LEFT returns; L + SELECT opens the
  // key sheet (160); L + A opens the launcher on the deck (176) and B
  // closes it. Last, a hold on term's minimap tile arms the close bar
  // (214) and a slide onto it closes the window (240).
  input: (frame) => {
    let mask = 0;
    if (frame >= 52 && frame <= 66) mask |= BTN.LTRIGGER;
    if (frame >= 56 && frame <= 57) mask |= BTN.LEFT;
    if (frame >= 70 && frame <= 80) mask |= BTN.RTRIGGER;
    if (frame >= 74 && frame <= 75) mask |= BTN.RIGHT;
    if (frame >= 88 && frame <= 98) mask |= BTN.LTRIGGER;
    if (frame >= 92 && frame <= 93) mask |= BTN.START;
    if (frame >= 116 && frame <= 128) mask |= BTN.LTRIGGER | BTN.RTRIGGER;
    if (frame >= 120 && frame <= 121) mask |= BTN.RIGHT;
    if (frame >= 132 && frame <= 140) mask |= BTN.LTRIGGER | BTN.RTRIGGER;
    if (frame >= 134 && frame <= 135) mask |= BTN.LEFT;
    if (frame >= 144 && frame <= 156) mask |= BTN.LTRIGGER;
    if (frame >= 148 && frame <= 149) mask |= BTN.SELECT;
    if (frame >= 164 && frame <= 172) mask |= BTN.LTRIGGER;
    if (frame >= 166 && frame <= 167) mask |= BTN.CIRCLE;
    if (frame >= 180 && frame <= 181) mask |= BTN.CROSS;
    return mask;
  },
  touch: (frame) => {
    // The dock is the bottom 36 px; term, notes and top are 36 px cells
    // from x = 44 (src/deck.tsx DOCK).
    if (frame >= 6 && frame <= 7) return [{ id: 0, x: 62, y: 222 }];
    if (frame >= 16 && frame <= 17) return [{ id: 0, x: 98, y: 222 }];
    // A second term, not top: top shows live fps, and a golden must not.
    if (frame >= 26 && frame <= 27) return [{ id: 0, x: 62, y: 222 }];
    // Hold term's tile on the minimap (scrolling layout: the second
    // column), then slide down onto the close bar and release.
    if (frame >= 186 && frame <= 216) return [{ id: 1, x: 223, y: 117 }];
    if (frame >= 217 && frame <= 222) return [{ id: 1, x: 223, y: 117 + (frame - 216) * 12 }];
    return [];
  },
};

/** Every applet, opened from the dock. An early tape opened only some of
 *  them, and mounting one of the others is what overflowed the guest's JS
 *  stack on hardware — see docs/DESIGN.md, "The depth budget". Top shows a
 *  wall-clock fps, which no pinned frame may contain, so the tape opens it
 *  first and closes it by touch before the last capture. */
export const APPLETS_TAPE: GoldenSpec = {
  name: "pocket-shell-applets",
  app: "pocket-shell",
  frames: 95,
  // Frame 7 lands inside the first dock tap, so it captures the pressed
  // look a painted button needs on a panel with no hover.
  capture: [7, 90],
  touch: (frame) => {
    // top, term, notes: 36 px dock cells from x = 44 (src/deck.tsx DOCK).
    const taps: [number, number][] = [[6, 134], [16, 62], [26, 98]];
    for (const [at, x] of taps) if (frame === at || frame === at + 1) return [{ id: 0, x, y: 222 }];
    // Top holds the left half; hold its minimap tile, slide onto the close
    // bar and let go.
    if (frame >= 36 && frame <= 66) return [{ id: 1, x: 90, y: 117 }];
    if (frame >= 67 && frame <= 72) return [{ id: 1, x: 90, y: 117 + (frame - 66) * 12 }];
    return [];
  },
};

export const TAPES: readonly GoldenSpec[] = [SHELL_TAPE, APPLETS_TAPE];

export function tapeNamed(name: string): GoldenSpec {
  const tape = TAPES.find((candidate) => candidate.name === name);
  if (!tape) throw new Error(`no tape named ${JSON.stringify(name)} (have ${TAPES.map((t) => t.name).join(", ")})`);
  return tape;
}

/** One animation cut out of a tape's frame dump. */
export interface Cut {
  /** media/<name>.gif */
  name: string;
  tape: string;
  /** Inclusive frame range of the dump. */
  from: number;
  to: number;
  /** Keep every nth frame. 1 with fps 30 is half speed, which is what an
   *  eased layout change wants; GIF delays are centiseconds, so 30 fps is
   *  the practical ceiling anyway. */
  step: number;
  /** Playback rate of the encoded animation. */
  fps: number;
  /** What it shows. Becomes the README's alt text. */
  caption: string;
}

/**
 * A cut must show ONE gesture. The deck's whole body swaps when a shoulder
 * goes down — the minimap gives way to that layer's chord map — so a range
 * that reaches into the next gesture puts two of those swaps in one short
 * animation, and at 30 fps that reads as flicker rather than as an
 * interaction. (It did: the first cuts of `chords`, `swap`, `layout` and
 * `workspace` each ran one frame or more into the following chord.)
 *
 * So: the tape's modifiers must be released at both ends of a cut, and may
 * go down and come up at most once inside it. Throws with the offending
 * frames rather than recording something misleading.
 */
export function assertOneGesture(cut: Cut, tape: GoldenSpec): void {
  const held = (frame: number): boolean =>
    ((tape.input?.(frame) ?? 0) & (BTN.LTRIGGER | BTN.RTRIGGER)) !== 0;
  if (cut.to >= tape.frames) {
    throw new Error(`cut ${cut.name}: ends at frame ${cut.to}, past the tape's ${tape.frames}`);
  }
  if (held(cut.from) || held(cut.to)) {
    throw new Error(
      `cut ${cut.name}: a shoulder is still held at ${held(cut.from) ? `its first frame (${cut.from})` : `its last frame (${cut.to})`} — ` +
        "start and end between gestures, or the animation opens or closes mid-chord",
    );
  }
  const edges: number[] = [];
  for (let frame = cut.from + 1; frame <= cut.to; frame++) {
    if (held(frame) !== held(frame - 1)) edges.push(frame);
  }
  if (edges.length > 2) {
    throw new Error(
      `cut ${cut.name}: the shoulders move ${edges.length} times inside ${cut.from}..${cut.to} ` +
        `(at ${edges.join(", ")}) — one cut, one gesture, or the deck flickers between its minimap and its chord map`,
    );
  }
}

/**
 * The animations the README shows, one gesture each. Ranges are read off the
 * tape above and checked by assertOneGesture, which both the recorder and
 * test/tape.test.ts run.
 *
 * Every cut keeps every frame and plays at 30 fps — half of the console's
 * 60 Hz. Geometry here eases rather than cutting, and half speed is what
 * makes that visible; it also stays inside what GIF's centisecond delays can
 * actually express.
 */
export const CUTS: readonly Cut[] = [
  {
    name: "open",
    tape: "pocket-shell",
    from: 0,
    to: 46,
    step: 1,
    fps: 30,
    caption:
      "three dock taps open term, notes and a second term; each window splits the focused leaf along its longer side, and the deck's minimap follows",
  },
  {
    name: "chords",
    tape: "pocket-shell",
    from: 48,
    to: 68,
    step: 1,
    fps: 30,
    caption:
      "holding L turns the deck's minimap into the chord map for the window layer, and the d-pad moves focus while it is up",
  },
  {
    name: "swap",
    tape: "pocket-shell",
    from: 68,
    to: 86,
    step: 1,
    fps: 30,
    caption: "R and the d-pad swap two tiled windows; the geometry eases rather than cutting",
  },
  {
    name: "layout",
    tape: "pocket-shell",
    from: 86,
    to: 114,
    step: 1,
    fps: 30,
    caption:
      "L + START turns the workspace from the dwindle tree into the scrolling strip, keeping window order and focus",
  },
  {
    name: "workspace",
    tape: "pocket-shell",
    from: 114,
    to: 131,
    step: 1,
    fps: 30,
    caption: "L + R makes the d-pad step workspaces; the stage slides and the strip's tab follows",
  },
  {
    name: "keysheet",
    tape: "pocket-shell",
    from: 142,
    to: 162,
    step: 1,
    fps: 30,
    caption: "L + SELECT puts the whole chord table on the stage as a window",
  },
  {
    name: "launcher",
    tape: "pocket-shell",
    from: 162,
    to: 184,
    step: 1,
    fps: 30,
    caption: "L + A opens the launcher on the deck; the d-pad picks and B closes it",
  },
  {
    name: "close",
    tape: "pocket-shell",
    from: 184,
    to: 243,
    step: 1,
    fps: 30,
    caption:
      "closing is a hold, a slide and a release: holding a tile on the minimap arms the close bar, sliding onto it and letting go closes the window",
  },
];

/** Stills the README shows, cut from the same dumps. */
export interface Still {
  name: string;
  tape: string;
  frame: number;
  caption: string;
}

export const STILLS: readonly Still[] = [
  { name: "stage-dwindle", tape: "pocket-shell", frame: 48, caption: "three windows in the dwindle layout" },
  { name: "stage-scrolling", tape: "pocket-shell", frame: 112, caption: "the same windows in the scrolling layout" },
];
