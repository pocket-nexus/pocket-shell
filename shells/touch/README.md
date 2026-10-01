# Pocket Shell Touch

A PocketJS navigation demo for iPod touch 4 (320 × 480 logical points) and
Nokia E7 (360 × 640 portrait or 640 × 360 landscape).
Sixteen retained mock apps share two Home pages: Today, Music, Places, Weather,
Notes, Photos, Mail, Calendar, Clock, Safari, Files, Settings, Camera, Health,
Books and Calculator. They contain sample content and do not connect to external
services. **Cold launch opens the first Home page**, with the mock apps retained in the background.

<img src="media/home.png" width="240" alt="Four-column Home grid and fixed four-app dock" /> <img src="media/home-second.png" width="240" alt="Second Home page with four apps and two information cards" /> <img src="media/quick-switch.png" width="240" alt="Equal-size live windows during a bottom-edge quick switch" />

These product screenshots show both Home pages and a held quick switch on iPod
touch 4. Per-run captures and telemetry remain in ignored validation output.

| Input | Result |
| --- | --- |
| Swipe horizontally on Home | Follow the finger between two pages, then spring to the chosen page; the dock stays fixed |
| Swipe up from an app, then release | Minimize the current app and return to the desktop |
| Lift from an app and hold for 220 ms before releasing | Stay in the app switcher |
| Lift the desktop bottom bar, then release | Peek from the left while held, then spring into the switcher |
| Swipe along the bottom edge | Move equal-size neighboring windows together, then spring the chosen window into place |
| Drag across the switcher | Browse overlapping cards with parallax and a spring snap to center |
| Swipe a switcher card upward | Close that window; reverse or cancel to restore it |
| Tap a desktop icon | Expand that app from its icon |
| Drag within an app | Scroll its retained content with inertia and edge resistance |
| Tap Today content | Open its detail view |
| Drag from the detail's left edge | Follow the finger back; reverse to cancel |
| Catch a closing window and drag down | Enlarge it and return to the app |

**Home uses four columns and a fixed four-app dock.** Eight icons occupy the
first page; Camera, Health, Books, Calculator and two information cards occupy
the second. One continuous page coordinate moves both pages, interpolates the
page dots and offsets the wallpaper. A six-point direction lock separates
paging from vertical drags. Release projects velocity to choose a page; edge
resistance bounds travel outside the first and last pages. Catching the spring
keeps its displayed position. Icon taps require the same icon at press and
release, using the icon's displayed position. Opening an icon retains its Home
page. A minimizing window targets its icon when that icon belongs to the
retained page or dock. An app opened from the switcher whose icon belongs to
another page shrinks toward the current page's upper center and fades out.

**A contact captures the displayed window pose.** Its local contact point
remains under the finger as translation and scale change. Bottom-edge
navigation combines horizontal and vertical travel in the same equation. The switcher resolves direction after six points of travel and keeps
that direction until release: horizontal browsing cannot dismiss a card, and
vertical dismissal cannot page the deck. Release chooses a destination
and a critically damped spring continues from the displayed position and
velocity. Cancellation restores the contact's original destination. A second
finger cannot replace the active contact.

**One continuous deck coordinate drives every stacked card.** The grabbed
content point follows horizontal input; cards to its left move less and cards
to its right move more. The same coordinate springs to a centered card on
release. Residual springs preserve each displayed pose when a transition is
caught or a neighbor closes. Paint order and hit order follow the same stack.
Windows covered by the opaque interior of a higher card skip painting. Rounded
corners and translucent cards remain outside that coverage test; hidden content
stays mounted. A mounted-guest pixel comparison checks that culling preserves
the rendered frame.

**The rightmost card is the most recently opened app.** Opening a desktop icon,
opening a switcher card, or completing a quick switch moves that app to the end
of the open-window order. Browsing the switcher does not change recency.
Opening the switcher from Home centers that rightmost window, even if the
previous switcher visit ended while browsing an older card.

Bottom quick switching uses a separate row with a 12-point gap. Both windows
share scale, height and translation while the finger is down and while the
release spring settles. Consecutive quick switches retain that row's order, so
reversing direction returns to the previous app even after recency changes.
Returning Home or using app content ends that quick-switch chain.

