# Contributing

Make changes in the shell that owns the behavior: `shells/3ds`, `shells/touch`
or `shells/desktop`. Runtime changes land in PocketJS first, followed by a
submodule pin update here.

Use Conventional Commit titles and open a draft pull request. Describe the
behavior that changed and the checks performed. Preserve the applicable GPL
license and SPDX notices described in [LICENSING.md](LICENSING.md), along
with third-party asset notices.

Run `bun run setup` and `bun run check` from the root. For desktop preview
changes also run `bun run desktop build:web`, `bun run desktop test:web`
and the site build and smoke check. CI verifies all shells on macOS and Linux,
the shared WASM implementation, and the browser preview.

Keep simulator, native build, browser interaction and physical device
validation distinct when reporting results.
