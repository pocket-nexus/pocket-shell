# Contributing

Make changes in the shell that owns the behavior: `shells/3ds`, `shells/touch`
or `shells/desktop`. Tab5 firmware changes go in `devices/m5stack`, changes to
the 3DS host program in `devices/3ds`, and changes to the portable C host
services both compile (the Pocket Link 2 client among them) in
`devices/services`. The Pocket Link's contract and reference implementation,
the applet contract and the agent's guest modules are in `runtime/` and
`link/`. UI framework, engine, 3DS platform and renderer changes land in
PocketJS first, followed by a submodule pin update here.

Use Conventional Commit titles and open a draft pull request. Describe the
behavior that changed and the checks performed. Preserve the applicable GPL
license and SPDX notices described in [LICENSING.md](LICENSING.md), along
with third-party asset notices.

Run `bun run setup` and `bun run check` from the root. For desktop preview
changes also run `bun run desktop build:web`, `bun run desktop test:web`
and the site build and smoke check. For Tab5 firmware changes run
`bun run check:m5stack`. For changes under `devices/3ds` or
`devices/services` run `bun run check:devices`, and `bun run check:m5stack`
when `devices/services` changed; `bun run 3ds` builds the `.3dsx`. CI verifies
all shells on macOS and Linux, the shared WASM implementation, the device
programs' host tests and the browser preview; separate workflows build the
`.3dsx` and run the firmware's host checks and its ESP-IDF build.

Keep simulator, native build, browser interaction and physical device
validation distinct when reporting results.
