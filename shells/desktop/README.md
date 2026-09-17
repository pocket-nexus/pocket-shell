# Pocket Shell Desktop

Pocket Shell Desktop is the desktop OS shell in [Pocket Shell](../../README.md).
On macOS the standalone **Pocket Shell.app** opens an Aqua desktop with a
Files, Devices and Minesweeper applications. Linux and the browser also include the demo app catalog.
All targets share the same desktop, headless window chrome and theme system,
using SolidJS and PocketJS's universal renderer.

## macOS Devices

```sh
bun run setup
bun run desktop build
open "shells/desktop/dist/Pocket Shell.app"
bun run desktop test:macos
```

The app can be moved into Applications and launched without Bun, Homebrew or
a repository checkout. It reuses SHERU's macOS icon unchanged and is locally
ad-hoc signed. Release signing and notarization are separate from this build.
The macOS System contains only `dev.pocket-stack.desktop.system-ui`, using the
same `main.tsx` desktop entry as Linux and web. Files, Devices and Minesweeper
are built-in windowed applications; the eleven external demo packages are
omitted from the Mac installation.
Its headless navigation model and client view use the shell's existing theme,
window controls, focus routing, menu bar and Dock. Device discovery is polled
once by the shell and shared across windows, with independent selection state.

The desktop opens Files, Devices and Minesweeper together at startup, with
staggered windows and separate Dock entries. Double-click a desktop icon or
choose an app from the logo menu to reopen it. **Cmd+M** minimizes, **Cmd+W**
closes the focused window and **Cmd+`** cycles visible windows. The Dock
switches apps and restores minimized windows without resetting their state.

Files reuses the Finder-style toolbar, places sidebar and details list. Its
Pocket Shell, Applications, Documents and Trash places are the shell's sample
directories, not the Mac filesystem. Double-click a folder or use **Enter** to
open the selected row; the toolbar and Go menu navigate back, forward and up.
Applications launches the three built-in apps; Documents contains a welcome
text that opens in the existing Notepad viewer. **Cmd+N** opens another Files
window at the current directory, or a new Devices window when Devices is
focused. Each window keeps its own selection and navigation history.

Minesweeper restores the 9-by-9 game: click to reveal, right-click to flag,
and use **F2**, **Cmd+N**, the smiley or **Game → New** to start again.

Expand **Devices** in the window sidebar to see supported USB hardware attached
to this Mac. Select a device to see its family, connection mode and serial when available.
PSP USB storage (`054c:01c8`), PSP PSPLINK (`054c:01c9`) and iPod touch 4
(`05ac:129e`) are recognized. Other USB devices are omitted. The inventory
refreshes every second; removed devices and expired companion snapshots are
cleared. Refresh also runs with **Cmd+R**. Arrow keys navigate the list;
**Escape** or the **Overview** toolbar item returns to the overview. Choose
**Appearance** in the logo menu or use **Cmd+Shift+T** to cycle Aqua, Classic 98
and Windows XP; windows keep their state and client geometry.

The native launcher reads IOKit USB registry properties without claiming an
interface, starting a bridge or changing anything on a device. Connection
means the hardware is present; it does not certify installed firmware or a
running PocketJS guest. The companion binds an ephemeral loopback port and
sends bounded snapshots over PocketJS's existing PKNT channel. It lives with
the app and requires no background installation.

`bun run desktop test:macos` checks package contents, the icon, signature,
device filtering and the native wire protocol. Simulator tests cover listing,
collapse/expand, selection, refresh, removal, stale connection state, desktop
launching, window movement and resizing, Dock restore, close/reopen, independent
window state and theme switching. The multi-app journey also checks Files
navigation and history, independent file windows, playable Minesweeper and
game-state preservation through Dock switches.
Native screenshots require macOS Screen Recording permission; simulator
renders are not native-window captures.

## Blender application icons

Files and Devices use original Cycles-rendered objects: a folded blue cardstock
folder with paper sheets and a metal label holder, and a brushed-aluminium USB
hub with a rubber cable and metal connector. Their silhouettes, bevels, contact
shadows and material highlights come from geometry and studio lights.

The [scene recipe](assets/icons/render.py) rebuilds the complete editable scenes
and renders transparent masters. To rebake with Blender 5.1 and Pillow:

```sh
python3 shells/desktop/assets/icons/render.py --publish
```

`BLENDER` can point to another Blender executable. The recipe writes `.blend`
scenes and large renders under `.pocket-build/validation/blender-icons/` and
publishes six reviewed PNGs at 16, 32 and 64 px. Normal builds only copy the
bakes into the icon pack, including Retina variants. Application artwork is
resolved through the theme for desktop icons, Dock, captions and menus;
ordinary folder symbols keep each theme's own artwork.

## Desktop themes

Pocket Shell Desktop ships three System UI themes: Classic 98, Windows XP and Aqua.
Each is a period desktop rebuilt from PocketJS-native drawing — no bitmaps of
the originals, no theme-specific code paths outside the theme's own
definition. **All three run on the same System manifest, AppInstances and
native compositor.**

| Classic 98 | Windows XP | Aqua |
|---|---|---|
| ![Pocket Shell Desktop classic theme](docs/classic-theme.png) | ![Pocket Shell Desktop XP theme](docs/xp-theme.png) | ![Pocket Shell Desktop Aqua theme](docs/aqua-theme.png) |

- **Classic 98** — hard two-ring bevels, 18px captions, a 28px taskbar with
  the Start rail menu, the W95FA bitmap face, native 32px pixel-art desktop
  icons and Explorer's coolbar and "Folders" pane in the file manager.
- **Windows XP** — Luna chrome: three-stop gel gradients under 1px
  highlight and seat strips, top-rounded window frames, the two-column Start
  panel (user header, pinned programs, places, Turn Off Computer), a baked
  green Start pill, softly shaded Luna-style vector icons, and the Explorer
  task pane with its "Other Places" card. Text is baked from Inter, since
  Tahoma cannot be redistributed.
- **Aqua** — gel traffic lights on the left of a glossy caption
  that goes matte when unfocused, the menu bar hoisted to a 22px screen bar
  (launcher logo, program name, menus, clock), a translucent Dock, desktop
  icons hanging from the right edge, blue-gradient highlights, pale-blue text
  selection, white gel push buttons, and Tiger's toolbar pills, breadcrumb,
  round search well and sidebar in the file manager. Its lights and small
  gels are baked artwork, because the renderer bands gradient fills inside
  small rounded boxes.

The shell underneath is headless: every part — caption, control cluster, menu
bar, launcher, task strip, popups, selections, dialogs, the file manager's
toolbar and places sidebar — is one semantic slot the active theme fills with
its own paint and, through its chrome metrics, its own placement (controls
left or right, menus in the window or on the screen bar, a task strip or a
Dock). The window manager hit-tests from the same metrics, so switching
themes keeps every client rectangle, caret and compositor surface exact. The
Pocket app icon is the PocketJS favicon mark, cut from Aqua silver-and-blue
or Luna silver per theme.

Choose a theme from **Start → Settings** (the logo menu on Aqua), or press
**Cmd+Shift+T** to cycle while testing.

## Architecture

```text
pocket.system.json
  ├─ roles.systemUI → dev.pocket-stack.desktop.system-ui
  ├─ installation snapshot
  └─ installed Pocket app catalog
             ↓
      ResolvedSystemPlan
             ↓
  PocketJS portable desktop host
      ├─ winit + wgpu: window, input and GPU presentation
      ├─ runtime worker: SolidJS AppInstances + AppSupervisor
      │   └─ shared Rust layout + pocket-ui-wgpu drawing and surface composition
      └─ io.offload workers: portable Rust text service
          └─ the same WASM provider serves browser and paired devices
