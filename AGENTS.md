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

**PocketJS is UI infrastructure; this repository is the Runtime built on
it.** PocketJS has no app contract (`pocket.app.json`) and no `.pocket`
container: its applications put their build inputs in the `app` section of
`pocket.host.config.ts`, and its programs boot one compiled application, a
bundle (`.pkb`, PocketJS `contracts/spec/bundle.ts`). The app contract, the
`.pocket` container and its admission, Pocket Link, the applets, the
application catalog and switching between applications on a device are
here, and a change to them lands here. PocketJS keeps the numbers of the
application operations 39 `appTable`, 40 `appLaunch`, 41 `appShot` and 51
`appClose` for a product host; the 3DS, PSP and Tab5 programs implement 39
to 41.

The repository holds **three shells, three device programs and the C host
services two of them share**, and a change belongs to one of them:

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
  alone (the PSP program's host contract, `pocket-shell-psp`, has no worker,
  and every networked applet needs one). The Tab5 firmware
  (`devices/m5stack`) compiles this launcher into its image, so a launcher
  change reaches the 3DS, Tab5 and PSP builds; `bun run tab5` builds this
  launcher and, with an applets checkout,
  the applets as Tab5 packages. Each program reads its surface size at
  start (`ui/screen.ts`) and lays out by size class. Every applet draws on
  the touch surface and declares `system.agent`; the 3DS's top screen belongs
  to the 3DS host program (`devices/3ds`). The L+R agent
  overlay is `runtime/src/agent-layer.tsx`: for every Solid app that
  declares `system.agent`, `runtime/manifest/system-layers.ts` passes it to
  PocketJS's compiler as a system layer (`tools/build.ts --layer`), and
  `pocket-shell compile` and `devices/3ds/build.ts` both take their
  arguments from it.
- `shells/touch/`: Pocket Shell Touch, a full-screen gesture shell with
  retained mock apps on iPod touch 4 and Nokia E7. It owns navigation, window
  recency and its device tests. Its build inputs are the `app` section of
  `shells/touch/pocket.host.config.ts` (hosts `ipodtouch4-dev` and
  `symbian-e7-dev`), which PocketJS's CLI compiles; it has no app contract.
- `shells/desktop/`: the desktop interface for browser previews and embedded
  computers in Pocket Studio. It owns windows, application presentation and
  themes. **It does not build against the pinned PocketJS**: it reads
  PocketJS's demo manifests, manifest module and Pocket System, which
  pocket-nexus/pocketjs#705 removed. The root typecheck, tests and checks,
  the workspaces, the release's version files and CI leave it out; its
  sources stay, and `shells/desktop/README.md` says why it does not build.
- `devices/3ds/`: the Nintendo 3DS host program, the `.3dsx` that embeds
  the launcher: its C sources (`src/`: boot and frame loop, package storage
  and recovery, the program's side of Pocket Link 2, the agent stage, Wi-Fi,
  camera and photos), the Rust archive (`core/`, a Cargo workspace of its own
  with its own lockfile), the host contract `pocket.host.json` (id `3ds-dev`),
  the Makefile, `build.ts` and host tests. `build.ts` compiles the guest with
  PocketJS's toolchain and the C half in the devkitARM container. The
  program reads its `.pocket` files with `devices/services/pocket_container.c`
  and admits the variant the reader states through its core's
  `pocket_package_open_source`. The
  platform's media, offload, SOC and worker sources are `platform/`; the
  platform's hooks, HID facts and input source (`platforms/3ds`), the PICA
  renderer (`devices/3ds/pocket-3ds-pica`), the QuickJS facade and the engine
  crates are read from `vendor/pocketjs`; `devices/3ds/README.md` lists each.
- `devices/psp/`: the PSP program, a Rust crate (`program/`) over PocketJS's
  `pocketjs-psp` library: the launcher as app 0 and the applets embedded
  after it, the app table (ops 39 to 41), the SELECT summon, the frozen
  shot, the veil between guests, and `globalThis.link` and
  `globalThis.media` over the PSPLINK share `host0:/pocket-link`. Its host
  contract is `pocket-shell-psp.host.json` (id `pocket-shell-psp`). `bun run
  psp` builds it (`shells/3ds/scripts/psp.ts`), and `devices/psp/test` runs
  its link and media code on the build machine; `devices/psp/README.md`
  lists each source.
