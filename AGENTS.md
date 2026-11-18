# Working in this repository

Pocket Shell is a product built on PocketJS, which arrives as the
`vendor/pocketjs` submodule. Nothing in `vendor/` is edited here: a change
lands in [pocket-nexus/pocketjs](https://github.com/pocket-nexus/pocketjs)
first, and this repository moves its pin. The Pocket Applets are in
[pocket-nexus/applets](https://github.com/pocket-nexus/applets), which builds
them against this repository (the kit in `ui/`, the app contract, the package
and the CLI). **The dependency runs one way**: the launcher builds, and the
tests and CI run, without an applets checkout. The developer commands that
build an applet read one.

The repository holds **three shells, two device programs and the host
services they share**, and a change belongs to one of them:

- `shells/3ds/`: Pocket Shell, the launcher (`shell/`), and the scripts that
  build it and, from a checkout of pocket-nexus/applets, the **Pocket
  Applets** (Hacker News, X, YouTube, Discord, GitHub, Weather, Podcasts,
  Maps, Home Assistant, Camera, Photos, Notes). The launcher draws with the
  iOS 6 kit in `ui/` at the repository root and imports it by relative path;
  `shell/art/icons` is a link to `ui/art/icons`, because the PocketJS build
  finds a picture by its name below the entry's directory. **Its platforms are
  the Nintendo 3DS, the M5Stack Tab5 and the PSP**: on the 3DS two screens of
  fixed size, a resistive panel with one contact, a d-pad and shoulder
  buttons; on the Tab5 one 640x360 touch surface, a host-drawn home ball and
  a keyboard; on the PSP one 480x272 screen and buttons, with the launcher
  alone (the pinned PocketJS gives the PSP no worker, and every networked
  applet needs one). The Tab5 firmware (`devices/m5stack`) compiles this
  launcher into its image, so a launcher change reaches the 3DS and the Tab5
  builds; `bun run tab5` builds this launcher and, with an applets checkout,
  the applets as Tab5 packages. Each program reads its surface size at
  start (`ui/screen.ts`) and lays out by size class. Every applet draws on
  the touch surface and declares `system.agent`; the 3DS's top screen belongs
  to the 3DS host program (`devices/3ds`). The L+R agent
  overlay is `runtime/src/agent-layer.tsx`; the pinned PocketJS build adds
  its own copy (`vendor/pocketjs/framework/src/agent-layer.tsx`) to every app
  that declares `system.agent`, so the launcher and the applets run that
  copy and `runtime/test/agent-layer.test.ts` runs this repository's.
- `shells/touch/`: Pocket Shell Touch, a full-screen gesture shell with
  retained mock apps on iPod touch 4 and Nokia E7. It owns navigation, window
  recency and its device tests.
- `shells/desktop/`: the desktop interface for browser previews and embedded
  computers in Pocket Studio. It owns windows, application presentation and
  themes. PocketJS supplies the browser runtime and shared rendering APIs;
  the embedding product owns its display and input adapters.
- `devices/3ds/`: the Nintendo 3DS host program, the `.3dsx` that embeds
  the launcher: its C sources (`src/`: boot and frame loop, package storage
  and recovery, the program's side of Pocket Link 2, the agent stage, Wi-Fi,
  camera and photos), the Rust archive (`core/`, a Cargo workspace of its own
  with its own lockfile), the host contract `pocket.host.json` (id `3ds-dev`),
  the Makefile, `build.ts` and host tests. `build.ts` compiles the guest with
  PocketJS's toolchain and the C half in the devkitARM container, and reads
  the platform (`platforms/3ds`), the PICA renderer
  (`devices/3ds/pocket-3ds-pica`), the QuickJS facade and the engine crates
  from `vendor/pocketjs`; `devices/3ds/README.md` lists each.
- `devices/services/`: portable C both device programs compile: the Pocket
  Link 2 client (`link2*.c`), the launcher's app table, `data.fs`, a JSON
  reader, SHA-256, photo images, the media stream's headers and the vendored
  quirc. A source calls the platform through `host_services.h`, which each
  program implements once. A change here reaches the `.3dsx` and the Tab5
  firmware.
- `devices/m5stack/`: the M5Stack Tab5 firmware (ESP-IDF, C and TypeScript):
  the program `programs/m5stack-tab5`, the ESP-IDF components in
  `platforms/esp-idf`, the two apps the image bundles (`apps/`), its tools
  and host tests. Its build compiles the launcher from `shells/3ds/shell`,
  the host services from `devices/services` and the runtime from
  `vendor/pocketjs`. Its C, formatting and ESP-IDF rules are in
  `devices/m5stack/AGENTS.md`.

Each shell and each device program owns its sources, manifests, scripts,
tests, assets and documentation. Root scripts provide setup and command
routing. They share one runtime submodule; application code stays separate
until a concrete shared need exists.

`ui/` at the repository root is the iOS 6 kit the launcher and the applets
draw with: the navigation stack and bar (`nav.tsx`, `bar.tsx`), grouped
tables, alerts, text fitting, slot pools, one touch router per screen, the
size classes (`screen.ts`), the button legend and the icon tiles
(`icons.tsx`), with its pictures in `ui/art` and the icon family in
`ui/art/icons`. It was imported from pocket-nexus/applets at `4660dfe`, and
a change to it reaches the launcher and every applet. Its modules import
PocketJS and Solid and nothing else in this repository. Three modules of the
applets' `ui/` stayed there because they import the applets' own `lib/net.ts`
or `kit/qr.ts`: `glyphs.ts`, `setup.tsx` and `qr.tsx`. The icon PNGs are
rendered in pocket-nexus/applets (`tools/icons`, Blender) and committed here.

Two directories beside the shells hold the Pocket Runtime's TypeScript,
imported from PocketJS at `89e10438`. PocketJS at that commit has its own
copies, and pocket-nexus/applets imports those (`@pocketjs/framework/applet`,
`@pocketjs/framework/link`); `ui/screen.ts` imports PocketJS's `applet` too:

- `runtime/`: the contracts (`spec/`: Pocket Link 1 and 2, the applet
  contract, the agent, owner setup, Wi-Fi, device, camera), the guest modules
  (`src/`: the applet surface, link, applet channel, launcher, system sheet,
  agent and its overlay, Wi-Fi, device, camera), the 3DS console simulator
  with its link, Wi-Fi, camera and agent fakes (`sim/`), and their tests
  (`test/`). `shells/3ds/shell` imports its applet surface, link, launcher,
  agent, Wi-Fi and camera modules from `runtime/src`.
- `link/`: the Pocket Link 2 reference implementation (`v2/`: codec, device,
  Hub and the Hub's command line), the Hub's destination policy (`fetch.ts`),
  the 3DS development tool (`3ds-dev.ts`), the conformance
  vectors (`vectors/`) and the tests (`test/`). The C client is
  `devices/services` (`link2*.c`); `devices/services/test` runs it against
  this Hub and these vectors.

`docs/POCKET-LINK.md`, `docs/APPLETS.md` and `docs/POCKET-AGENT.md` are the
specifications of the link, the applet rules and the agent.

The app contract and the package are this repository's too, imported from
PocketJS at `806ac202`; PocketJS at that commit has its own copies, which
`shells/desktop`, `shells/touch` and pocket-nexus/applets use:

- `runtime/spec/pocket-manifest.ts`, `runtime/manifest/` and
  `runtime/schema/pocket-2.json`: the app contract (`pocket.app.json`), its
  schema, loader, validation and resolution against a host contract into a
  build plan, and the inputs a native host build reads from a plan.
  `bun runtime/schema/generate.ts` writes the JSON schema from the schema
  object; `bun run check:schemas` fails when the two differ.
- `runtime/spec/pocket-package.ts`, `runtime/spec/admission.ts` and
  `runtime/package/`: the `.pocket` container, the selection of the variant a
  host admits, a variant's sections (`pocket-pack.ts`), its bytecode sections
  (`bytecode.ts`) and the applet check (`applet-check.ts`).
- `cli/`: the command line (`cli/pocket-shell.ts`, `bun run pocket-shell`).
  `check` and `compile` read an app contract with the modules above, write
  the resolved plan to a file, run PocketJS's compiler
  (`vendor/pocketjs/tools/build.ts --plan=<file>`, which writes the bundle
  and the asset pack) and encode the `.pocket`. Every other command runs
  PocketJS's CLI with the same arguments. `bun run tab5`, `bun run psp` and
  the Tab5 firmware's CMake build (`devices/m5stack/tools/pocket`) compile
  through it; `devices/3ds/build.ts` uses the same modules without the CLI.
  `cli/README.md` lists the options.

PocketJS keeps the host contracts and their hashing, the type check, the
compiler, the QuickJS bytecode compiler and the worker, modality, animation
and platform specifications; the modules above reach them by path into
`vendor/pocketjs`. `docs/APP-CONTRACT.md` and `docs/POCKET-PACKAGE.md` are
the specifications of the app contract and the package.

This project is distributed under **GPLv3**. Root, 3DS, touch and M5Stack
firmware code is **GPL-3.0-or-later** (the firmware since its import from
pocket-m5, which was MIT); imported desktop code retains **GPL-3.0-only**. New source
files carry the corresponding SPDX line. PocketJS remains MIT and third-party
fonts retain their own licenses. `runtime/`, `link/` and the three
specifications came from PocketJS under MIT and are distributed here under
**GPL-3.0-or-later**; `runtime/LICENSE.pocketjs-MIT` keeps the original
notice. `devices/3ds`, `devices/services`, `cli/`, `runtime/manifest`,
`runtime/package`, `runtime/schema`, the app contract, package and admission
specifications in `runtime/spec` and the two documents on them came from
PocketJS at `806ac202`
on the same terms, and their sources carry the SPDX line; the vendored
`devices/services/quirc` keeps its ISC notice and gets none. `ui/` came
from pocket-nexus/applets (GPL-3.0-or-later) at `4660dfe` with the SPDX line
in each source. See `LICENSING.md`.

## Conventions

- Publish a change as a **draft pull request** before treating it as ready,
  and name it with Conventional Commits — `feat(deck): …`, `fix(wm): …`.
- Import PocketJS runtime, host component, lifecycle, input and animation APIs
  from `@pocketjs/framework/*`; import Solid primitives and control flow from
  `solid-js`.
- Guest code imports a `runtime/src` module by relative path
  (`../../../runtime/src/link.ts`), not by a package name or a tsconfig
  alias: pass 1 of the PocketJS build walks relative imports and
  `@pocketjs/framework/*` and treats every other bare specifier as external,
  so a module behind one is bundled without its class strings and glyphs
  compiled. The launcher imports the kit the same way
  (`../../../ui/nav.tsx`).
- Inside `runtime/`, a PocketJS module with a package export is imported as
  `@pocketjs/framework/<subpath>`; one without is imported by relative path
  into `vendor/pocketjs`. A module that holds state (`services.ts`,
  `frame.ts`, `system-layers.ts`) is reached by one file path, or the bundle
  holds two instances of it.
- `devices/3ds` and `devices/services` read what stays in PocketJS (the 3DS
  platform, the PICA renderer, the QuickJS facade, the engine crates, the
  toolchain pins) by path into `vendor/pocketjs` and copy none of it. When
  the PocketJS pin moves, copy `vendor/pocketjs/Cargo.lock` to
  `devices/3ds/core/Cargo.lock` and run `cargo metadata --manifest-path
  devices/3ds/core/Cargo.toml` once (Cargo removes the packages that graph
  does not reach), run `bun devices/3ds/tools/contracts.ts`, then
  `bun run check:devices`.
- Preserve installed package IDs and device identities when moving code.
- Desktop colors, fonts, icons and chrome belong in its theme boundary.
  Themes must not determine package identity or embedding host behavior.
- Prose states the mechanism and the reason. No slogans, no imported
  architecture jargon, no empty intensifiers.
- Every program the launcher runs is a **Pocket Applet**: its app contract
  (`pocket.app.json`) declares `applet` (summary, services, hosts, store)
  and meets the applet rules in `docs/APPLETS.md`: one 320×240
  touch surface, a capability allowlist, declared companion services, no
  native code, no `eval`, size budgets. A build refuses a broken applet:
  the resolver checks the contract rules, and `pocket-shell compile` and
  `devices/3ds/build.ts` check the sources and the bundle sizes
  (`runtime/package/applet-check.ts`; the pinned PocketJS compiler runs its
  own copy first). pocket-nexus/applets checks every one (`bun run check`
  there). The launcher (`shell/`) declares no `applet`.
- An app contract's entry is relative to its project root: `shells/3ds/` for
  the launcher, the applets checkout for an applet (`POCKET_APPLETS_ROOT`,
  default `../applets` beside this repository). `shells/3ds/scripts/apps.ts`
  lists the launcher and, when that checkout exists, the applets, and
  resolves their plans. Without it `bun run offer` or a command that names an
  applet stops with one line.
- Tests and CI run without an applets checkout. A test that needs an applet
  uses the one in `runtime/test/fixtures/applets` (`feed/`, with a worker, a
  store and a module shared in `lib/`).
- A Tab5 package is built against the host config in
  `devices/m5stack/programs/m5stack-tab5` and must be admitted by its host
  contract (`bun run tab5` checks with `runtime/spec/admission.ts`); the profile
  hash only orders variants.
- Lone L and R presses reach an applet six frames late (the host waits for
  the L+R chord), so do not bind frequent actions to them.

## Assets

Follow `docs/ASSETS.md`: generators and original inputs stay tracked; desktop
SVGs and font atlases are ignored build outputs. Keep only media used by
documentation or tests. New validation runs stay in ignored artifact folders.
`bun run check:assets` enforces these boundaries as part of the main check.

## The loop

```sh
bun run check                        # typecheck + the link, runtime, CLI and three shells' unit and sim tests
bun run check:m5stack                # the Tab5 firmware's clang-format check and host tests (needs a C compiler)
bun run check:devices                # devices/3ds and devices/services: generated headers and host tests (needs a C compiler, Rust, libjpeg, pkg-config)
bun run pair --host <console-ip>     # once per computer, while ftpd runs: write its pairing onto the card
bun run push                         # rebuild the launcher's package and hot-push it
bun run push hn                      # rebuild Hacker News from the applets checkout, install it into its slot and start it
bun run deploy                       # rebuild the .3dsx, install it over the Pocket Link, restart into it
bun run shot                         # a screenshot of both screens
bun run offer                        # build the applets checkout's 3DS and Tab5 packages and serve them from the reference Pocket Link 2 Hub
bun run pocket-shell compile …       # one app contract into a .pocket for a host contract (cli/README.md)
bun run tab5                         # the launcher and, with an applets checkout, the applets as Tab5 packages in dist/tab5
bun run psp                          # the PSP EBOOT in dist/psp
bun run 3ds                          # the full .3dsx in dist/3ds
bun run release [patch|minor|major]  # open the release PR; its merge tags and publishes the .3dsx
```

The touch shell uses `bun run touch guest|deploy|launch|status|capture` and
`bun run check:touch`. Its own README includes the device test loop.

Desktop commands run through the root dispatcher:

```sh
bun run desktop web            # launch the browser preview
bun run desktop build:web      # build the browser preview
bun run desktop test:web
bun run check:desktop          # or check:3ds / check:touch
```

Run these commands from the repository root. Each shell also has its own
package.json; desktop artifacts land in `shells/desktop/dist/`.

Changes under `shells/3ds/shell`, `ui/` or an applet of the applets checkout
are hot pushes, and an accepted push persists on the card for that app. A
change under `devices/3ds` or `devices/services` is native: `bun run deploy`
writes the new `.3dsx` to `sdmc:/3ds/` over the Pocket Link and restarts into it, and the
restarted `.3dsx` boots the guest it embeds. The 3DS program speaks **Pocket
Link 2** (`docs/POCKET-LINK.md`): it dials this computer, and the
console scripts run `link/3ds-dev.ts`, the reference Hub's
command line, so `--host` only adds a beacon target. There is no development
connection (port 8131, `dev.key`) and no pairing by code on the 3DS: **ftpd
is needed to set a console up for a computer** (`bun run pair`, which writes
the pairing files onto the card), and to copy a first `.3dsx` onto a console
whose program predates Pocket Link 2 (ftpd and Pocket Runtime are both
homebrew, and one runs at a time). The Tab5 firmware compiles the Pocket
Link 2 client and pairs by a code it shows; the PSP keeps Pocket Link 1. The
launcher reads from the running host how it pairs (`shell/system.ts`
`linkPairsByCode`, `showsPairCode`) instead of assuming one version. The
console takes `.3dsx` files only.

**Recovery state is isolated per app** in
`/pocketjs/runtime/apps/<slot>/` (the slot is the first 16 hex digits of the
SHA-256 of the app id). Read its `status.txt` and `last-error.txt` when
investigating guest boot or rollback.

The Omarchy-style 3DS shell and the iPod touch companion are archived on the
branch `archive/3ds-omarchy-ipod-remote`; see the README.
