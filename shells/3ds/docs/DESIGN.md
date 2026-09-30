# How Pocket Shell is shaped

The README says what the shell is and shows it running. This is the record of
why it is built the way it is: the interaction model in full, the two layouts'
rules, and the two console facts that changed the code — the guest's stack
budget and the console's clock.

## The interaction model

Omarchy binds every window action to `SUPER` plus one key, and `SUPER + K`
shows the table. Pocket Shell keeps the grammar and changes the hardware:

| held | layer | what the other buttons do |
|---|---|---|
| nothing | plain | belong to the focused window's applet |
| **L** | super | act on the focused window |
| **R** | shift | the same verbs, moved: swap, maximize, spawn |
| **L + R** | ws | the d-pad steps workspaces and carries windows |

**The chord map is on the deck, not behind a key.** Pressing a shoulder
replaces the minimap with the table for that layer, labelled per button, and
puts the layer's name in the bar. Releasing brings the minimap back. The
table and the dispatcher read the same array (`chords.ts`), so a label cannot
describe something the button does not do.

**Every chord is also reachable by touch.** Rows of the chord map are tap
targets, and the L and R pills on the strip latch a layer for one action, so a
stylus alone can close a window or switch layouts.

### L — window

| button | action | Omarchy |
|---|---|---|
| d-pad | focus the window in that direction | `SUPER + arrows` |
| circle pad | push the nearest split boundary (dwindle) · column width (scrolling) | `SUPER + -/=` |
| A | the menu (a list on the deck; d-pad ↑↓ picks, A opens, B closes) | `SUPER + SPACE` |
| B | close the focused window | `SUPER + W` |
| X | fullscreen (covers the bar) | `SUPER + F` |
| Y | toggle the split's orientation (dwindle) · cycle column width ⅓ ½ ⅔ 1 (scrolling) | `SUPER + J` |
| START | toggle this workspace between dwindle and scrolling | `SUPER + L` |
| SELECT | the key sheet on the stage | `SUPER + K` |

### R — move

| button | action | Omarchy |
|---|---|---|
| d-pad | swap with the window in that direction | `SUPER + SHIFT + arrows` |
| circle pad | pan the strip (scrolling) | |
| A | another window of the focused app | `SUPER + RETURN` |
| B | reopen the last closed app | |
| X | maximize (keeps the bar and the outer gap) | `fullscreen, 1` |
| Y | swap the split's halves (dwindle) · stack into the left column, or unstack (scrolling) | `swapsplit` |
| START | next wallpaper | `SUPER + CTRL + SPACE` |
| SELECT | toggle the bar | `SUPER + SHIFT + SPACE` |

### L + R — workspace

| button | action |
|---|---|
| d-pad ← → | previous / next workspace |
| d-pad ↑ ↓ | carry the focused window to the previous / next workspace and follow it |

Plain **SELECT** opens the deck keyboard when a term or notes window has
focus. Nothing is bound to **ZL / ZR**: they are New-3DS-only, reach libctru
through `ir:rst` rather than the HID pad, and have no `BTN` constant in
`contracts/spec/spec.ts` yet.

### Touch

- **Workspace strip**: tap a tab to switch; the layout glyph toggles the
  layout; L / R pills latch a layer. As in Omarchy's bar, the active
  workspace is a rounded square instead of its number and empty ones are
  dimmed.
- **Minimap** (the stage at 0.7): tap a window to focus it. **Hold a window
  to arm the close bar**, then release on the bar to close — a resistive
  panel has one contact and an 18 px × is a coin flip, so closing is a hold,
  a slide and a release (the Pocket Term convention). Drag a window onto
  another to swap them, or onto a workspace tab to move it there. Drag the
  gap between two windows to move that split. In the scrolling layout, drag
  the background to pan the strip, or a column's edge to resize it.
- **Dock**: the menu, then **term, notes and top** (tap to open one on the
  current workspace), then the switches **keyboard, keys, wallpaper and
  bar**. Each is a 16 px glyph in a 36 px cell (`src/gen-icons.ts`), drawn
  on the pixel grid at a 1 px stroke after the Material Design shapes
  Omarchy's bar uses. The glyphs carry no labels; the pressed cell fills
  with the accent and names itself above the dock. A 10 px accent mark sits
  under the focused window's app, a 4 px grey one under an app with a window
  elsewhere. A switch that is on draws in the accent.

### The menu

`L + A` or the dock's first cell opens Omarchy's `SUPER + SPACE` card on the
deck: the title `Menu…`, then one row per entry — the three apps, then
**Keys** (the key sheet), **Wallpaper**, **Bar** and **About**. A row is a
glyph, a label and a short description; the selected row carries an 8 %
foreground wash and turns the accent. The d-pad moves by row, A or a tap
runs it, B closes. Omarchy's 50 px rows would fit three to the panel, so rows
here are 20 px and the card border is 1 px.