- `devices/services/`: portable C the 3DS program and the Tab5 firmware
  compile: the `.pocket` reader (`pocket_container.c`), the Pocket Link 2
  client (`link2*.c`), the launcher's app table, `data.fs`, a JSON reader,
  SHA-256, photo images, the media stream's headers and the vendored quirc.
  A source calls the platform through `host_services.h`, which each program
  implements once. A change here reaches the `.3dsx` and the Tab5 firmware.
- `devices/m5stack/`: the M5Stack Tab5 firmware (ESP-IDF, C and TypeScript):
  the program `programs/m5stack-tab5`, the ESP-IDF components in
  `platforms/esp-idf`, the two apps the image bundles (`apps/`), its tools
  and host tests. Its build compiles the launcher from `shells/3ds/shell`,
  the host services from `devices/services` and the runtime from
  `vendor/pocketjs`; the firmware boots and installs `.pocket` files through
  the shared reader. Its C, formatting and ESP-IDF rules are in
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
PocketJS, Solid and the applet surface (`@pocket-shell/runtime/applet`, in
`screen.ts`) and nothing else in this repository. Three modules of the
applets' `ui/` stayed there because they import the applets' own `lib/net.ts`
or `kit/qr.ts`: `glyphs.ts`, `setup.tsx` and `qr.tsx`. The icon PNGs are
rendered in pocket-nexus/applets (`tools/icons`, Blender) and committed here.

Two directories beside the shells hold the Pocket Runtime's TypeScript,
imported from PocketJS at `89e10438`; PocketJS removed its copies at
`89162fb7`. Guest code, here and in pocket-nexus/applets, imports the guest
modules as `@pocket-shell/runtime/<module>` (the exports of
`runtime/package.json`):

- `runtime/`: the contracts (`spec/`: Pocket Link 1 and 2, the applet
  contract, the agent, owner setup, Wi-Fi, device, camera, media, and the
  capability ids Pocket Shell defines, `capabilities.ts`), the guest
  modules (`src/`: the applet surface, link, applet channel, launcher, system
  sheet, agent and its overlay, Wi-Fi, device, camera, media), the 3DS
  console simulator with its link, Wi-Fi, camera and agent fakes (`sim/`),
  and their tests (`test/`). `shells/3ds/shell` imports the applet surface,
  link, launcher, agent, Wi-Fi and camera modules and `ui/screen.ts` the
  applet surface. Companion media playback (`spec/media.ts`,
  `spec/media-adpcm.ts`, `src/media.ts`, `test/media.test.ts`) came from
  PocketJS at `e95942c3`, before pocket-nexus/pocketjs#710 removed it.
