# Pocket Shell on the PSP

The PSP program is a binary crate (`program/`) over PocketJS's `pocketjs-psp`
library (`vendor/pocketjs/programs/psp`, whose README lists the API it builds
on: `module!`, `frame::run`, `frame::Program`, `Runtime::add_provider`,
`Options`). **The launcher is app 0 and every applet that resolves for the PSP
is embedded after it**; one guest runs at a time. `bun run psp` builds the
EBOOT (`shells/3ds/scripts/psp.ts`).

```
pocket-shell-psp.host.json  the host contract, id pocket-shell-psp: PocketJS's psp
                            contract plus link.companion and media.playback,
                            which this program implements
pocket.host.config.ts       the host config `pocket-shell compile --host-config` reads
xmb/Psp.toml                the XMB title; buildPspProgram() writes program/Psp.toml from it
veil-logo.ts                bakes the 128x128 RGBA mark the veil draws
program/                    the crate: Cargo.toml, its own lockfile, build.rs, src/
host-test/                  the link and media code compiled for the build machine
test/host.test.ts           runs host-test/ (`bun run check:devices`)
```

| Source | What it does |
| --- | --- |
| `main.rs` | The module (`pocketjs_psp::module!`) and the loop: boot app `index` through `frame::run`, play the veil, boot the app the guest asked for. **With more than one app the program presents at 20 Hz** and advances the package rate divided by 20 core ticks per frame, so a swap never changes the meaning of a frame or of a captured input tape; a table of one presents at the cadence the runtime selects. Each guest gets its own data directory, its output name (`Options::data_name`). |
| `switch.rs` | The app table and ops 39 `appTable`, 40 `appLaunch` and 41 `appShot` (PocketJS keeps their numbers for a product host); the SELECT summon from an applet back to the launcher; the 256x128 frozen frame op 41 returns. |
| `veil.rs` | The transition between two guests: the last frame, dimmed, with the mark, over 24 frames. |
| `bindings.rs` | `globalThis.link` (`runtime/spec/link.ts`) and `globalThis.media` (`runtime/spec/media.ts`) for every guest, installed from `frame::Program::globals` before the bundle evaluates. |
| `link.rs`, `link_record.rs` | Pocket Link over the PSPLINK share (`host0:/pocket-link`): the companion beats `ready`, the console answers `hello`. A worker thread owns the share. |
| `media.rs`, `media_wire.rs` | `media.playback` over the share's media ring: PAL8 pictures and IMA ADPCM audio (`docs/MEDIA.md`); the audio output's position is the clock. |
| `build.rs` | Embeds the applets: `POCKET_SHELL_REGISTRY` (one `output<TAB>id<TAB>title` line per applet), `POCKET_SHELL_BUNDLES` (the directory of their `<output>.pkb`) and `POCKET_SHELL_VEIL_LOGO`. App 0 is the bundle the library embeds. |

## Build

`bun run psp` resolves the launcher and each applet's app contract against
`pocket-shell-psp.host.json`, compiles each with `cli/pocket-shell.ts compile`
into `dist/psp/packages/<output>.pocket`, checks that the host contract admits
it (`runtime/spec/admission.ts`), and writes the admitted variant as a PocketJS
bundle, `dist/psp/bundles/<output>.pkb` (`runtime/package/bundle.ts`: the two
containers number their sections alike). PocketJS's `buildPspProgram()`
(`vendor/pocketjs/tools/psp.ts`) then builds `program/` with the launcher's
bundle as the embedded application, the table and bundles of the applets and
the veil's mark in the crate's environment, and this host contract as the
profile the program exports and admits against.

```sh
bun run psp                 # devices/psp/program/target/mipsel-sony-psp/release/EBOOT.PBP
bun run psp --skip-eboot    # the packages and bundles only
bun run psp --capture       # the PPSSPPHeadless frame-dump EBOOT (POCKETJS_CAPTURE_INPUT,
                            # POCKETJS_CAP_START and POCKETJS_CAP_N from the environment)
```

The build needs PocketJS's PSP toolchain (`bun vendor/pocketjs/tools/pocket.ts
target add psp`). An applet that needs a worker with an `http` node, touch or a
3DS-sized viewport does not resolve for the PSP and is left out with the
resolver's reasons; at this pin every applet of pocket-nexus/applets is left
out, so the EBOOT carries the launcher alone.

**The program owns the PSPLINK share**: `Options::devtools` is false, so the
library leaves its DevTools mailbox unprobed, and `media::reset()` runs after
each guest ends.

## Tests

`test/host.test.ts` exports this host contract, finds the QuickJS headers the
PSP library pins through Cargo's metadata, and runs `host-test/` with the
stable compiler PocketJS pins: PocketJS's PSP composition files
(`instance.rs`, `service_bindings.rs`) compile for the build machine with the
program's `bindings.rs`, `link_record.rs` and `media_wire.rs`; the link and
media workers are substituted, and QuickJS, the generated bindings, the
runtime and the core are real. The six tests check that `link` and `media`
exist before the bundle evaluates, the `ready` and `hello` records, the hash
the companion uses, and the media stream's header and packet checks against
what the companion encodes.

When the PocketJS pin moves, run `cargo metadata --manifest-path
devices/psp/program/Cargo.toml` and `cargo metadata --manifest-path
devices/psp/host-test/Cargo.toml` once so each lockfile follows PocketJS's
crates.