### Feedback

Anything that cannot happen says why in a notification card at the top right
of the stage for 1.8 s ("nothing left", "workspace 1 is the first", "a split
needs two windows"). As in Omarchy, the card has an accent border and a 2 px
countdown bar along its bottom edge. A focus change is also visible on the
stage: the focused window carries tokyo-night's 2 px active border
(`#7aa2f7`), unfocused windows a grey one (`#595959aa`).

## Motion

**A window is laid out at its placement, and its transform animates.** When
a placement changes, `src/store.ts` computes where the window is drawn at
that moment, sets its `translate` and `scale` so it appears there, and hands
the return to identity to the core's animation tracks (the core's `out`
curve over 200 ms). This is FLIP: the JS runs once, at the change, and no
frame of a transition relayouts the tree or re-evaluates a Solid effect.
An interrupted transition restarts from where it is drawn, because the store
replays the core's curve (`1 − (1 − t)³` over whole 60 Hz frames) to find
that point. Like Hyprland, a resizing window stretches its last frame until
it lands.

The curves follow Omarchy's: a new window pops in from 87 % while it fades
up (`windowsIn … popin 87%`), a closed window's outline shrinks and fades in
170 ms on a linear curve (`windowsOut`), and the close bar rises and sinks
in 100 ms. A workspace switch slides the arriving windows 48 px, which
Omarchy leaves instant; on a 3.5" panel the slide says which way you went.

The earlier version eased every window's `left/top/width/height` in JS on
every frame, so each frame of a transition re-ran the window effects, the
layout pass and the text layout. See "Old 3DS" below for what that cost.

## Old 3DS

Measured on an Old 3DS (268 MHz ARM11, no L2 cache) with the runtime's
`devStats` and a per-frame log of `Date.now()` taken by the store's frame
hook. Both builds run on PocketJS `50b4471b`; "before" is the previous guest.

| three windows, tokyo-night | before | after |
|---|---:|---:|
| layout toggled every 30 frames: mean / longest frame | 90–98 / 270–320 ms | 21.7 / 117 ms |
| idle, term or notes focused: JS per frame | 20–59 ms | 1.7 ms |
| a shoulder press (the chord map comes up) | 269 ms | 34 ms |
| a focus change · a typed character · a `rev` bump that moves nothing | 87 · 75 · 75 ms | 37 · 8 · 18 ms |
| top open: the once-a-second frame | 50 ms | 33 ms |

- **Transitions run on the core's tracks** (see Motion), so JS does no work
  between the first and last frame of a transition.
- **An idle frame bumped `rev`**: `plainInput` ended in `bump()` whenever a
  term or notes window had focus, with or without a key down, so every
  frame re-ran every window. It now returns when nothing was pressed.
- **A `rev` bump stops where nothing changed.** `placements`, `order`,
  `counts` and the dock's open apps compare by value; each window reads its
  own rect, focus, title and content size through value-equal memos; an
  applet edit bumps that window's revision (`appletRev`) instead of `rev`.
- **The deck's bodies stay mounted.** The minimap, one chord map per layer
  and the menu are laid out once and shown by an opacity prop, which
  neither restyles nor relayouts; a hidden one keeps the layout it last
  showed. The keyboard and the key sheet mount on demand: kept laid out,
  their hundred-odd nodes doubled the relayout behind every focus change.
- **top's graph sweeps.** A second's sample lands in one slot, scaled and
  colored through paint-only props, instead of shifting all 32 bars.

What remains: a layout toggle spends about 70 ms of JS in its first frame,
because three windows re-lay out and term re-wraps its lines; a focus
change about 37 ms. A full QuickJS cycle collection pauses the guest for
about 300 ms whenever the heap has grown by half.

## Layouts

Both layouts share the geometry constants in `src/wm.ts`: **`BAR_H` 14,
`GAP_OUT` 4, `GAP_IN` 3, `BORDER` 2** — neighbours sit 6 px apart, the edge
gap is 7 px. Omarchy's `gaps_in 5 / gaps_out 10 / border 2` at a 3.5" panel.

**Dwindle** is a binary split tree. A new window splits the focused leaf
along its longer side and takes the right or bottom half (Hyprland's
`force_split = 2`); a split keeps its orientation when a child closes
(`preserve_split = true`). Resizing walks up from the focused leaf to the
nearest split on that axis whose boundary lies on the pushed side, and moves
that ratio; ratios clamp to 0.15..0.85.