- `link/`: the Pocket Link 2 reference implementation (`v2/`: codec, device,
  Hub and the Hub's command line), the Hub's destination policy (`fetch.ts`),
  the companion's media stream producer (`media-stream.ts`), the 3DS
  development tool (`3ds-dev.ts`), the conformance
  vectors (`vectors/`) and the tests (`test/`). The C client is
  `devices/services` (`link2*.c`); `devices/services/test` runs it against
  this Hub and these vectors.

`docs/POCKET-LINK.md`, `docs/APPLETS.md`, `docs/POCKET-AGENT.md` and
`docs/MEDIA.md` are the specifications of the link, the applet rules, the
agent and companion media playback.

The app contract and the package are this repository's too, imported from
PocketJS at `806ac202`; PocketJS removed its own with
pocket-nexus/pocketjs#705 and #706. The launcher, the device programs and
pocket-nexus/applets build with these:

- `runtime/spec/pocket-manifest.ts`, `runtime/manifest/` and
  `runtime/schema/pocket-2.json`: the app contract (`pocket.app.json`), its
  schema, loader, validation and resolution against a host contract into a
  build plan, and the inputs a native host build reads from a plan.
  `bun runtime/schema/generate.ts` writes the JSON schema from the schema
  object; `bun run check:schemas` fails when the two differ. The schema's
  identifier, `https://pocketjs.dev/schema/pocket-2.json`, is the value a
  manifest's `$schema` must hold; the URL identifies the schema and is not
  served. The JSON Schema
  subset and its validator are PocketJS's `contracts/spec/json-schema.ts`,
  the animation theme PocketJS's `contracts/spec/animation-theme.ts`.
- `runtime/spec/pocket-package.ts`, `runtime/spec/admission.ts` and
  `runtime/package/`: the `.pocket` container, the selection of the variant a
  host admits, a variant's sections (`pocket-pack.ts`), its bytecode sections
  (`bytecode.ts`), a variant as a PocketJS bundle (`bundle.ts`) and the
  applet check (`applet-check.ts`). The admission corpus is
  `runtime/test/fixtures/admission`; the reader the 3DS program and the Tab5
  firmware compile is `devices/services/pocket_container.c`.
- `cli/`: the command line (`cli/pocket-shell.ts`, `bun run pocket-shell`).
  `check` and `compile` read an app contract with the modules above, write
  the resolved plan to a file, run PocketJS's compiler
  (`vendor/pocketjs/tools/build.ts --plan=<file>`, with `--layer` for the
  plan's system layers, which writes the bundle and the asset pack) and
  encode the `.pocket`. Every other command runs PocketJS's CLI with the
  same arguments; its `build` and `pack` take a bundle (`--bundle
  FILE.pkb`), not a `.pocket`. `bun run tab5`, `bun run psp` and the Tab5
  firmware's build compile through it; `devices/3ds/build.ts` uses the same
  modules without the CLI. `cli/README.md` lists the options.

PocketJS keeps the host contracts and their hashing, the type check, the
compiler, the QuickJS bytecode compiler, the bundle format and the worker,
modality, animation and platform specifications; the modules above reach
them by path into `vendor/pocketjs`. The compiler's interface here is
`tools/build.ts --plan=<plan.json> --project-root=<dir> --outdir=<dir>`,
with `--inputs-file` and `--layer`. `docs/APP-CONTRACT.md` and
`docs/POCKET-PACKAGE.md` are the specifications of the app contract and the
package.

This project is distributed under **GPLv3**. Root, 3DS, PSP, touch and
M5Stack firmware code is **GPL-3.0-or-later** (the firmware since its import
from pocket-m5, which was MIT); imported desktop code retains
**GPL-3.0-only**. New source
files carry the corresponding SPDX line. PocketJS remains MIT and third-party
fonts retain their own licenses. `runtime/`, `link/` and the three
specifications came from PocketJS under MIT and are distributed here under
**GPL-3.0-or-later**; `runtime/LICENSE.pocketjs-MIT` keeps the original
notice. `devices/3ds`, `devices/services`, `cli/`, `runtime/manifest`,
`runtime/package`, `runtime/schema`, the app contract, package and admission
specifications in `runtime/spec` and the two documents on them came from
PocketJS at `806ac202`
on the same terms, and their sources carry the SPDX line; the vendored
`devices/services/quirc` keeps its ISC notice and gets none. On the same
terms, with the SPDX line in each source: companion media playback
(`runtime/spec/media.ts`, `runtime/spec/media-adpcm.ts`,
`runtime/src/media.ts`, `link/media-stream.ts`, `runtime/test/media.test.ts`
and `docs/MEDIA.md`) came from PocketJS at `e95942c3`; the PSP program's
`switch.rs` and `veil.rs` from PocketJS `programs/psp/src` at `a8f2bcdd`,
before #708; its `link.rs` and `link_record.rs` from PocketJS
`platforms/psp/io/src/link.rs`, and its `media.rs`, `media_wire.rs` and
`bindings.rs` from PocketJS `programs/psp/src`, at `e95942c3`, before #710;
and the admission corpus `runtime/test/fixtures/admission` (no SPDX line)
from PocketJS `engine/package/tests/fixtures/admission` at `89162fb7`. `ui/`
came from pocket-nexus/applets (GPL-3.0-or-later) at `4660dfe` with the SPDX
line in each source. See `LICENSING.md`.

## Conventions

- Publish a change as a **draft pull request** before treating it as ready,
  and name it with Conventional Commits — `feat(deck): …`, `fix(wm): …`.
- Import PocketJS runtime, host component, lifecycle, input and animation APIs
  from `@pocketjs/framework/*`; import Solid primitives and control flow from
  `solid-js`.
- Guest code imports a `runtime/src` module as
  `@pocket-shell/runtime/<module>` (`applet`, `link`, `channel`, `launcher`,
  `system`, `agent`, `wifi`, `device`, `camera`, `media`). `bun run setup` links
  `node_modules/@pocket-shell/runtime` to `runtime/` and the tsconfigs map
  the same files. Pass 1 of the PocketJS build follows the link to the
  module's real path, outside `node_modules`, and walks it like a relative
  import, so its class strings and glyphs compile with the app's; the
  bundle holds one copy of each module. The launcher imports the kit by
  relative path (`../../../ui/nav.tsx`).
- Guest code inside `runtime/` imports PocketJS by its package exports:
  `@pocketjs/framework/system-layers` (layer registration, the frame input
  filter, the service pump, app suspension, `packTouch`, `openOsk`, the
  screen size and the property enums) and the public subpaths. Each
  stateful module (`services.ts`, `frame.ts`, `system-layers.ts`) is behind
  those exports once. The manifest resolver, the package code, the tools and
  the tests read PocketJS contracts and tools by relative path into
  `vendor/pocketjs`.
- `devices/3ds` and `devices/services` read the 3DS platform's hooks, HID
  facts, input source and icons, the PICA renderer, the QuickJS facade, the
  engine crates and the toolchain pins by path into `vendor/pocketjs`.
  `devices/3ds/platform` holds the platform's media, offload, SOC and worker
  sources, imported from PocketJS `platforms/3ds` at `806ac202` before
  PocketJS removed them. When
  the PocketJS pin moves, copy `vendor/pocketjs/Cargo.lock` to
  `devices/3ds/core/Cargo.lock` and run `cargo metadata --manifest-path
  devices/3ds/core/Cargo.toml` once (Cargo removes the packages that graph
  does not reach), run `bun devices/3ds/tools/contracts.ts`, run `cargo
  metadata --manifest-path` once for `devices/psp/program/Cargo.toml` and
  `devices/psp/host-test/Cargo.toml` so each lockfile follows PocketJS's
  crates, then `bun run check:devices`.
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
  (`runtime/package/applet-check.ts`). pocket-nexus/applets checks every
  one (`bun run check` there). The launcher (`shell/`) declares no `applet`.
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
bun run check                        # typecheck + the link, runtime, CLI and the 3DS and touch shells' unit and sim tests
bun run check:m5stack                # the Tab5 firmware's clang-format check and host tests (needs a C compiler)
bun run check:devices                # devices/3ds, devices/psp and devices/services: generated headers and host tests (needs a C compiler, Rust, libjpeg, pkg-config)
bun run pair --host <console-ip>     # once per computer, while ftpd runs: write its pairing onto the card
bun run push                         # rebuild the launcher's package and hot-push it
bun run push hn                      # rebuild Hacker News from the applets checkout, install it into its slot and start it
bun run deploy                       # rebuild the .3dsx, install it over the Pocket Link, restart into it
bun run shot                         # a screenshot of both screens
bun run offer                        # build the applets checkout's 3DS and Tab5 packages and serve them from the reference Pocket Link 2 Hub
bun run pocket-shell compile …       # one app contract into a .pocket for a host contract (cli/README.md)
bun run tab5                         # the launcher and, with an applets checkout, the applets as Tab5 packages in dist/tab5
bun run psp                          # the PSP EBOOT from devices/psp; packages and bundles in dist/psp
bun run 3ds                          # the full .3dsx in dist/3ds
bun run release [patch|minor|major]  # open the release PR; its merge tags and publishes the .3dsx
```

The touch shell uses `bun run touch guest|deploy|launch|status|capture` and
`bun run check:touch`. Its own README includes the device test loop.

Run these commands from the repository root. The 3DS and touch shells also
have their own package.json. `shells/desktop` has no commands at this pin.

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
Link 2 client and pairs by a code it shows; the PSP keeps Pocket Link 1's USB
carrier over the PSPLINK share (`devices/psp/program/src/link.rs`). The
launcher reads from the running host how it pairs (`shell/system.ts`
`linkPairsByCode`, `showsPairCode`) instead of assuming one version. The
console takes `.3dsx` files only.

**Recovery state is isolated per app** in
`/pocketjs/runtime/apps/<slot>/` (the slot is the first 16 hex digits of the
SHA-256 of the app id). Read its `status.txt` and `last-error.txt` when
investigating guest boot or rollback.

The Omarchy-style 3DS shell and the iPod touch companion are archived on the
branch `archive/3ds-omarchy-ipod-remote`; see the README.
