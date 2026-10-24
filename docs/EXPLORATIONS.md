# The shells as explorations of interaction modalities

Pocket Shell has built five shells, each for one way of operating a small
computer. Three are on `main`, two are on the branch
[`archive/3ds-omarchy-ipod-remote`](https://github.com/pocket-nexus/pocket-shell/tree/archive/3ds-omarchy-ipod-remote).
This document names what each one explored, what it taught, and what carried
into the next.

## Windows, a pointer and a keyboard: the desktop OS shell

`shells/desktop/`, on `main`. The shell runs several isolated Pocket apps in
one native process from a Pocket System manifest and owns windows, the
taskbar, launching and themes; PocketJS owns package isolation, scheduling and
composition (winit and wgpu on macOS and Linux, the browser as a preview).
**Three period desktops, Classic 98, XP and Aqua, run on one semantic
shell**: every part, from a caption to a file manager's sidebar, is one slot
the active theme paints and places through its own chrome metrics, and the
window manager hit-tests from the same metrics, so a theme switch keeps every
client rectangle, caret and compositor surface exact. The themes are drawn
from PocketJS primitives and baked fonts; no bitmap of an original ships.

What it taught: a shell can be headless, with its look and its placement
rules both supplied by data. That contract (a slot per part, metrics the hit
test shares) carried into the 3DS kit, where one iOS 6 kit draws every
applet. The desktop shell is the shell Pocket Studio uses, with the System
UI also in Japanese and a text service that runs the same WASM provider in
the browser and on paired devices.

## Full-screen gestures: touch navigation

`shells/touch/`, on `main`. Sixteen retained mock apps on two Home pages, on
the iPod touch 4 (320x480) and the Nokia E7 (360x640 and 640x360). There are
no buttons: a drag pages Home, a swipe up leaves an app, a held lift of 32
points for 220 ms opens the switcher, a swipe along the bottom edge moves
between neighbouring windows, and a card dragged upward closes. **One
continuous deck coordinate drives every stacked card**, and a contact
captures the displayed window pose so the point under the finger stays under
it as the window translates and scales. Release projects velocity to a
destination and a critically damped spring continues from the displayed
position; a transition can be caught mid-flight. Windows covered by an
opaque card above them skip painting, with a mounted-guest pixel comparison
to prove the culling changes no frame.

What it taught: a gesture model written once over `createGesture` and
`createScroller` holds on two devices with different panels and
orientations. The scroller, the kinetic release and the direction lock are
what the 3DS kit's lists and the Tab5's pages use.

## A tiling desktop on two screens: the Omarchy-style 3DS shell (archived)

On the archive branch, `main` at `78b94b2` before it was removed. Tiling
windows on the 3DS's top screen, chords on the shoulder buttons and a deck
of windows on the touch screen, after the Omarchy desktop; its tapes, 26
golden frames, films and hardware screenshots are on the branch, and
release `v2026.10.01` was built from it.

What it taught: the 3DS's two screens want two roles, not one desktop split
across them. The next 3DS shell gave the touch screen the launcher and the
top screen to the system.

## A handheld that controls a desktop: the iPod touch 4 remote (archived)

On the same archive branch. The Omarchy companion mirrored and controlled a
Linux desktop from the iPod over USB or Wi-Fi, with a host daemon, a pointer
helper and a menu snapshot.

What it taught: a handheld paired to a computer wants the computer's
services more than its screen. The pairing and the link stayed; they became
the Pocket Link, over which the 3DS and the Tab5 install applets and reach
the web through a paired Mac.

## A launcher with installed applets: Pocket Home on the 3DS

`shells/3ds/`, on `main`. Pocket Home is the console's launcher on the touch
screen: a springboard of installed applets, Settings (Wi-Fi, pairing a Mac
by QR code, the Mac's app catalog) and a clock set from the Mac over the
Pocket Link. Every applet draws on the touch screen and declares
`system.agent`; the PocketJS host draws Claude's room on the top screen and
**L+R opens the agent over any applet**, which talks or types a request and
then operates the applet. An applet is a Pocket app that meets the applet
rules: one touch surface, an allowlist of capabilities, every network
destination declared, no native code, bundle and pak budgets. Hacker News,
YouTube, X, Discord, Camera, Photos and Notes are the applets; YouTube, X and
Discord reach their services through the linked Mac, which keeps the
accounts.

What it taught: a launcher and a store on a console with one stylus
contact, a d-pad and two shoulders, where the system owns one screen and
the apps the other. The applets' layouts, the iOS 6 kit in `ui/` and the
agent's overlay all carried to the next device unchanged in source.

## One landscape panel, a floating home ball and a keyboard: the Tab5

`shells/3ds/` again, on `main`, through the size classes in
`ui/screen.ts`. The M5Stack Tab5 has one 1280x720 panel that the firmware
presents at **640x360 logical**, 2x, turned onto the portrait panel. Every
program here declares an adaptive surface from 320x240 to 640x720 and
reads its size once at start: `COMPACT` (the 3DS, at or under 320x240) keeps
the layouts drawn for the 3DS, a wider surface lays the iOS 6 apps out
sideways with a Reload button in the bar where the 3DS used buttons, and a
portrait surface (`TALL`) lays them out as phone apps. **The same package
sources build the 3DS and the Tab5 variants** (`bun run tab5`, `bun run
offer`), and a companion offers each console the variant for its target.

The Tab5 has no buttons. The firmware paints a 56-px translucent **home
ball** over the picture: a tap sends SELECT and returns to Home (or summons
the launcher from an app), a finger that moves at once drags the ball
anywhere inside the picture, and a finger that rests ten polls and then
travels 24 px makes a gesture, named by its direction, where an effect
attaches later. The Tab5 keyboard (M5Stack A164, I2C on Ext.Port1) types
through PocketJS's text events: a character commits, a named key arrives as
a `KeyboardEvent.key` name, and an open system-keyboard session takes the
keyboard itself, so the Wi-Fi password field and Notes fill from the keys
without a change in the apps. Notes keeps `notes/<id>.txt` and
`notes/index.json` on the microSD card through the `data.fs` capability.

What it taught: one source lays out for a stylus console and a keyboard
tablet when the surface is read at run time and the host's own controls
(the ball, the keyboard) arrive as the same input the framework already
models. The repaint display without a compositor needed its own animation
class, so Home keeps two sets of transitions and the pinstripes tile a
texture the PPA copies; both are in PocketJS now.
