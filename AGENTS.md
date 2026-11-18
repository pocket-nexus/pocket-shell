# Working in this repository

Pocket Shell is a product built on PocketJS, which arrives as the
`vendor/pocketjs` submodule; the Pocket Applets arrive as `vendor/applets`
([pocket-nexus/applets](https://github.com/pocket-nexus/applets)). Nothing in
`vendor/` is edited here: a change lands in
[pocket-nexus/pocketjs](https://github.com/pocket-nexus/pocketjs) or
pocket-nexus/applets first, and this repository moves its pin.

The repository holds **three shells and one device firmware**, and a change
belongs to one of them:

- `shells/3ds/`: Pocket Shell, the launcher (`shell/`), and the scripts that
  build it with the **Pocket Applets** of `vendor/applets` (Hacker News, X,
  YouTube, Discord, GitHub, Weather, Podcasts, Maps, Home Assistant, Camera,
  Photos, Notes). The applets' iOS 6 kit `ui/` and their `lib/` live there
  too; `shells/3ds/ui` and `shells/3ds/lib` link to them. **Its platforms are
  the Nintendo 3DS, the M5Stack Tab5 and the PSP**: on the 3DS two screens of
  fixed size, a resistive panel with one contact, a d-pad and shoulder
  buttons; on the Tab5 one 640x360 touch surface, a host-drawn home ball and
  a keyboard; on the PSP one 480x272 screen and buttons, with the launcher
  alone (the pinned PocketJS gives the PSP no worker, and every networked
  applet needs one). The Tab5 firmware (`devices/m5stack`) compiles this
  launcher into its image, so a launcher change reaches the 3DS and the Tab5
  builds; `bun run tab5` builds this launcher and the applets as
  Tab5 packages. Each program reads its surface size at
  start (`ui/screen.ts`) and lays out by size class. Every applet draws on
  the touch surface and declares `system.agent`; the 3DS's top screen and the
  L+R agent overlay belong to the PocketJS host and framework, not to this
  repository.
- `shells/touch/`: Pocket Shell Touch, a full-screen gesture shell with
  retained mock apps on iPod touch 4 and Nokia E7. It owns navigation, window
  recency and its device tests.
- `shells/desktop/`: the desktop interface for browser previews and embedded
  computers in Pocket Studio. It owns windows, application presentation and
  themes. PocketJS supplies the browser runtime and shared rendering APIs;
  the embedding product owns its display and input adapters.
- `devices/m5stack/`: the M5Stack Tab5 firmware (ESP-IDF, C and TypeScript):
  the program `programs/m5stack-tab5`, the ESP-IDF components in
  `platforms/esp-idf`, the two apps the image bundles (`apps/`), its tools
  and host tests. Its build compiles the launcher from `shells/3ds/shell` and
  the runtime from `vendor/pocketjs`. Its C, formatting and ESP-IDF rules are
  in `devices/m5stack/AGENTS.md`.

Each shell and the firmware owns its sources, manifests, scripts, tests, assets
and documentation. Root scripts provide setup and command routing. They share
one runtime submodule; application code stays separate until a concrete shared
need exists.

This project is distributed under **GPLv3**. Root, 3DS, touch and M5Stack
firmware code is **GPL-3.0-or-later** (the firmware since its import from
pocket-m5, which was MIT); imported desktop code retains **GPL-3.0-only**. New source
files carry the corresponding SPDX line. PocketJS remains MIT and third-party
fonts retain their own licenses. See `LICENSING.md`.

## Conventions

- Publish a change as a **draft pull request** before treating it as ready,
  and name it with Conventional Commits — `feat(deck): …`, `fix(wm): …`.
- Import PocketJS runtime, host component, lifecycle, input and animation APIs
  from `@pocketjs/framework/*`; import Solid primitives and control flow from
  `solid-js`.
- Preserve installed package IDs and device identities when moving code.
- Desktop colors, fonts, icons and chrome belong in its theme boundary.
  Themes must not determine package identity or embedding host behavior.
- Prose states the mechanism and the reason. No slogans, no imported
  architecture jargon, no empty intensifiers.
- Every program the launcher runs is a **Pocket Applet**: its app contract
  (`pocket.app.json`) declares `applet` (summary, services, hosts, store)
  and meets the applet rules in PocketJS `docs/APPLETS.md`: one 320×240
  touch surface, a capability allowlist, declared companion services, no
  native code, no `eval`, size budgets. The PocketJS build refuses a broken
  applet, and pocket-nexus/applets checks every one (`bun run check`
  there). The launcher (`shell/`) declares no `applet`.
- An app contract's entry is relative to its project root: `shells/3ds/` for
  the launcher, `vendor/applets` for an applet. `shells/3ds/scripts/apps.ts`
  lists the launcher and the applets and resolves their plans.
- A Tab5 package is built against the host config in
  `devices/m5stack/programs/m5stack-tab5` and must be admitted by its host
  contract (`bun run tab5` checks with PocketJS's admission); the profile
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
bun run check                        # typecheck + all three shells' unit and sim tests
bun run check:m5stack                # the Tab5 firmware's clang-format check and host tests (needs a C compiler)
bun run pair --host <console-ip>     # once per computer, while ftpd runs: write its pairing onto the card
bun run push                         # rebuild the launcher's package and hot-push it
bun run push hn                      # rebuild Hacker News, install it into its slot and start it
bun run deploy                       # rebuild the .3dsx, install it over the Pocket Link, restart into it
bun run shot                         # a screenshot of both screens
bun run offer                        # build the applets' 3DS and Tab5 packages and serve them from the reference Pocket Link 2 Hub
bun run tab5                         # the launcher and the applets as Tab5 packages in dist/tab5
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

Changes under `shells/3ds/shell` or `vendor/applets` are hot pushes, and an
accepted push persists on the card for that app. A change under
`vendor/pocketjs/products/3ds` is native: `bun run deploy` writes the new
`.3dsx` to `sdmc:/3ds/` over the Pocket Link and restarts into it, and the
restarted `.3dsx` boots the guest it embeds. The 3DS program speaks **Pocket
Link 2** (PocketJS `docs/POCKET-LINK.md`): it dials this computer, and the
console scripts run PocketJS's `tools/3ds-dev.ts`, the reference Hub's
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
