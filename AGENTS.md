# Working in this repository

Pocket Shell is a product built on PocketJS, which arrives as the
`vendor/pocketjs` submodule. Nothing in `vendor/` is edited here: a runtime
change lands in [pocket-stack/pocketjs](https://github.com/pocket-stack/pocketjs)
first, and this repository moves its pin.

The repository holds **four shells**, and a change belongs
to one of them:

- `shells/3ds/` — the 3DS shell. **Its only platform is the Nintendo 3DS**: two
  screens of fixed size, a resistive panel with one contact, a d-pad and
  shoulder buttons. Nothing there is a portability layer, and a change that
  only makes sense on some other machine does not belong in it.
- `shells/ipod/` — Pocket Shell on the iPod touch 4, an Omarchy companion (a guest
  app plus the daemon it talks to). Its own README carries the design.
- `shells/touch/` — Pocket Shell Touch, a portrait gesture shell with retained
  mock apps on iPod touch 4. It owns navigation, window recency and its device tests.
- `shells/desktop/` — the shell for desktop operating systems, imported from
  pocket-desktop. It owns windows, application presentation and themes.
  PocketJS owns package isolation, scheduling and native composition.
  macOS and Linux are native targets; the browser is an interactive preview.

Each shell owns its sources, manifests, scripts, tests, assets and documentation.
Root scripts provide setup and command routing. They share one runtime
submodule; application code stays separate until a concrete shared need exists.

This project is distributed under **GPLv3**. Root, 3DS, iPod and touch code remains
**GPL-3.0-or-later**; imported desktop code retains **GPL-3.0-only**. New source
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
  Themes must not determine package identity or native host behavior.
- Prose states the mechanism and the reason. No slogans, no imported
  architecture jargon, no empty intensifiers.
- `shells/3ds/src/wm.ts`, `shells/3ds/src/chords.ts` and `shells/3ds/src/shell.ts` are pure and tested. Keep
  them that way: signals, input dispatch and animation live in `shells/3ds/src/store.ts`,
  and drawing lives in the `.tsx` files.

## Assets

Follow `docs/ASSETS.md`: generators and original inputs stay tracked; desktop
SVGs and font atlases are ignored build outputs. Keep only media used by
documentation or tests. New validation runs stay in ignored artifact folders.
`bun run check:assets` enforces these boundaries as part of the main check.

## The loop

```sh
bun run check                        # typecheck + all four shells' unit and sim tests
bun run push --host <console-ip>     # rebuild the guest, hot-push it (~20 s)
bun run deploy --host <console-ip>   # rebuild the .3dsx, install it over the wire, restart into it
bun run shot --host <console-ip>     # a screenshot of both screens
bun run 3ds                          # the full .3dsx in dist/3ds
bun run film                         # re-record media/ from the tapes
bun run goldens                      # byte-compare the pinned frames
```

The iPod app has its own loop:

```sh
bun run ipod guest                        # bundle it (what the sim boots)
POCKETJS_IPODTOUCH4_VIA=x1nano bun run ipod deploy   # build, link, install over usbmuxd
bun run omarchy deploy-host x1nano        # the daemon and its pointer helper
bun run omarchy logs x1nano               # what the daemon saw
bun run omarchy menu x1nano               # regenerate shells/ipod/src/menu.ts from the machine
bun run omarchy shots media          # re-render its screens in the sim
```

The touch shell uses `bun run touch guest|deploy|launch|status|capture` and
`bun run check:touch`. Its own README includes the device test loop.

Desktop commands run through the root dispatcher:

```sh
bun run desktop macos          # or linux / web
bun run desktop build          # native macOS release build
bun run desktop test:web
bun run check:desktop          # or check:3ds / check:ipod
```

Run these commands from the repository root. Each shell also has its own
package.json; desktop artifacts land in `shells/desktop/dist/`.

`shells/3ds/src/` changes are hot pushes, and an accepted push persists on
the card for this app. A change under `vendor/pocketjs/hosts/3ds` is native:
`bun run deploy` writes the new `.3dsx` to `sdmc:/3ds/` through the running
shell and restarts into it, and the restarted `.3dsx` boots the guest it
embeds. **ftpd is needed once, to pair** (ftpd and Pocket Runtime are both
homebrew, and one runs at a time); a Runtime that predates `deploy` takes one
`bun run deploy --ftp --host <ip>` with ftpd open.

## What the tapes are for

`shells/3ds/film/tape.ts` holds the scripted runs. One tape feeds three things: the
animations in `shells/3ds/media/`, the byte-exact frames in `shells/3ds/test/goldens/3ds/`, and the
headless replay in `shells/3ds/test/sim.test.ts`. Add a behaviour worth showing to a tape
rather than filming by hand, and it becomes documentation and a test at once.

**Recovery state is isolated per app.** Pocket Shell uses
`/pocketjs/runtime/apps/552d35dd1578b13f/`. Read its `status.txt` and
`last-error.txt` when investigating guest boot or rollback. Legacy shared
`/pocketjs/runtime/state` does not belong to this app slot.
