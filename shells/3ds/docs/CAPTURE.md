# Recording the console

Everything shown in the README is a recording of the shell running, made two
ways: **screenshots come off the real console**, and **animations come off the
emulator, one frame at a time**. Neither is a phone pointed at the screen.

## Screenshots: the dev wire

Pocket Runtime keeps a control channel open on the console (TCP 8131). Ask it
for a screenshot and it sends back both framebuffers, which
`scripts/shot.ts` writes as one PNG — the top screen with the touch screen
centred underneath, the way the console is held.

```sh
bun run pair --host 192.168.1.20   # once, with ftpd running on the console
bun run shot --host 192.168.1.20 --out shells/3ds/media/hw/tiled.png
```

The same channel evaluates an expression in the guest before the shot, and
the app publishes its store as `globalThis.__pocketShell`, so a state worth
photographing can be arranged without pressing anything:

```sh
bun run shot --host 192.168.1.20 \
  --eval "const s=globalThis.__pocketShell; s.open('term'); s.open('notes'); s.open('top')" \
  --out shells/3ds/media/hw/tiled.png
```

The shot waits `--settle` milliseconds (default 900) after the expression
with the connection closed, because an attached client turns on the guest's
DevTools snapshots and their cost would show in top's fps reading.

That is how `media/hw/` was made. It is honest about what it is: those are
photographs of the machine, at the panel's own 400×240 and 320×240, with the
console's own RTC in the bar.

## Animations: the frame recorder

A 60 Hz shell cannot be filmed over a network — the wire delivers a few
screenshots a second, and a video capture of the panel would fight the
console's own refresh. So the animations are not filmed at all. They are
**assembled from a deterministic run**:

1. `bun run 3ds --capture` builds a console binary with an input tape baked
   in (`film/tape.ts`) and a dump window. Nothing is read from the
   filesystem at runtime: the tape is part of the binary.
2. That binary boots in Azahar against a throwaway emulator user directory
   with the settings a reproducible frame depends on pinned — the software
   rasterizer, no upscale, no vsync, and the emulated clock fixed at
   2000-01-01 so the bar's `HH:MM` is the same on every run.
3. Each frame, the guest transfers the PICA200 render target of **both**
   screens to the emulated SD card as raw RGBA, named by the frame counter
   that also indexes the tape. A 245-frame tape leaves 490 files.
4. `scripts/film.ts` reads them back, stacks the two screens into one
   400×480 image, and pipes named ranges of frames straight into ffmpeg as a
   raw stream — one shared palette per animation, so a flat UI stays flat
   instead of banding. Every frame is kept and played at 30 fps, half the
   console's rate: eased geometry is the thing being shown, and GIF's
   centisecond delays cannot express 60 fps anyway.

**One cut, one gesture.** The deck's whole body swaps when a shoulder goes
down — the minimap gives way to that layer's chord map — so a range that
reaches even one frame into the next chord puts two of those swaps in a
two-second animation, and it reads as flicker rather than as an interaction.
The first cuts of `chords`, `swap`, `layout` and `workspace` all did exactly
that. `assertOneGesture` in `film/tape.ts` now refuses a range whose
modifiers are still held at either end or move more than twice inside it;
the recorder calls it before recording and `test/tape.test.ts` calls it
without an emulator.

```sh
bun run film                      # both tapes: stills into media/, animations
bun run film --only=layout        # re-cut one animation
bun run film --tape=pocket-shell  # one tape
```

**A frame is a pure function of its index.** The core steps a fixed dt, the
tape is indexed by the same counter that names the files, and the renderer is
pinned, so two runs of the same tape produce the same bytes. That is what
makes the next part possible.

## The same frames are the tests

`test/goldens/3ds/` holds a handful of frames from those runs as PNGs.

```sh
bun run goldens        # re-run the tapes and byte-compare those frames
bun run film --update  # rewrite them, after looking at what changed
```

So an animation in the README and a golden in the test suite are cut from the
same dump of the same tape. An animation cannot show behaviour the tests do
not pin, and a test cannot pass on a picture nobody has looked at.

Byte-exactness belongs to one emulator build and one renderer;
`test/goldens/3ds/AZAHAR-BUILD.txt` records which, and a mismatch is reported
as a note rather than pretending the frames are comparable.

## What the recorder needs

- macOS with [Azahar](https://azahar-emu.org) installed and launched once (the
  driver clones your settings rather than inventing them)
- `ffmpeg` for the animations
- Docker, for the devkitARM half of the console toolchain

The recorder is GUI-bound: Azahar has no headless mode, only advances the
guest when it owns a window, ignores `SIGTERM`, and does not exit when the
guest finishes — so the driver owns its lifetime and kills it on every path.
Keep it out of CI.

## The iPod companion: rendered, not filmed

The iPod app is a guest, so nothing about a picture of it needs the device or
the Omarchy machine: `hosts/sim` runs the same bundle the iPod runs, at the
panel's own 480×320, and the daemon's half is a handful of JSON lines fed
straight into the store (`applyMock` in `scripts/omarchy.ts` — one 1440×900
monitor, five windows over three workspaces, one floating).

```sh
bun run omarchy shots media    # every screen as a PNG
bun run omarchy films media    # every animation as a GIF
```

A cut scripts touches against the app's own layout tables rather than
hard-coded points, so a moved key or a resized popup moves the finger with it.
Every frame is kept and encoded at 30 fps — half the sim's rate, the same
half-speed the console's animations use, and for the same reason: the easing is
what is being shown. `--only <cut>` records one.

There is no clock on that panel and no live daemon in the loop, so a render is
a pure function of the script. What it cannot show is the desktop's own
response: where a real daemon would echo new geometry, the cut applies the
snapshot the daemon would have sent.
