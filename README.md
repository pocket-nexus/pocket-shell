# pocket-m5

PocketJS firmware for M5Stack boards. Apps are TypeScript/JSX packages that
run in a QuickJS guest on the PocketJS runtime; the firmware embeds Pocket
Shell as its launcher, installs packages from a paired computer over Pocket
Link 2 and switches between them on the device.

| Board | SoC | Display |
| --- | --- | --- |
| M5Stack Tab5 | ESP32-P4 | 720×1280 MIPI-DSI, capacitive touch |

[`programs/m5stack-tab5`](programs/m5stack-tab5/README.md) is the Tab5
firmware: Pocket Shell 640×360 at 2x, turned onto the panel; installs over the
Pocket Link; a floating home ball; Wi-Fi with an optional access point,
SNTP clock, worker HTTP, MQTT, I2C and RS485 nodes, camera, media, PCM audio and
microphones, board controls and keyboard. Pocket Shell, the launcher, is
compiled from the [pocket-shell](https://github.com/pocket-nexus/pocket-shell)
submodule at `third_party/pocket-shell` (`shells/3ds/shell`); the applets
(Hacker News, YouTube, Notes and the others), the iOS 6 kit they share with
the launcher and every icon live in
[pocket-nexus/applets](https://github.com/pocket-nexus/applets), pocket-shell's
`vendor/applets`. A launcher change lands in pocket-shell, then this
repository bumps the submodule.
App workers get an `http` node (`pocket_http_esp`), an `mqtt` node
(`pocket_mqtt_esp`, MQTT 3.1.1 and 5.0) and `i2c` and `uart` nodes
(`pocket_io_esp`); see [Worker domain](docs/WORKER.md).
[`apps/tab5-demo`](apps/tab5-demo/README.md) is the Tab5 factory firmware's
launcher (M5Tab5-UserDemo) on PocketJS.

## Requirements

- ESP-IDF 6.2.x with the `esp32p4` target (`pocket_worker_esp` needs 6.2;
  the other components declare `>=6.0,<6.3`). 6.2 has no release branch;
  CI builds with ESP-IDF `master` at the commit in `IDF_COMMIT` of
  `.github/workflows/firmware.yml`.
- Bun, version in `.bun-version`
- Rust through rustup, with `riscv32imafc-unknown-none-elf` installed for the
  toolchain pinned in `third_party/pocketjs/rust-toolchain.toml`

## Quick start

```sh
git clone <repository-url> pocket-m5
cd pocket-m5
git submodule update --init third_party/pocketjs third_party/pocket-shell
git -C third_party/pocket-shell submodule update --init vendor/applets
bun install                         # JavaScript dependencies and git hooks
rustup target add riscv32imafc-unknown-none-elf --toolchain 1.98.1

. $IDF_PATH/export.sh
cd programs/m5stack-tab5
idf.py set-target esp32p4
idf.py build
idf.py -p <port> flash monitor
```

The firmware embeds this repository's apps (`apps/tab5-demo`,
`apps/worker-http`, `apps/unit-swap`, `apps/worker-mqtt`) and installs them at boot, so Pocket Shell lists them
without a computer. The applets install beside them from a paired computer's
Hub over Pocket Link 2 (pocketjs `docs/POCKET-LINK.md`); the Mac icon on the
home screen lists what that Hub offers. The home ball returns to Pocket
Shell.
`bun run app build <pocket.app.json>` compiles an app of this repository
with the firmware's host config into `.pocket-build/apps/`.

### Pairing a computer

**The Tab5 pairs by a code it shows** (pocketjs `docs/POCKET-LINK.md` §3.11).
With the Tab5 and the computer on one network and a Hub running on the
computer:

1. On the Tab5: Settings > Mac > Pair a Computer..., then the computer in
   the list. The page shows a code of 6 digits, good for 5 minutes.
2. On the computer: enter that code in the Hub.

The Hub mints the link key and sends it under the code; the Tab5 stores it
in its store's `link/` directory and links by itself, now and at every later
start. No card, cable or camera is involved: without a card the store is the
`storage` flash partition. With the reference Hub in the pocketjs checkout:

```sh
bun run --cwd third_party/pocketjs link2 serve --apps <folder of .pocket files>
bun run --cwd third_party/pocketjs link2 pair --code <the 6 digits>
```

`serve` stays in the foreground and names a Tab5 that asks to be paired;
`pair` is run beside it. `link2 status` and `link2 apps` then answer from the
Tab5, and pocket-shell's `bun run offer --tab5` builds the applets for this
host and serves them from the same Hub.

A Hub can also write the pairing files itself, as it does for a 3DS, onto a
microSD card in the computer's reader (`link2 setup --card <mounted card>
--link-dir link`): the Tab5 reads them from the card at its next start. A
Tab5 paired by a scanned code under an earlier firmware (Pocket Link 1)
keeps those key files, lists them in Settings > Mac and links to none of
them: forget them there and pair again.
[Pocket link](programs/m5stack-tab5/components/pocket_system/README.md#pocket-link)
has the groups the firmware serves.

### Applets without a computer

A Tab5 can carry the applets without a Mac. pocket-shell's `bun run tab5
<applet>…` compiles them from its `vendor/applets` against this host config
(`POCKET_M5_ROOT`); `-DPOCKETJS_TAB5_BUNDLED_PACKAGES="<a.pocket>;<b.pocket>"`
embeds packages in the firmware image, served from flash like the bundled
apps (the `factory` partition has room for about 3.5 MiB of them beside Pocket
Shell when `POCKETJS_TAB5_BUNDLED_APPS` is empty), and `bun
tools/apps-partition.ts <out.bin> <package.pocket>… --flash <port>` writes
packages onto the 4 MiB `apps` partition as installs would, where a paired
Mac can replace or remove them.

## Firmware releases

`.github/workflows/firmware.yml` runs on pull requests, on pushes to `main`
and on `v*` tags:

- **Host checks**: `bun run format:check` and `tools/test-worker-io.sh`.
- **Tab5 firmware**: installs ESP-IDF at `IDF_COMMIT` (cached per commit) and
  the Rust toolchain of `third_party/pocketjs/rust-toolchain.toml`, runs
  `idf.py build` in `programs/m5stack-tab5`, and packages the build with
  `tools/firmware-dist.ts` into the `pocket-m5-tab5` workflow artifact.
- **Release**, on a `v*` tag only: publishes the packaged files as a GitHub
  release of that tag; a tag with a suffix (`v0.2.0-rc1`) is a prerelease.

The firmware version is `git describe` of the checkout, so a tagged build is
`pocket-m5-tab5-v0.1.0`. To publish one:

```sh
git tag -a v0.1.0 -m "pocket-m5 v0.1.0"
git push origin v0.1.0
```

A release holds:

| File | Use |
| --- | --- |
| `pocket-m5-tab5-<version>.bin` | bootloader, partition table and app merged from 0x0; `write-flash 0x0` installs it and erases `nvs` (saved Wi-Fi networks) |
| `pocket-m5-tab5-<version>.zip` | the three images and `flash_args`; `write-flash @flash_args` updates and keeps `nvs` |
| `SHA256SUMS` | SHA-256 of both |

Pocket Studio offers the latest release at
<https://studio.pocket.nexus/apps/shell>, with the install steps at
<https://studio.pocket.nexus/docs/install/#tab5>.

The release notes (`RELEASE.md` from `tools/firmware-dist.ts`) give the
pocketjs and ESP-IDF versions and the `esptool` commands. Neither image
writes the `apps` and `storage` partitions or the microSD card, so installed
apps and their data stay. `bun tools/firmware-dist.ts` packages a local build the same
way (into `.pocket-build/dist/`) with the ESP-IDF environment exported.

## Documentation

- [Repository structure](docs/STRUCTURE.md)
- [M5Stack Tab5 firmware](programs/m5stack-tab5/README.md): host contract,
  presentation, launcher services, home ball, keyboard
- [Worker domain](docs/WORKER.md): worker runtime, HTTP and MQTT nodes and validation
- [Engineering conventions](AGENTS.md): commits, formatting, dependencies

## Pinned dependencies

`third_party/pocketjs` is pinned to a commit on pocketjs `main`, the commit
pocket-shell pins. It carries Pocket Link 2 (pocket-nexus/pocketjs#678): the
specification, the C client `pocket_system` compiles and the reference Hub
the host test runs against. It
includes the host-facts admission, host contracts and app contracts of
pocket-nexus/pocketjs#631, and pocket-nexus/pocketjs#635, which adds the
`system.device` and `audio.capture` modules, the Wi-Fi access point ops, the
package feature bits the ESP-IDF archive reports for them and the I2C probe
opcode, and re-arms the worker scheduler's host timer after a timer fact.
`main` carries the platform, engine and framework changes of
pocket-nexus/pocketjs#616 that `programs/m5stack-tab5` needs, merged through
pocket-nexus/pocketjs#617, and the worker runtime in `engine/worker` that
`pocket_worker_esp` builds, merged through pocket-nexus/pocketjs#623. The
driver contracts and directory layout come from pocket-nexus/pocketjs#603.

## License

MIT, see [LICENSE](LICENSE). Pocket Shell (`third_party/pocket-shell`) and
the applets are `GPL-3.0-or-later`; a firmware image that embeds Pocket Shell
contains that code.
