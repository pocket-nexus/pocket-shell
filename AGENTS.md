# Engineering conventions

These rules bind every change to this repository, by people and by agents.
Architecture and implementation notes belong in `docs/`, not here.

## Commits and pull requests

- Commit messages and pull request titles use Conventional Commits:
  `type(scope): summary`. Types: `feat`, `fix`, `perf`, `refactor`, `docs`,
  `test`, `build`, `ci`, `chore`, `style`, `revert`. The `commit-msg` hook
  runs commitlint with `commitlint.config.mjs`.
- The scope names the directory the change touches: a component
  (`worker-esp`, `http-esp`, `pocket-system`), a program (`m5stack-tab5`), an
  app (`unit-swap`), `tools`, `docs` or `deps`. Omit the scope only for
  repository-wide changes.
- The header is at most 72 characters; the summary is imperative, lower case,
  without a trailing period.
- One logical change per commit. Formatting-only changes to existing code go
  in their own `style` commit.
- A `third_party/pocketjs` bump is its own commit,
  `build(deps): bump pocketjs to <short-sha>`, with the upstream commit range
  in the body.

## Formatting

- C and C++ sources are formatted by the clang-format version pinned in
  `package.json` (`clang-format-node`) with the root `.clang-format`. Do not
  reformat with another clang-format binary.
- The `pre-commit` hook formats staged C and C++ files and stages the result.
  Do not bypass hooks (`--no-verify`, `LEFTHOOK=0`). Run `bun run format:check`
  before pushing.
- Wrap large static tables (panel init sequences, lookup tables, generated
  data) in `// clang-format off` and `// clang-format on`. The markers enclose
  the table and nothing else.

## Tooling

- `bun install` installs the JavaScript dependencies and the git hooks.
  `lefthook.yml` is the only hook definition; do not add scripts to
  `.git/hooks`.
- Use the Bun version in `.bun-version` and an ESP-IDF release within the
  range declared in the components' `idf_component.yml` (`>=6.0,<6.3`).
  CI and releases build with the ESP-IDF commit in `IDF_COMMIT` of
  `.github/workflows/firmware.yml`; moving it is its own commit, validated on
  a device.

## Dependencies and third-party code

- `third_party/pocketjs` and `third_party/pocket-shell` are pinned
  submodules. Do not edit files in them from this repository; land the
  change upstream, then bump the submodule. Pocket Shell, the launcher, is
  compiled from `third_party/pocket-shell/shells/3ds/shell` with its
  `vendor/applets` (the iOS 6 kit and the icons); a launcher change for the
  Tab5 lands in pocket-shell. A pocketjs bump rebuilds every app, Pocket
  Shell included, so a breaking change updates the apps in the same pull
  request.
- ESP-IDF registry dependencies are declared with exact versions in
  `idf_component.yml`. Each program commits its `dependencies.lock`.
- Code derived from third-party sources keeps its original copyright and
  `SPDX-License-Identifier` lines, and its component README names the source
  and version.

## Directory placement

- Board support for one board: `platforms/esp-idf/m5_bsp_<board>/`.
- Drivers implementing PocketJS contracts: `platforms/esp-idf/pocket_<name>/`.
- Firmware composition, `sdkconfig.defaults`, partitions, the host config
  (`pocket.host.config.ts`) and the program's own host contract
  (`pocket.host.json`): `programs/<program>/`. A host contract shared by
  several programs goes in `hosts/<host-id>/pocket.host.json`.
- Components that only one program uses: `programs/<program>/components/`.
- Apps: `apps/<name>/` with a `pocket.app.json`.
- Build, packaging and repository scripts: `tools/`.

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