**An upward release from an app defaults to Home after 18 points of travel.**
There is no release-speed requirement. The switcher requires at least 32 points
of lift and a 220 ms hold within a five-point position window. Renewed travel
clears the hold. Background cards stay hidden during an ordinary swipe and
fade into their compact poses during the hold preview. Only the current app
shrinks to its desktop icon on the Home transition.

Desktop entry starts with full-opacity cards outside the left screen edge, at
their switcher size and height. **A held lift reveals at most 48 logical points
of the deck.** Increasing travel adds resistance, independent of the number of
open windows. Reversing the contact takes it back out through the same edge.
Release after 32 points of lift springs the deck into the switcher, preserving
its displayed position and velocity.

The input uses PocketJS `createGesture`, as Pocket Clear does. Content uses
`createScroller`; windows use batched native property updates. Windows and
content remain mounted across destinations. A separate ordered set tracks open
windows. Closing removes the card from hit testing, paging and quick switch;
its content stays mounted. A desktop icon reopens it without duplicate entries.
An empty deck offers a return to the desktop. **Opening an icon or switcher card
expands only that app to full screen.** Neighboring cards keep their compact
geometry and fade out.
**Text cells scale with their positions** through the core's atlas-backed `TEX_QUAD` path. No bitmap screenshot
replaces a live card during the gesture.

## Build and run

Run from the pocket-shell repository root:

```sh
bun run setup
bun run touch guest
bun run check:touch
export POCKETJS_IPODTOUCH4_UDID=<connected-iPod4,1-UDID>
bun run touch doctor
bun run touch deploy
bun run touch launch
bun run touch status --require-action
bun run touch capture
```

With `bun run touch tunnel` active, `bun shells/touch/test/device.ts` injects
UIKit contacts and checks window actions on the device. Pass `--motion-only`
to repeat the Photos/Notes/Music deck motion without screenshots during the
sampling windows. Per-journey `postCaptureFps` includes screenshot overhead;
use `quickFps`, `stackFps` and `homeFps` for continuous-motion cadence.

The shell owns its app, sixteen mockups, gesture model, assets and tests.
The Omarchy companion remains in `shells/ipod`. The shared runtime, renderer,
UIKit host and installer come from the pinned `vendor/pocketjs` submodule.

`ipodtouch4.json` supplies the external-app descriptor to PocketJS. The native
bundle is `PocketShellTouch.app`; `pocketjs-shell-touch://launch` opens it and
`shell_touch_gesture` identifies completed actions. The installed package ID
`dev.pocket-nexus.fluid` remains stable so deployment updates the existing app
and retains its User container. It is a compatibility identifier, not the
shell's display name.

### Nokia E7

The E7 uses the Symbian host in the pinned PocketJS mainline runtime. **The
viewport follows the native orientation.** Portrait centers the four-column
grid and app content; landscape places app content to the right of its title.
The dock and gesture bar stay at the bottom. Wallpaper preserves its aspect
ratio and covers the viewport.

The same navigation model drives both devices. Window dimensions, icon hit
targets, minimizing destinations, deck positions and content extents use the
current viewport. Rotating cancels the previous contact before its release can
commit an action, then retains open-window order, selected app and Home page.
The Shell package requests a **60 Hz host timer** and sends the wide touch
format so coordinates beyond 511 reach the guest. The generic E7 host default
remains 30 Hz; the Shell build passes `--frame-rate 60`.

With the phone connected in Nokia Suite mode and CODA available:

```sh
bun run touch:e7 setup
bun run touch:e7 doctor
bun run touch:e7 build
bun run touch:e7 deploy
bun run touch:e7 launch
bun run touch:e7 status
```

Build uses the PocketJS Docker toolchain and writes the signed SIS and receipt
to `.pocket-build/symbian/touch/`. Deploy creates a local Python environment
with PyUSB 1.3.1, transfers the SIS through CODA in 1 KiB router frames, reads
back its bytes, stops this package's old process, installs it and queries the
installed package. The staging filename contains the package UID and build
hash; repeated deployments can replace that file. The host needs Python 3.9+
and libusb, which `doctor` checks as part of the USB tooling.

The package UID is `0xEA360236`; its executable is
`PocketJsPocketshellToucEA360236.exe`. `status` reports package version and
matching processes. **A running process does not prove a rendered frame or
physical touch response.** Mounted-guest tests exercise both native dimensions,
all sixteen icons, the wide touch wire and rotation cancellation; physical
screen and gesture checks remain device acceptance steps.

### E7 performance replay

