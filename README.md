# Pocket Shell

Pocket Shell provides shells for handheld devices and desktop operating
systems, built on [PocketJS](https://github.com/pocket-nexus/pocketjs).
The applications live in one repository with one runtime submodule. Each
shell owns its interface and input model.

| Shell | Role | Source and documentation |
| --- | --- | --- |
| Nintendo 3DS | Pocket Home and its apps on the touch screen; Claude's room on the top screen, and L+R asks Claude over any app | [shells/3ds](shells/3ds/README.md) |
| Touch navigation | Full-screen gesture navigation with sixteen mock apps on iPod touch 4 and Nokia E7 | [shells/touch](shells/touch/README.md) |
| Desktop OS | Windows, application launching and Classic 98, XP and Aqua themes on macOS and Linux, with a browser preview; the shell Pocket Studio uses | [shells/desktop](shells/desktop/README.md) |

The former **pocket-desktop** project is now the desktop OS shell in this
repository. Its application code, assets, tests, native build scripts, browser
preview, website and benchmark history are maintained under `shells/desktop/`.
The import preserves its Git history. Existing installed package IDs and
desktop artifact names remain stable.

| Nintendo 3DS | Touch navigation | Desktop |
| --- | --- | --- |
| ![Pocket Home and Claude's room on a 3DS](shells/3ds/media/hw/home.png) | ![Touch navigation Home page](shells/touch/media/home.png) | ![Desktop Aqua theme](shells/desktop/docs/aqua-theme.png) |

The 3DS image is a capture from the console; the touch and desktop images are
simulator renders.

## Archived shells

Two earlier shells are kept on the branch
[`archive/3ds-omarchy-ipod-remote`](https://github.com/pocket-nexus/pocket-shell/tree/archive/3ds-omarchy-ipod-remote),
which is `main` at `78b94b2` before they were removed:

- **The Omarchy-style 3DS shell**: tiling windows on the top screen, chords
  on the shoulders and a deck on the touch screen, with its tapes, 26 golden
  frames, films and hardware screenshots. Release `v2026.10.01` was built
  from it.
- **Pocket Shell on the iPod touch 4**: the Omarchy companion that mirrors
  and controls a Linux desktop over USB or Wi-Fi, with its host daemon,
  pointer helper and menu snapshot.

They are not built or tested on `main`. To work on one, branch from the
archive branch; its README and `AGENTS.md` describe that tree.

## Repository layout

```text
shells/
  3ds/       home, hn and ui sources, scripts, test, media, manifests
  touch/     src (gesture model and mock apps), scripts, test, manifest
  desktop/   src/system-ui, scripts, test, assets, docs, preview, site, manifests
scripts/     setup, desktop command dispatch, repository paths and process helpers
vendor/
  pocketjs/  shared runtime submodule
```

The three shells have separate Bun packages and TypeScript configurations.
See the [asset policy and review](docs/ASSETS.md) for generated outputs,
source inputs and retained documentation fixtures. Application code is separate;
runtime APIs come from `@pocketjs/framework/*`.
The 3DS shell remains specific to its two screens and physical controls.

## Development

Run commands from the repository root. Bun, Rust and the
`wasm32-unknown-unknown` Rust target are required for the complete check.
Native targets have additional requirements in their shell's README.

```sh
git clone --recurse-submodules https://github.com/pocket-nexus/pocket-shell.git
cd pocket-shell
bun run setup
rustup target add wasm32-unknown-unknown
bun run check                    # types, unit and simulator tests for all shells
bun run check:3ds                # or check:touch / check:desktop
```

```sh
bun run desktop macos            # build and launch on macOS
bun run desktop linux            # build and launch on Linux
bun run desktop web              # interactive browser preview
bun run desktop build            # macOS release build without launching
bun run desktop package:linux    # relocatable Linux distribution
bun run desktop test:web         # browser interaction smoke test
bun run desktop build:site
bun run desktop test:site
```

Desktop outputs are in `shells/desktop/dist/`. Use `bun run desktop --help`
to list its commands, including captures, benchmarks and the text companion.

```sh
bun run deploy --host <console-ip> # build Home's .3dsx, install it over the wire and restart into it
bun run push [hn] --host <console-ip>  # rebuild and hot-push Home (or install Hacker News)
bun run offer                    # offer the 3DS apps through the running Pocket Companion
bun run shot --host <console-ip>  # capture both console screens
bun run 3ds                      # full console binary in dist/3ds
bun run touch guest
bun run touch deploy             # portrait gesture shell on the connected iPod
```

PocketJS is pinned through `vendor/pocketjs`, including the 3DS host's agent
stage and the Pocket Link. Runtime changes belong upstream; this repository
selects their commit through its submodule pin.

## License

**GNU GPL version 3.** Root, 3DS and touch code uses
`GPL-3.0-or-later`; imported desktop code retains `GPL-3.0-only`.
PocketJS and third-party fonts retain their own licenses. See
[LICENSING.md](LICENSING.md), [LICENSE](LICENSE) and
[contribution rules](CONTRIBUTING.md).
