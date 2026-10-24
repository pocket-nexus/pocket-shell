# Working in this repository

Pocket Shell is a product built on PocketJS, which arrives as the
`vendor/pocketjs` submodule. Nothing in `vendor/` is edited here: a runtime
change lands in [pocket-nexus/pocketjs](https://github.com/pocket-nexus/pocketjs)
first, and this repository moves its pin.

The repository holds **three shells**, and a change belongs
to one of them:

- `shells/3ds/` — Pocket Home, the 3DS launcher, and the **Pocket Applets** it
  ships with (Hacker News, YouTube, X, Discord), over one iOS 6 kit in `ui/`.
  **Its only platform is the Nintendo 3DS**: two screens of fixed size, a
  resistive panel with one contact, a d-pad and shoulder buttons. Every
  applet draws on the touch screen and declares `system.agent`; the top
  screen and the L+R agent overlay belong to the PocketJS host and
  framework, not to this repository.
- `shells/touch/` — Pocket Shell Touch, a full-screen gesture shell with
  retained mock apps on iPod touch 4 and Nokia E7. It owns navigation, window
  recency and its device tests.
- `shells/desktop/` — the shell for desktop operating systems, imported from
  pocket-desktop. It owns windows, application presentation and themes.
  PocketJS owns package isolation, scheduling and native composition.
  macOS and Linux are native targets; the browser is an interactive preview.

Each shell owns its sources, manifests, scripts, tests, assets and documentation.
Root scripts provide setup and command routing. They share one runtime
submodule; application code stays separate until a concrete shared need exists.

This project is distributed under **GPLv3**. Root, 3DS and touch code remains
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
- Every program Home runs is a **Pocket Applet**: its manifest declares
  `applet` (services, hosts, store) and meets the applet rules in PocketJS
  `docs/APPLETS.md` — one 320×240 touch surface, a capability allowlist,
  declared network destinations, no native code, no `eval`, size budgets. The
  PocketJS build refuses a broken applet; `test/applets.test.ts` checks every
  one. Home is the launcher and declares no `applet`.
- A manifest entry is relative to `shells/3ds/`, the build's project root;
  `shells/3ds/scripts/apps.ts` lists Home and the applets and resolves their
  plans.
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
bun run push --host <console-ip>     # rebuild Home's package and hot-push it
bun run push hn --host <console-ip>  # rebuild Hacker News, install it into its slot and start it
bun run deploy --host <console-ip>   # rebuild the .3dsx, install it over the wire, restart into it
bun run shot --host <console-ip>     # a screenshot of both screens
bun run offer                        # offer the 3DS applets through the running Pocket Companion
bun run 3ds                          # the full .3dsx in dist/3ds
```

The touch shell uses `bun run touch guest|deploy|launch|status|capture` and
`bun run check:touch`. Its own README includes the device test loop.

Desktop commands run through the root dispatcher:

```sh
bun run desktop macos          # or linux / web
bun run desktop build          # native macOS release build
bun run desktop test:web
bun run check:desktop          # or check:3ds / check:touch
```

Run these commands from the repository root. Each shell also has its own
package.json; desktop artifacts land in `shells/desktop/dist/`.

Changes under `shells/3ds/home`, `hn` or `ui` are hot pushes, and an
accepted push persists on the card for that app. A change under
`vendor/pocketjs/products/3ds`, `platforms/3ds` or `devices/3ds` is native:
`bun run deploy` writes the new `.3dsx` to `sdmc:/3ds/` through the running
Runtime and restarts into it, and the restarted `.3dsx` boots the guest it
embeds. **ftpd is needed once, to pair** (ftpd and Pocket Runtime are both
homebrew, and one runs at a time).
The console takes `.3dsx` files only.

**Recovery state is isolated per app** in
`/pocketjs/runtime/apps/<slot>/` (the slot is the first 16 hex digits of the
SHA-256 of the app id). Read its `status.txt` and `last-error.txt` when
investigating guest boot or rollback.

The Omarchy-style 3DS shell and the iPod touch companion are archived on the
branch `archive/3ds-omarchy-ipod-remote`; see the README.