The painter retains all app nodes and skips unchanged property writes. Settled
springs stop before evaluating their exponential. Neither optimization changes
contact positions, spring targets, or animation timing.

Build the diagnostic SIS with the pinned PocketJS toolchain and install it
before profiling:

```sh
bun vendor/pocketjs/tools/symbian.ts build app --manifest shells/touch/pocket.json \
  --project-root shells/touch --outdir .pocket-build/validation/touch/e7-performance \
  --sis-version 0.3.68 --frame-rate 60 --perf-trace
```

Use matching viewport dimensions and keep the phone in that orientation during the run.
Replay builds fix orientation to the manifest's initial viewport. The analyzer
rejects inactive-window samples, mismatched viewport dimensions, missing replay,
non-finite timing values and incomplete or unordered frame rows; pass the
same width and height to `make` and `analyze` for landscape workloads.

```sh
bun shells/touch/scripts/e7-perf.ts make .pocket-build/validation/touch/e7-performance/input.tsv 360 640
.pocket-build/symbian/touch/usb-python/bin/python -B shells/touch/scripts/e7-device.py profile \
  --uid 0xEA360236 --executable PocketJsPocketshellToucEA360236.exe \
  --input .pocket-build/validation/touch/e7-performance/input.tsv \
  --trace .pocket-build/validation/touch/e7-performance/trace.tsv \
  --shot .pocket-build/validation/touch/e7-performance/frame.png
bun shells/touch/scripts/e7-perf.ts analyze .pocket-build/validation/touch/e7-performance/trace.tsv
```

The 30-second virtual-clock replay includes Home paging, app-to-Home minimization and the
switcher. It reports the first app-to-Home gesture apart from repeated gestures,
so first-use resource uploads remain visible. The summary excludes settled pauses
from paging and minimization. Pass `all-apps` after the width and height to both
`make` and `analyze` to open and minimize every mock app across both Home pages.
`deck-dismiss` covers browsing the deck and returning Home. The analyzer rejects
touch counts that differ from the selected replay, including extra real contacts.
Input advances with the framework's frame clock, preserving the same contact
sequence when a frame is slow. FPS and stage durations use wall time; the
device script allows 90 seconds for boot, warmup, collection and the screenshot.
It reports frame intervals and CPU wall times for JavaScript, core ticks,
GLES submission and presentation. Presentation includes GLES submission;
these measurements do not separate GPU execution or display scanout. Replay
starts at the native packed-input boundary, below the guest input dispatcher.
Physical touch delivery still needs a manual check.
`src/window-painter.ts` owns named batch bindings and retained paint values;
`Navigation` owns gesture state, poses and occlusion bounds. The painter
translates fixed-size clipping containers, avoiding layout
work when an occluding edge moves. It clips app content behind opaque windows
while retaining each background's rounded fringe. The pinned renderer retains
scaled glyph sampling under the moving scissor. Window poses remain live;
clipping does not change navigation state or animation targets.
The diagnostic runtime keeps the device awake for five minutes and saves the
optional screenshot after measurement. Normal builds keep device sleep enabled.

## Validation

```sh
bun run check:touch
bun run touch tunnel
# In another terminal, with the tunnel running:
bun run --cwd shells/touch test:device
```

Model tests cover Home paging, resistance at both edges, interrupted page springs,
page-aware icon hit testing, Home versus held overview intent, bounded desktop peeking,
reversal, cancellation, release velocity, recency, equal-size quick switching,
stack parallax, direction locking, dismissal and reopening. The mounted guest
checks actual touch dispatch, all sixteen icons, both Home pages, the fixed
dock, retained content, paint bounds and pixel parity with and without occlusion culling.

The device test compiles its UIKit event sender for this descriptor's bundle
ID. It checks build identity, touch completion, actions, screenshots and frame
timing, then removes the sender. Outputs stay in ignored
`.pocket-build/validation/touch/<run>/`; `POCKET_SHELL_TOUCH_OUTPUT` selects a
run directory. **Injected device input does not measure physical touch-to-photon
latency.** Human touch feel remains a separate acceptance check.

The Home screen uses sixteen [Blender-baked icons](art/README.md) and a
[wallpaper](src/art/wallpaper.png) with supersampled curves and a continuous
gradient. The normal E7 package keeps the mock apps and the 60 Hz host setting.
Original shell code and artwork are GPL-3.0-or-later.