```

The System UI is in `src/system-ui`. Demo applications are consumed from the
pinned `vendor/pocketjs` submodule and are not copied into this product.

The experimental framework implementation is pinned directly in
`vendor/pocketjs` from [PocketJS PR #399](https://github.com/pocket-stack/pocketjs/pull/399),
which adds GPU composition on top of [PR #390](https://github.com/pocket-stack/pocketjs/pull/390). A fresh `setup` uses
that exact published commit; no checkout-local patches are applied.
The desktop host no longer links gpui, CoreText or Fontconfig. Native window
APIs handle the window, input and clipboard. The existing `pocket-ui-wgpu`
backend draws through Metal on macOS, retaining child textures and handing GPU
frames to the window thread. WASM keeps the Rust software rasterizer.

Notepad sends revisioned incremental edits through `io.offload`; Rust performs wrapping
on a worker and returns bounded pages. Rendering and hit testing share an
accepted source/geometry snapshot. Long documents render only visible rows.
The OpenType service uses COSMIC Text/Harfrust/Swash with explicitly supplied
font bytes, including on WASM. No system font discovery occurs.

See [the text capability and companion contract](docs/PORTABLE-TEXT.md) for
pairing, budgets, current limits and validation.

## Assets

Icons and 1×/2× font atlases are generated before native, browser and simulator
builds. Only their generators and original font inputs are tracked. Use
`bun run desktop assets` to rebuild them explicitly; see the
[repository asset policy](../../docs/ASSETS.md).

## Build

Run the commands below from the repository root. Build outputs and benchmark
paths in this document are relative to `shells/desktop/`.

Requirements: Bun and Rust. macOS native builds also need Xcode command-line
tools. Linux native builds need the X11/Wayland development libraries and a Vulkan-capable driver listed by the CI workflow. Checks and browser builds
require the `wasm32-unknown-unknown` Rust target.

```sh
bun run setup
rustup target add wasm32-unknown-unknown
bun run desktop check
bun run desktop test:rust
bun run desktop build
bun run desktop macos
```

On Linux, build and launch the same resolved Pocket System through the generic
portable Rust AppSupervisor host:

```sh
bun run desktop linux
bun run desktop package:linux
```

`package:linux` creates a relocatable `PocketDesktop` product directory and a
`pocket-desktop-linux-<arch>.tar.gz` distribution. After installing the Linux
libraries listed above, extract it and run:

```sh
./PocketDesktop/bin/pocket-desktop
```

The relocatable launcher sets the artifact root and passes the complete
`ResolvedSystemPlan` to the native host.

Build or serve the browser preview with:

```sh
bun run desktop build:web
bun run desktop web
bun run desktop test:web
```

The browser host uses a separate WASM text worker per package. It runs every installed package in an independent iframe
JavaScript Realm with its own wasm UI instance. The parent AppSupervisor
schedules focused/visible AppInstances and composites child rasters at the
shell's `CompositorSurface` painter positions. `test:web` drives a real
headless Chrome double-click journey and requires the Hero child raster to
replace its shell fallback before saving `dist/web-smoke.png`.

Build and verify the product site, including the complete preview at `/play/`,
with:

```sh
bun run desktop build:site
bun run desktop test:site
```

The retained Wrangler configuration targets Cloudflare Workers Static Assets
at `desktop.pocketlab.build` and owns its custom-domain route.
`bun run desktop deploy:site` builds before publishing. Moving the sources
does not deploy the site.

Regenerate the checked-in theme screenshots from the deterministic PocketJS
simulator with `bun run desktop capture`.

## Historical desktop benchmarks

The [Aqua GPU comparison](docs/bench/aqua-gpu-2026-09-10.md) and
[classic baseline](docs/bench/classic-2026-08-23.md) describe the imported
desktop showcase at their recorded revisions. They do not measure the
current macOS desktop with Devices. Replay `benchmark:drag` or `benchmark:classic`
from the corresponding historical revision; both scripts reject a Devices
plan instead of reporting its lighter workload as the old desktop.
New benchmark receipts stay in ignored `.pocket/bench/` directories.

Pass native-host script flags after `--`, for example:

```sh
bun run desktop macos -- --quit-after 120
```

## Licensing

This desktop shell is distributed under **GPL-3.0-only**. The full terms are
in [LICENSE](LICENSE); third-party materials retain the licenses in
[THIRD_PARTY.md](THIRD_PARTY.md). Contribution rules and the licenses of the
other shells are described in [CONTRIBUTING.md](../../CONTRIBUTING.md) and
[LICENSING.md](../../LICENSING.md).
