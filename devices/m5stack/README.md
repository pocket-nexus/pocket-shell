# M5Stack firmware

PocketJS firmware for M5Stack boards, imported from the pocket-m5 repository
with its history. Apps are TypeScript/JSX packages that
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
compiled from this repository's [`shells/3ds`](../../shells/3ds/README.md)
(`shells/3ds/shell`) with the iOS 6 kit and the icons in `ui/` at the
repository root; the applets (Hacker News, YouTube, Notes and the others),
which draw with the same kit, live in
[pocket-nexus/applets](https://github.com/pocket-nexus/applets). The next
firmware build compiles a launcher change in `shells/3ds/shell` or `ui/`.
App workers get an `http` node (`pocket_http_esp`), an `mqtt` node
(`pocket_mqtt_esp`, MQTT 3.1.1 and 5.0) and `i2c` and `uart` nodes
(`pocket_io_esp`); see [Worker domain](docs/WORKER.md).
[`apps/tab5-demo`](apps/tab5-demo/README.md) is the Tab5 factory firmware's
launcher (M5Tab5-UserDemo) on PocketJS.

## Requirements

- ESP-IDF 6.2.x with the `esp32p4` target (`pocket_worker_esp` needs 6.2;
  the other components declare `>=6.0,<6.3`). 6.2 has no release branch;
  CI builds with ESP-IDF `master` at the commit in `IDF_COMMIT` of
  `.github/workflows/firmware-m5stack.yml`.
- Bun, version in the repository root's `.bun-version`
- Rust through rustup, with `riscv32imafc-unknown-none-elf` installed for the
  toolchain pinned in `vendor/pocketjs/rust-toolchain.toml`

## Quick start

```sh
git clone --recurse-submodules https://github.com/pocket-nexus/pocket-shell.git
cd pocket-shell
bun run setup                       # JavaScript dependencies, submodules and runtime links
rustup target add riscv32imafc-unknown-none-elf --toolchain 1.98.1

. $IDF_PATH/export.sh
cd devices/m5stack/programs/m5stack-tab5
idf.py set-target esp32p4
idf.py build
idf.py -p <port> flash monitor
```

The firmware embeds this directory's apps (`apps/tab5-demo`,
`apps/unit-swap`) and installs them at boot, so Pocket Shell lists them without
a computer. The applets install beside them from a paired computer's
Hub over Pocket Link 2 (Pocket Shell `docs/POCKET-LINK.md`); the Mac icon on the
home screen lists what that Hub offers. The home ball returns to Pocket
Shell.
`bun run app build <pocket.app.json>`, run in `devices/m5stack`, compiles
one of these apps with the firmware's host config into `.pocket-build/apps/`;
at the repository root the command is `bun run m5stack app build
apps/<name>/pocket.app.json`.

### Pairing a computer

**The Tab5 pairs by a code it shows** (Pocket Shell `docs/POCKET-LINK.md` §3.11).
With the Tab5 and the computer on one network and a Hub running on the
computer:

1. On the Tab5: Settings > Mac > Pair a Computer..., then the computer in
   the list. The page shows a code of 6 digits, good for 5 minutes.
2. On the computer: enter that code in the Hub.

The Hub mints the link key and sends it under the code; the Tab5 stores it
in its store's `link/` directory and links by itself, now and at every later
start. No card, cable or camera is involved: without a card the store is the
`storage` flash partition. With the reference Hub, `link/v2/cli.ts` in this
repository, from the repository root:

```sh
bun link/v2/cli.ts serve --apps <folder of .pocket files>
bun link/v2/cli.ts pair --code <the 6 digits>
```

`serve` stays in the foreground and names a Tab5 that asks to be paired;
`pair` is run beside it. `bun link/v2/cli.ts status` and `apps` then answer
from the Tab5, and `bun run offer --tab5` at the repository root builds the
applets for this host and serves them from the same Hub.

