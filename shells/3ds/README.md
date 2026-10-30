# Pocket Shell on the 3DS and the M5Stack Tab5

This shell is **Pocket Home**, the console's launcher, and the **Pocket
Applets** it ships with, built once for the Nintendo 3DS and the M5Stack
Tab5. On the 3DS every applet draws on the touch screen and nowhere else.
The top screen belongs to the system: for each applet (each declares the
capability `system.agent`), the PocketJS 3DS host draws Claude's room
there, and **L+R opens the agent over any applet**. The runtime side (the room, the overlay, the
companion's agent) is PocketJS's and is described in
[POCKET-AGENT.md](../../vendor/pocketjs/docs/POCKET-AGENT.md) in the pinned
submodule. On the Tab5 the same programs lay out for its one landscape panel;
see [The M5Stack Tab5](#the-m5stack-tab5).

| Home | L+R | The agent at work | The reply |
| --- | --- | --- | --- |
| ![Home on the touch screen, Claude's room with the Pocket3D screensaver on the top screen](media/hw/home.png) | ![The choice between Talk and Type](media/hw/ask.png) | ![The agent opens a Hacker News thread under a banner](media/hw/acting.png) | ![The reply card with Talk and Type for the next request](media/hw/reply.png) |

These are screenshots from an Old 3DS. The third and fourth come from one
typed request ("Open Hacker News and tell me what the top story is about"),
which took **30.4k tokens**.

## Home and the applets

An applet is a Pocket app that declares the manifest section `applet` and
meets the applet rules (PocketJS
[APPLETS.md](../../vendor/pocketjs/docs/APPLETS.md)): one touch surface
that admits 320×240, the agent enhanced, an allowlist of capabilities, every network
destination declared (`applet.services`, `applet.hosts`), no native code and
no code evaluation, bundle and pak budgets. The PocketJS build refuses an
applet that breaks a rule, and `bun run check:3ds` runs the rules over every
applet here (`test/applets.test.ts`). Home is the launcher and an app: it
pairs, installs and switches, which applets cannot.

| Program | Directory | Package | Reaches the console |
| --- | --- | --- | --- |
| Pocket Home | `home/` | `dev.pocket-nexus.home`, `home-main` | embedded in the `.3dsx`; the launcher |
| Hacker News | `hn/` | `dev.pocket-nexus.hn`, `hn-main` | installed through Home from the linked Mac, or pushed |
| YouTube | `youtube/` | `dev.pocket-nexus.youtube`, `youtube-main` | the same |
| X | `x/` | `dev.pocket-nexus.x`, `x-main` | the same |
| Discord | `discord/` | `dev.pocket-nexus.discord`, `discord-main` | the same |
| Camera | `camera/` | `dev.pocket-nexus.camera`, `camera-main` | the same |
| Photos | `photos/` | `dev.pocket-nexus.photos`, `photos-main` | the same |
| Notes | `notes/` | `dev.pocket-nexus.notes`, `notes-main` | the same |

`ui/` is the iOS 6 kit Home and the applets build on at the 3DS's 0.82 scale: the
navigation stack and bar, grouped tables, alerts, text fitting, a slot pool
for long lists and one stylus router per screen.

### Surfaces

Every manifest declares an adaptive surface, `app.surfaces.auxiliary.adaptive`
from **320×240 to 640×720**, and lays out at the size the host presents.
`ui/screen.ts` is the one place that reads it (`SCREEN_W`, `SCREEN_H`, set by
`readScreen()` as each program's root component starts) and names the size
classes:

| Class | Surfaces | Layout |
| --- | --- | --- |
| `COMPACT` | the 3DS touch screen, 320×240 | as drawn for it; the sims' 320×240 screenshots stay byte-identical |
| landscape | the M5Stack Tab5's 640×360 (the sims also run 592×360), the PSP's 480×272 | the iOS 6 apps held sideways |
| `TALL` | portrait, such as 360×592 | the iOS 6 phone apps |

On a surface larger than the 3DS's:

- The springboard fits columns of about 96 px and rows of at least 74 px
  (90 px in portrait) over the dock: **six by three** on 640×360, four by
  five on 360×592. Its wallpaper is flat discs on a flat field: an RGB565
  panel draws a smooth gradient this large as visible steps.
- Lists, tables, headers and composers span the width, and each list shows
  as many rows as its height holds.
- A **Reload** button in the bar stands in for the X and Y reload buttons
  (Hacker News, YouTube, X, Discord's servers and channels, Photos), and
  YouTube's player has **-** and **+** for the volume.
- YouTube's player fits the largest 16:9 picture over its control bar;
  Camera's preview is as tall as the surface with its bar down the right
  side; Photos fits as many 80 px columns as the width holds.
- Settings > Wi-Fi scans, joins with a password typed on the keyboard, and
  forgets saved networks on a host whose launcher is its settings
  (`wifiCanJoin()`); the 3DS keeps its saved-slot page.

Icons ship an `@2x` texture beside each 1x one (`home/art/icons/bake.ts`), so
a density-2 build draws them texel for texel. `POCKET_TAB5_SHOTS=<dir> bun run
check:3ds` also writes each program's 592×360 and 360×592 screens.

### The M5Stack Tab5

The Tab5 target is pocket-m5's `programs/m5stack-tab5` with the profile
`tab5-home` (`home.runtime-config.ts`): an ESP32-P4 whose 1280x720 panel
shows the auxiliary surface at **640x360 logical, presented at 2x**, turned
onto the portrait panel. The firmware embeds Pocket Home as its launcher
(`-DPOCKETJS_TAB5_HOME_PACKAGE=<home-main.pocket>`), keeps the installed
applets on the microSD card and boots one runtime per app; the applets
install from the Mac's catalog as on the 3DS. The six pictures at the top of
the repository README are this surface.

- `bun run tab5 [app…]` compiles each app against the Tab5 runtime config
  into `dist/tab5/<output>.pocket`, so its profile hash matches the
  firmware's. The config is read from a
  [pocket-m5](https://github.com/pocket-nexus/pocket-m5) checkout:
  `POCKET_M5_ROOT` when set, else `../pocket-m5` beside this repository.
  `bun run offer` builds both the 3DS and the Tab5 package of
  every applet into `dist/3ds/apps/` and points the running Pocket Companion
  at them, and the companion lists to each console the files with a variant
  for its target.
- The Tab5 has no buttons. The firmware paints a **floating home ball** over
  the picture: a tap sends SELECT (back to Home, or the launcher summoned
  from an app), a finger that moves at once drags the ball inside the
  picture, and a finger that rests and then slides makes a gesture, logged by
  its direction, where an effect attaches later. A touch on the ball never
  reaches a program.
- The **Tab5 keyboard** (M5Stack A164, I2C on Ext.Port1) types through
  PocketJS's text events (`onTextEvent` from `@pocketjs/framework/input`,
  capability `input.text`): a character commits, a named key arrives as a
  `KeyboardEvent.key` name (`Enter`, `Backspace`, `ArrowLeft`). An open
  system-keyboard session takes the keyboard itself, so the Wi-Fi password
  field and Notes fill from the keys with no change in the apps; Notes also
  reads the keys on its editor page. The keyboard's firmware keeps its Ctrl
  bit set once Ctrl was pressed, so the host reads no modifier from it.
- **Installs from a code.** The Tab5 firmware binds `globalThis.installer`
  into the launcher, which downloads a package over Wi-Fi; where it is
  present, the Mac store shows **Scan a Code...**. The scanner reads an
  install URI (pocket-m5
  `programs/m5stack-tab5/components/pocket_system/README.md`, "Installs from
  a code"), closes the camera and shows the app's title and the server's host
  with Install and Cancel; the download's progress, then Open or the
  firmware's error, follow on that page. `home/system.ts` parses the URI,
  starts the download and polls the installer every frame while it runs.
  Either scanner entry takes either code: a pairing code pairs. The 3DS has
  no installer and shows no row.
- **Notes** keeps `notes/<id>.txt` and `notes/index.json` in the applet's
  `data.fs` tree, the microSD card on the Tab5 and the SD card's slot on the
  3DS; it saves a second after the last edit and when its editor closes.
- The Tab5 is a repaint display without a compositor, so its animation class
  is `repaint`: Home keeps a flat wallpaper, cuts where the 3DS zooms and
  wiggles, and its navigation stack cuts where the 3DS slides.

**Home** is the springboard, Settings (Wi-Fi, Mac pairing by QR code, the
Mac's app catalog) and the clock, which reads the Mac's time over the Pocket
Link. The springboard holds **four columns by two rows a page** above a
two-icon dock. Labels are bold 10 px (`text-2xs`), so "Hacker News" and
"Pocket Nexus" fit their 80 px cells; a longer name ends in "...".

- A drag moves the row of pages with the stylus. A flick faster than
  **250 px/s** turns the page; a slower release settles on the nearest page.
  Past the first or last page the row resists (a 160 px pull moves it 69 px).
- The d-pad's left and right turn the page at the grid's edges. L and R do
  not page: a lone shoulder press reaches an app six frames late, because the
  host waits that long for the L+R chord.
- Page dots above the dock follow the drag.

**Icons are rendered at 512 px and finished at their size.**
`home/art/icons/icons.py` models Settings, Hacker News, Wi-Fi and Apps in
Blender as lit objects on lacquer or metal plates, and Mac as a two-tone
lacquer face after the Finder (a raised profile line, enamel eyes and
smile), with few large shapes so they hold at 46 and 24 px. Pocket Nexus is the face "O" of the Pocket
Nexus wordmark, drawn by the wordmark's own code (PocketJS
`apps/nexus/art/draw.js`, run in headless Chrome by `home/art/icons/nexus.ts`).
`home/art/icons/bake.ts` gives all of them one finish (the rounded mask, the
iOS 6 gloss, a lit top rim, a shaded bottom rim and, at 46 px, a drop
shadow), sharpens them after the downsample and writes 24, 46 and 64 px
textures. The build reads the committed
PNGs, so it needs no Blender. Cycles output differs a little between runs, so
a re-render is a new set of pictures to review, not a check.

**YouTube, X and Discord** reach their services through the linked Mac:
each applet fetches `https://companion.pocket/<service>/…`, which Pocket
Companion answers itself (PocketJS `tools/companion/services/`). Accounts,
tokens and tools stay on the Mac; the console never holds them. The
companion answers a service only for an app in its catalog whose manifest
lists that service in `applet.services`, so `bun run offer` comes before
a pushed applet can reach its service; any other request gets 403.

- **YouTube** lists topic feeds and search results from yt-dlp, with
  thumbnails the companion renders into textures. The Mac needs yt-dlp and
  ffmpeg (`brew install yt-dlp ffmpeg`). A New 3DS plays H.264
  through its hardware decoder; an **Old 3DS plays 240×136 at about 12 fps**
  in PAL8 (a fixed 252-colour cube, only changed pixels sent), with sound,
  at 58 to 215 KB/s. Sound needs the console's DSP firmware once: Rosalina
  menu (L + Down + SELECT) > Miscellaneous options > Dump DSP firmware.
- **X** reads the Following and For You timelines and threads through the
  session of an account signed in on the Mac: `bun tools/companion.ts
  service x login` opens a sign-in window there. It uses x.com's web API,
  which X changes without notice. Setup and controls: [docs/X.md](docs/X.md).
- **Discord** reads and sends in the servers a bot is in: create a bot in
  the Discord developer portal, turn on its Message Content intent, then
  `bun tools/companion.ts service discord token <token>`, and `service
  discord status` prints the invite link. Setup and controls:
  [docs/DISCORD.md](docs/DISCORD.md).

**Hacker News** lists Top, New, Best, Ask and Show and opens a thread with
the story and every comment in full. Its requests go through
`@pocketjs/framework/net`, which on the 3DS rides the Pocket Link to the Mac.

## The agent

L+R opens a card over the paused applet with two choices: **Talk (A)** records
until A or Send, and **Type (X)** opens the keyboard; START sends. While the
agent operates the applet the card shrinks to a banner and B stops it. On the
top screen the mascot listens, thinks and types at its own monitor, which
shows the touch screen or the agent's own copy of an applet, and the PocketJS
mark as a screensaver while it rests. A pill in the
bottom-right corner reads "L+R Ask Claude" while the mascot is idle.

The agent needs **Pocket Companion** on the Mac, signed in to Codex: run
`bun tools/companion.ts serve` in a PocketJS checkout, or build the menu bar
app there with `bun run companion:app`. `bun run offer` puts this shell's
applets in the companion's catalog.

## Commands

Run from the repository root.

```sh
bun run deploy --host <console-ip>      # build home-main.3dsx, install it over the wire, restart into it
bun run push --host <console-ip>        # rebuild Home's package and hot-push it
bun run push hn --host <console-ip>     # rebuild Hacker News, install it into its slot and start it
bun run offer [--3ds|--tab5]            # build the applets' 3DS and Tab5 packages and offer them through the companion
bun run shot --host <console-ip>        # one screenshot of both screens
bun run 3ds [home|hn] [--pocket-only]   # build into dist/3ds
bun run tab5 [app…]                     # build packages for the M5Stack Tab5 into dist/tab5
bun run --cwd shells/3ds icons          # re-render and re-bake Home's icons (macOS, Blender 5)
bun run check:3ds                       # typecheck, the Home and Hacker News sims, unit tests
```

A change under `home/`, `hn/` or `ui/` reaches a console with `push`. A
change in the runtime (`vendor/pocketjs/products/3ds`) needs `deploy`. Pairing
needs ftpd once: `bun run pair --host <console-ip>`. The `.3dsx` is the only
console format.

Home's recovery state is in `/pocketjs/runtime/apps/<slot>/`, where the slot
is the first 16 hex digits of the SHA-256 of `dev.pocket-nexus.home`.
