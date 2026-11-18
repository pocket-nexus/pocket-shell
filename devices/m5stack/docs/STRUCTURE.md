# Directory structure

`devices/m5stack` builds PocketJS firmware for M5Stack boards. It consumes
PocketJS from the repository's `vendor/pocketjs` submodule and follows the
directory split of pocketjs `main` (pocket-nexus/pocketjs#603): **platforms**
hold SDK and board drivers, and **programs** compose drivers into firmware
with a host config and the **host contract** (`pocket.host.json`), the facts
apps compile and are admitted against. The launcher, Pocket Shell, is
compiled from `shells/3ds/shell` and the kit in `ui/` of the same repository.

```text
pocket-shell/
├─ .github/workflows/           firmware-m5stack.yml: host checks and the Tab5 build
├─ vendor/
│  └─ pocketjs/                 PocketJS checkout pinned to a commit (submodule)
├─ ui/                          the iOS 6 kit and the icons the launcher draws with
├─ shells/3ds/shell/            Pocket Shell, the launcher the firmware compiles
└─ devices/m5stack/
   ├─ platforms/esp-idf/        ESP-IDF components owned by this tree
   │  ├─ pocket_worker_esp/     FreeRTOS owner of the PocketJS worker core
   │  ├─ pocket_http_esp/       worker http node over esp_http_client
   │  ├─ pocket_mqtt_esp/       worker mqtt node over esp-mqtt (espressif/mqtt)
   │  └─ pocket_io_esp/         worker i2c and uart nodes
   ├─ programs/
   │  └─ m5stack-tab5/          IDF project: main, host config and contract, sdkconfig, partitions
   │     ├─ components/         pocket_system, pocket_camera, pocket_media, pocket_audio,
   │     │                      pocket_device (this program only)
   │     └─ pocket.host.json    tab5-home: 640x360 auxiliary surface, presented at 2x
   ├─ apps/
   │  ├─ unit-swap/             Port A units found and driven by the worker, one at a time
   │  └─ tab5-demo/             the Tab5 factory launcher (M5Tab5-UserDemo) on PocketJS
   ├─ tests/                    host tests: HTTP and MQTT records, I2C descriptors, sensor drivers,
   │                            Unit Swap's conversions and records, the package store on a
   │                            flash image, the Pocket Link 2 host against the reference Hub
   ├─ tools/                    pocket CLI wrapper, app packaging, formatter, host tests,
   │                            tab5-demo artwork conversion, firmware packaging
   │                            (firmware-dist.ts), the apps partition image (apps-partition.ts)
   └─ docs/                     structure and worker reference
```

## Ownership

**PocketJS adapters are board-independent.** `pocket_worker_esp`,
`pocket_http_esp`, `pocket_mqtt_esp` and `pocket_io_esp` implement the worker
host and its `http`, `mqtt`, `i2c` and `uart` nodes against ESP-IDF APIs. They take their configuration from the program, not from a
board. A board support component for one board would go in
`platforms/esp-idf/m5_bsp_<board>/`.

**The program composes and configures.** `programs/m5stack-tab5/main/main.c`
brings up the board through Espressif's `m5stack_tab5_noglib` BSP, creates the
display, input and renderers, starts the launcher services and boots one
runtime per app. The program owns its host contract (`pocket.host.json`);
the host config `pocket.host.config.ts` names it. The build exports
`pocket_profile.h`, whose `pocket_profile.facts` record the runtime admits
packages against, and compiles Pocket Shell (`shells/3ds/shell`) and
the bundled apps with the same host config.

**Components one program uses stay with that program.**
`programs/m5stack-tab5/components/` holds the launcher services, camera,
media, audio (`audio.pcm`, `audio.capture`) and device (`system.device`)
components of that firmware. It builds on board-independent drivers
from `vendor/pocketjs` (`pocket_display_esp_dpi`, `pocket_render_esp_ppa` with
its two-lane factory, `pocket_runner`); it reads the microSD card over SDSPI
because the ESP32-C6 radio takes the SDMMC controller.

**The host contract admits apps by facts.** A package boots its first variant
whose binding generation, raster density, animation class, tick rate,
viewport, presentation, capabilities and auxiliary surface the host contract
provides (pocket-nexus/pocketjs#631); the profile hash only orders variants.
A package compiled for another host with the same facts installs, and a
change to the contract that removes a fact an app uses refuses that app until
it is rebuilt. Each app states `app.tickHz` 30, the Tab5's one cadence.

## Upstream components

The program adds these `vendor/pocketjs` components through
`EXTRA_COMPONENT_DIRS`:

| Component | Use |
| --- | --- |
| `pocket_runtime` | one Rust archive (runtime, software renderer, PPA factory), host hooks, memory package source, CMake package helpers |
| `pocket_guest_quickjs` | QuickJS realm with the generated guest bindings |
| `pocket_runner` | the task that ticks a runtime |
| `pocket_render_esp_ppa` | ESP32-P4 PPA renderer with software fallback |
| `pocket_display_esp_dpi` | strips into one DPI framebuffer, with rotation, scaling and retained moves |

The Rust archive builds from `vendor/pocketjs/programs/esp-idf/archive`
with the submodule's toolchain pin (`rust-toolchain.toml`) unless a prepared
archive is passed with `POCKET_RUNTIME_ARCHIVE`.

## JavaScript workspace

`devices/m5stack` is a package of the repository's Bun workspace
(`devices/*`); its one dependency is `clang-format-node`. `bun run setup` at
the repository root installs PocketJS's dependencies in `vendor/pocketjs`
and links `@pocketjs/framework` and `solid-js` into the root `node_modules`
(`scripts/setup.ts`). `tools/pocket` runs the repository's CLI
(`cli/pocket-shell.ts`, which passes `host export` to the CLI of
`vendor/pocketjs`); the CMake helpers call it through `POCKETJS_CLI`. The apps
under `apps/` and Pocket Shell compile with that CLI, and their imports
resolve to the root's `node_modules`.