A Hub can also write the pairing files itself, as it does for a 3DS, onto a
microSD card in the computer's reader (`bun link/v2/cli.ts setup --card
<mounted card> --link-dir link`): the Tab5 reads them from the card at its
next start. A
Tab5 paired by a scanned code under an earlier firmware (Pocket Link 1)
keeps those key files, lists them in Settings > Mac and links to none of
them: forget them there and pair again.
[Pocket link](programs/m5stack-tab5/components/pocket_system/README.md#pocket-link)
has the groups the firmware serves.

### Applets without a computer

A Tab5 can carry the applets without a Mac. `bun run tab5 <applet>…` at the
repository root compiles them from a checkout of pocket-nexus/applets
(`POCKET_APPLETS_ROOT`, default `../applets` beside this repository) against
this host config into `dist/tab5/`;
`-DPOCKETJS_TAB5_BUNDLED_PACKAGES="<a.pocket>;<b.pocket>"`
embeds packages in the firmware image, served from flash like the bundled
apps (the `factory` partition has room for about 3.5 MiB of them beside Pocket
Shell when `POCKETJS_TAB5_BUNDLED_APPS` is empty), and `bun
tools/apps-partition.ts <out.bin> <package.pocket>… --flash <port>` writes
packages onto the 4 MiB `apps` partition as installs would, where a paired
Mac can replace or remove them.

## Firmware builds

`.github/workflows/firmware-m5stack.yml` runs on pull requests and on pushes
to `main` that change `devices/m5stack`, `shells/3ds`, a submodule pin or
the root setup inputs:

- **Host checks**: `bun run format:check` and `tools/test-worker-io.sh`.
- **Tab5 firmware**: installs ESP-IDF at `IDF_COMMIT` (cached per commit) and
  the Rust toolchain of `vendor/pocketjs/rust-toolchain.toml`, runs
  `idf.py build` in `programs/m5stack-tab5`, and packages the build with
  `tools/firmware-dist.ts` into the `pocket-shell-tab5` workflow artifact.

The workflow publishes no release. The releases up to `v0.1.4` are
[pocket-m5's](https://github.com/pocket-nexus/pocket-m5/releases); Pocket
Studio offers the latest of them at <https://studio.pocket.nexus/apps/shell>,
with the install steps at <https://studio.pocket.nexus/docs/install/#tab5>.

The firmware version is `git describe` of the checkout: the latest tag of
this repository, the number of commits since and the commit, such as
`v0.2.0-12-g1a2b3c4`. The packaged files are:

| File | Use |
| --- | --- |
| `pocket-shell-tab5-<version>.bin` | bootloader, partition table and app merged from 0x0; `write-flash 0x0` installs it and erases `nvs` (saved Wi-Fi networks) |
| `pocket-shell-tab5-<version>.zip` | the three images and `flash_args`; `write-flash @flash_args` updates and keeps `nvs` |
| `SHA256SUMS` | SHA-256 of both |

`RELEASE.md`, which `tools/firmware-dist.ts` writes beside them, gives the
pocketjs and ESP-IDF versions and the `esptool` commands. Neither image
writes the `apps` and `storage` partitions or the microSD card, so installed
apps and their data stay. `bun tools/firmware-dist.ts` packages a local build the same
way (into `.pocket-build/dist/`) with the ESP-IDF environment exported.

## Documentation

- [Directory structure](docs/STRUCTURE.md)
- [M5Stack Tab5 firmware](programs/m5stack-tab5/README.md): host contract,
  presentation, launcher services, home ball, keyboard
- [Worker domain](docs/WORKER.md): worker runtime, HTTP and MQTT nodes and validation
- [Engineering conventions](AGENTS.md): formatting, dependencies, C code

## Pinned dependencies

`vendor/pocketjs`, the repository's one PocketJS checkout, is pinned to a
commit on pocketjs `main`. Pocket Link 2 came from pocket-nexus/pocketjs#678
and is this repository's now: the specification (`docs/POCKET-LINK.md`), the
C client `pocket_system` compiles (`devices/services`) and the reference Hub
the host test runs against (`link/v2`). So are the host-facts admission and
the app contracts of pocket-nexus/pocketjs#631 (`runtime/spec`,
`runtime/manifest`); PocketJS keeps the host contracts. The pin
includes pocket-nexus/pocketjs#635, which adds the
`system.device` and `audio.capture` modules, the Wi-Fi access point ops, the
package feature bits the ESP-IDF archive reports for them and the I2C probe
opcode, and re-arms the worker scheduler's host timer after a timer fact.
`main` carries the platform, engine and framework changes of
pocket-nexus/pocketjs#616 that `programs/m5stack-tab5` needs, merged through
pocket-nexus/pocketjs#617, and the worker runtime in `engine/worker` that
`pocket_worker_esp` builds, merged through pocket-nexus/pocketjs#623. The
driver contracts and directory layout come from pocket-nexus/pocketjs#603.

## License

`GPL-3.0-or-later`, the terms of the launcher (`shells/3ds`) that every
firmware image embeds and of the applets; see
[LICENSING.md](../../LICENSING.md). The code was
imported from pocket-m5, which was MIT licensed, and that notice is kept as
[LICENSE.pocket-m5-MIT](LICENSE.pocket-m5-MIT). The Tab5 demo pictures and the
BMI270 feature image keep their own notices
([art/LICENSE](apps/tab5-demo/art/LICENSE),
[BOSCH-LICENSE.txt](apps/tab5-demo/drivers/BOSCH-LICENSE.txt)).
