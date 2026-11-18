# Contributing

Make changes in the shell that owns the behavior: `shells/3ds`, `shells/touch`
or `shells/desktop`. Tab5 firmware changes go in `devices/m5stack`, changes to
the 3DS host program in `devices/3ds`, and changes to the portable C host
services both compile (the Pocket Link 2 client among them) in
`devices/services`. The Pocket Link's contract and reference implementation,
the applet contract and the agent's guest modules are in `runtime/` and
`link/`. The iOS 6 kit and the icon family the launcher and the applets draw
with are in `ui/`: a change there reaches the launcher and every applet of
[pocket-nexus/applets](https://github.com/pocket-nexus/applets), which builds
against this repository, and a change to one applet goes to that repository.
Changes to the UI framework, the compiler, the engine, the 3DS platform's
hooks and input (`platforms/3ds`) and the PICA renderer land in PocketJS
first, followed by a submodule pin update here; the 3DS platform's media,
offload, SOC and worker sources are `devices/3ds/platform`.

Use Conventional Commit titles and open a draft pull request. Describe the
behavior that changed and the checks performed. Preserve the applicable GPL
license and SPDX notices described in [LICENSING.md](LICENSING.md), along
with third-party asset notices.

Run `bun run setup` and `bun run check` from the root; neither needs an
applets checkout. For desktop preview changes also run
`bun run desktop build:web`, `bun run desktop test:web`
and the site build and smoke check. For Tab5 firmware changes run
`bun run check:m5stack`. For changes under `devices/3ds` or
`devices/services` run `bun run check:devices`, and `bun run check:m5stack`
when `devices/services` changed; `bun run 3ds` builds the `.3dsx`. CI verifies
all shells on macOS and Linux, the shared WASM implementation, the device
programs' host tests and the browser preview; separate workflows build the
`.3dsx` and run the firmware's host checks and its ESP-IDF build.

Keep simulator, native build, browser interaction and physical device
validation distinct when reporting results.
