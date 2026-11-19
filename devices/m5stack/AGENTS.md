# Working in devices/m5stack

The repository's [AGENTS.md](../../AGENTS.md) applies here: Conventional
Commits, draft pull requests, the prose rules, and no edits under `vendor/`.
This file adds the rules of the firmware tree. Architecture and
implementation notes belong in `docs/`, not here.

## Commits

- The scope names what the change touches: `m5stack` for the tree, a
  component (`worker-esp`, `http-esp`, `pocket-system`), the program
  (`m5stack-tab5`) or an app (`unit-swap`).
- Formatting-only changes to existing code go in their own `style` commit.
- Moving `IDF_COMMIT` in `.github/workflows/firmware-m5stack.yml` is its own
  commit, validated on a device.

## Formatting

- C and C++ sources are formatted by the clang-format version pinned in
  `package.json` (`clang-format-node`) with `.clang-format` in this
  directory. Do not reformat with another clang-format binary.
- No git hook formats a commit. Run `bun run format`, then
  `bun run format:check`, in this directory before pushing; CI runs the
  check.
- Wrap large static tables (panel init sequences, lookup tables, generated
  data) in `// clang-format off` and `// clang-format on`. The markers enclose
  the table and nothing else.

## Tooling

- `bun run setup` at the repository root installs the JavaScript dependencies
  and links the runtime. Use the Bun version in the root `.bun-version` and
  an ESP-IDF release within the range declared in the components'
  `idf_component.yml` (`>=6.0,<6.3`). CI builds with the ESP-IDF commit in
  `IDF_COMMIT`.
- `bun run check:m5stack` at the repository root runs the format check and
  `tools/test-worker-io.sh`: the host C tests under ASan and UBSan and the
  Pocket Link 2 host test against PocketJS's reference Hub. It needs a C
  compiler. `bun run m5stack <script>` runs any script of this package.

## Dependencies and third-party code

- PocketJS is `vendor/pocketjs`, the repository's pinned submodule. Pocket
  Shell, the launcher, is compiled from `shells/3ds/shell` with the iOS 6 kit
  and the icons of `ui/` at the repository root. The applets are
  pocket-nexus/applets, outside this repository; the firmware build reads
  none of them. A pocketjs bump rebuilds every app, Pocket Shell
  included, so a breaking change updates the apps in the same pull request.
- The portable C host services the `pocket_system`, `pocket_camera` and
  `pocket_media` components compile (the Pocket Link 2 client, the launcher's
  app table, `data.fs`, the `.pocket` reader, photo images, quirc, the media
  stream's headers) are `devices/services` at the repository root, shared
  with the 3DS program (`devices/3ds`). After a change there run `bun run check:devices` and
  `bun run check:m5stack`.
- ESP-IDF registry dependencies are declared with exact versions in
  `idf_component.yml`. Each program commits its `dependencies.lock`.
- Code derived from third-party sources keeps its original copyright and
  `SPDX-License-Identifier` lines, and its component README names the source
  and version.

## Directory placement

Paths are relative to `devices/m5stack`.

- Board support for one board: `platforms/esp-idf/m5_bsp_<board>/`.
- Drivers implementing PocketJS contracts: `platforms/esp-idf/pocket_<name>/`.
- Firmware composition, `sdkconfig.defaults`, partitions, the host config
  (`pocket.host.config.ts`) and the program's own host contract
  (`pocket.host.json`): `programs/<program>/`. A host contract shared by
  several programs goes in `hosts/<host-id>/pocket.host.json`.
- Components that only one program uses: `programs/<program>/components/`.
- Apps: `apps/<name>/` with a `pocket.app.json`.
- Build, packaging and test scripts: `tools/`.

## C code

- Every component compiles with `-Wall -Wextra -Werror`. Fix warnings; do not
  silence them with pragmas, casts that hide a defect, or by removing flags.
- Every component states the IDF targets it supports (`REQUIRED_IDF_TARGETS`
  or `targets` in `idf_component.yml`).
- Public headers live under `include/<namespace>/`; private headers stay in
  `src/`. Public symbols carry the component prefix (`pocket_`).
- PocketJS ABI records: set `struct_size` on every record written, validate
  `struct_size` on every record read, and advance record arrays by each
  element's `struct_size`.
- Driver callbacks return PocketJS status codes; ESP-IDF APIs return
  `esp_err_t`. Do not mix the two in one function's return value.

## Build output and validation

- Never commit `build/`, `sdkconfig`, `managed_components/`, `node_modules/`,
  `*.pocket` or `.pocket-build/`. Commit `sdkconfig.defaults`.
- Keep device logs, screenshots, captures and receipts in ignored
  `.pocket-build/validation/<task>/<run>/`.
- A pull request states how the change was validated: commands run, results,
  and for device runs the board revision and panel variant. A firmware build
  or a host-side test is not device validation; say which one was done.

## Documentation

- Reference documentation (`README.md`, `docs/`, component READMEs) is in
  English. It states the mechanism and the concrete facts (pins, sizes,
  limits, versions) without slogans or intensifiers.
- When a change alters a documented behaviour, pin, limit or command, update
  that documentation in the same commit.