**Scrolling** is a strip of columns wider than the screen. A new window
opens as a column after the focused one at **0.49 of the workspace width**,
so two columns fit (Omarchy's `column_width`). The strip scrolls so the
focused column is fully visible, preferring its right edge. A column holds a
vertical stack of equal-height windows.

**Toggling layouts keeps window order and focus**: dwindle → scrolling makes
one column per leaf in tree order; scrolling → dwindle re-inserts the windows
in strip order, each splitting the one before it.

Each workspace keeps its own layout, fullscreen state and scroll position.
Five workspaces exist from boot; nothing is persisted across launches (the
3DS host has no `fs` module).

## Applets

- **term** — pocketsh, the shell's own `hyprctl`: `ls`, `open <app>`,
  `close [id]`, `focus <id>`, `ws [1-5]`, `layout [dwindle|scrolling]`,
  `wall [next]`, `tz [+8]`, `keys`, `fetch`, `date`, `uptime`, `echo`,
  `clear`. Plain
  buttons: A enter, B backspace, X tab-complete, Y space, ↑↓ history, START
  clear; the circle pad scrolls. 12 px JetBrains Mono on a 7 px cell.
- **notes** — a scratch pad on the same keyboard; A newline, B backspace.
- **top** — the frame loop the way Omarchy's btop reads a machine: fps
  large, a 32-second fps graph (green at 55 and up, yellow from 30, red
  below), then uptime, windows, workspace and host.

The time is in the bar (`Tuesday 22:38`, Omarchy's `dddd HH:mm`) and the
chord table is the key sheet, so neither has a window of its own.

## Files

```
src/wm.ts         the window manager: pure state and geometry (tested)
src/chords.ts     the modifier grammar as one table, plus its labels (tested)
src/shell.ts      pocketsh, the command interpreter (tested)
src/store.ts      signals, per-frame input dispatch, window transitions, applet state
src/stage.tsx     top screen: wallpaper, windows, bar, key sheet, notifications
src/deck.tsx      touch screen: strip, minimap and its gestures, chord map, menu, dock
src/keyboard.tsx  the deck's hand-laid touch keyboard
src/applets.tsx   term · notes · top
src/gen-icons.ts  the deck's 16 px glyphs as pixel art; writes src/icons/ (ignored)
src/icons.ts      every icon path as a literal, which is how the build finds them
src/wall/         tokyo-night backgrounds in 512x256 envelopes (prepare.ts cooks them)
src/images.json   bakes the wallpapers as PSM_5650 and the icons as PSM_8888
```

**Wallpapers are 400x240 crops padded into 512x256**: the pak compiler
accepts power-of-two images only, and the stage clips the padding under an
overflow-hidden root. Three fit in 768 KB at 16 bits per pixel; `R + START`
cycles them.

## The depth budget

**The 3DS spends its JS stack on JSX nesting depth, not node count**
(`vendor/pocketjs/hosts/3ds/src/qjs.c`, `POCKETJS_JS_STACK_SIZE`). A QuickJS call frame is
expensive and mounting descends the tree, so an applet sits at the bottom of
a chain that already runs stage → windows → window chrome → content. Opening
one `keys` window whose rows each carried a wrapper view with a `Show` inside
overflowed the old 192 KiB budget mid-frame, and the runtime rolled the whole
guest back to last-good — which, on a card that also holds Pocket Term, looks
like the shell "turning into" another app.

Two things came out of that. The host budget is now 384 KiB, which is what
the sibling Pocket Term work already found it needed. And **a row here is an
offset, not a node**: `Term` and `Top` render each column as its own flat
pass of absolutely-positioned `Text` under the applet root, three levels
deep, instead of a wrapper view per row. Prefer that shape for any new
applet, and remember an emulator with a generous stack will not warn you —
`film/tape.ts` has an applets tape that opens every applet from the dock
precisely because the first tape never did.

## The clock

**The RTC's epoch is sound; the console's breakdown of it is not.** On
hardware `Date.now()` is monotonic and correct, but `getHours()`
intermittently disagreed with that epoch by whole hours — applying the
timezone on some reads and not others. Two adjacent frames rendered two
different times, which is what "the clock flickers" turned out to be: not a
rendering fault but two wrong readings alternating. Measured on the device,
the big time text changed by ~1600 px between consecutive frames; after the
fix it changes by zero.

So nothing here calls a `Date` breakdown method. `civilFromEpoch` in
`src/shell.ts` derives the whole civil date and time from the epoch by
arithmetic, and the shell reads only that. The zone is sampled once at boot
and accepted only if it looks like a real one (a whole quarter-hour within
±14 h); a console that reports nothing usable shows UTC, and **`tz +8` in
pocketsh states the offset the console could not**.

## Determinism

The bar shows the RTC as `dddd HH:mm`. The recorder pins the emulator's clock
(`init_clock = 1`, `init_time` = 2000-01-01 00:00:00) and launches Azahar with
`TZ=UTC`, because Azahar converts `init_time` through the host's zone. A
recorded run reads `Saturday 00:00` for its first minute on any machine —
which is why the stills in `media/` all show one time and the
photographs in `media/hw/` show the real time. The shell tape
opens a second term rather than top, whose fps reading comes from the wall
clock.
Uptime counts frames, not wall time. See [CAPTURE.md](CAPTURE.md).
