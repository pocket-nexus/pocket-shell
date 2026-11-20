# pocket_system

The system services of the Tab5 as a launcher console: installed apps and
switching between them, the Pocket Link 2 client to a paired Hub, a guest's
`data.fs` tree, the Wi-Fi radio, the SNTP clock and installs from an install
QR code.

- Public header: `pocket/system.h`
- CMake functions: `project_include.cmake` (`pocket_shell_compile_app`,
  `pocket_shell_embed_package`, "Packages in the firmware image")
- Shared state machines: `devices/services` (`link2.c` with
  `link2_proto.c`, `link2_guest.c`, `link2_http.c` and `link2_bsd.c`,
  `launcher.c`, `fs.c`, the `.pocket` reader `pocket_container.c`), compiled
  from the repository
- `esp_wifi` comes from `espressif/esp_wifi_remote` and `espressif/esp_hosted`,
  which the program lists with its coprocessor's pins

## Store

`pocketjs_system_start` takes one mounted directory and the name of a data
partition:

| Place | Contents |
| --- | --- |
| `link/device.txt` | the device id, which the firmware makes at its first start |
| `link/companions/<hub id>.txt` | a paired Hub's key file: written by the firmware when a code paired it, or by that Hub onto a card ("Pocket Link") |
| `link/companions/<hub id>.last` | the name, address and port of that Hub's last link, when they differ from the key file's |
| `apps/<slot>/app.txt` | the launcher's cached facts (output, id, title, version) |
| `apps/<slot>/data/` | the guest's `data.fs` tree, quota from `applet.store` |
| `apps/<slot>/link-upload.pocket`, `url-upload.pocket` | an install staged in a file: from a code, or from the Hub when it cannot stream into the partition |
| the `packages_partition` (`apps`) | the installed packages, one extent of 64 KiB pages each |
| `apps/<slot>/package.pocket` | a package installed when the firmware had no `apps` partition |

`<slot>` is the first 16 hex digits of SHA-256 of the app id. A stored
package is an extent of whole pages of the `apps` partition
(`flash_store.c`): a 64-byte header, the package from offset 64, padding to
the page. The bytes go first and the header last, so an install that is cut
off or refused leaves free pages, never a package the firmware would refuse;
a replaced or removed package has the state word of its header cleared in
place. The whole partition is mapped read-only once, so an installed package
is read from flash where it is, like an embedded one.

**An install from the Hub streams into the partition.** The engine writes an
install with stdio into the path the host gives it; `flash_stage.c` gives it
a path whose bytes go to the partition as they are written. A run of free
pages is set aside for the size the Hub declares, each page is erased when
the bytes reach it, and each piece is programmed before the write returns.
The link grants the Hub credit for more only after it has handed a piece
over, so at most 64 KiB (the stream's window) are on their way while flash
is written, and no file, on the card or on the `storage` partition, holds
the package. When the last byte is in, the package is admitted where it lies
("Admission": the container's hashes, then the first variant the firmware's
host facts satisfy) and its header is written: no copy is read back into PSRAM and
nothing is programmed twice. On a Tab5 523,864 bytes took 3.4 s from the
first byte to the commit, and the longest frame in it was 423 ms. A flash
write stalls the other tasks for each piece, so the frames slow down for as
long as the install runs.

**An install is staged in a file of the store instead**
(`apps/<slot>/link-upload.pocket`), read into PSRAM when it is whole and
programmed in one piece, when the partition has no run of free pages for it
(the slot's own pages are then reused: an interrupted install loses the app),
when another install is streaming, and when the firmware has no `apps`
partition. An install from a code is staged the same way
(`url-upload.pocket`). Programming a package in one piece holds one frame:
2,048 ms for 467,288 bytes on a Tab5. The running app cannot be replaced: an
install into its slot is refused until the launcher runs. Without the
partition, or when no run of pages is free, an install fails with that
reason; a `package.pocket` an earlier firmware kept under the store is moved
to the partition at start when it fits and is read into PSRAM at each launch
otherwise.

Start lists every package the partition holds: a package whose slot
directory is missing from the store (another card, or a partition written
over USB by `tools/apps-partition.ts`) gets the directory, and the launcher
reads its facts from the package on the next table scan.

The `bundled` packages of `pocketjs_system_config_t` stay in the firmware
image: start admits each once and keeps its facts, removes a
`package.pocket` or installed copy an earlier firmware kept for its slot,
and rewrites the slot's `app.txt` when the cached hash differs. They are
installed apps the Hub can neither replace nor remove. The runtime
reads every package where it is, without a copy or a second hash pass:
the admission here is the hash pass.

**Without a card the directory is LittleFS on the `storage` partition**
(`pocketjs_system_mount_flash`, the `joltwallet/littlefs` component).
LittleFS writes a change beside what it replaces and commits it in one
program, so a reset or a power cut inside a write leaves the file as it was
or as it was to be. The partition held FatFs over wear levelling before:
that pair writes a sector as an erase and a program, and a Tab5 that was
reset between the two, 4 s into its first start without a card, kept an
erased allocation table. FatFs reads that table as a full volume, so the
store mounted and took no write from then on: the device made a new id at
every start and kept no `data.fs` and no pairing.

**A partition that holds no LittleFS is formatted at start**: a new one, and
the FAT volume an earlier firmware kept there, whose files are not carried
over. A Tab5 with a card keeps its store on the card and loses nothing. On a
Tab5 the format took 35 ms. Eight starts were reset inside the writes of the
store's first files, four of them while a file was being written: each
mounted at the next start, with no format and no error. The reset was the
chip's, over USB; a cut of the flash chip's own power was not tried.

## Admission

`package.c` admits a `.pocket` (format 2, Pocket Shell
`docs/POCKET-PACKAGE.md`) and is the package source the runtime boots it
from:

1. `pocket_container_open` (`devices/services/pocket_container.c`) verifies
   the whole container: header, layout, target ids, the footer (FNV-1a64 of
   every byte before it) and each variant's payload hash. The footer is the
   package's hash: `app.txt`, the `apps` partition's headers and the Pocket
   Link name the package by it, and a package whose footer is 0 is refused,
   0 standing for any package in a load or an install.
2. `pocket_container_select` offers the variants in the order
   `runtime/spec/admission.ts` selects them: those compiled against the
   host's profile hash, then the rest, each group in file order.
3. Each offer is `pocket_idf_package_open_source` (the IDF archive) on the
   package source with that variant's sections stated
   (`pocket_package_sections`: plan, JavaScript, asset pack, bytecode,
   worker source and worker bytecode, offsets from the container's first
   byte, and the variant's binding generation). PocketJS admits the plan
   against the exported host facts as boot does and reads the app id from
   the plan's `app.id`; its slot is the first 16 hex digits of the id's
   SHA-256. The first variant admitted is the app's.

| Message | Cause |
| --- | --- |
| `the file is not a .pocket package (2)`, `(3)` | another magic, such as a PocketJS bundle (`.pkb`), or another format version |
| `the package is damaged (<code>)` | a `POCKET_PACKAGE_OPEN_*` code: the container's layout or hashes (1, 4, 5, 17; 4 also for a footer of 0), no app id in the plan (8), a plan admission cannot read (9, 13 to 15), a missing or malformed code section (10, 11, 18, 26), a variant without a plan (27) |
| `the package has no variant` | a container with no variant |
| `the package was built for another binding generation` | the first variant offered was compiled for another `host_abi` (7) |
| `tab5-home does not provide the package's <item>` | the first admission item the first variant offered fails (19 to 25): raster density, animation class, tick rate, viewport, presentation, capabilities, auxiliary surface |

`pocketjs_system_app_source` returns that source for a loaded app: `length`
and `all` give the whole container, `range` copies from it, `take` hands the
runtime the bytes in place with no release, and `sections` states the
admitted variant. With stated sections the runtime checks no container hash,
so the reader's pass at admission is the only one, and the bytes stay where
they are: the firmware image, the mapped `apps` partition, or the PSRAM copy
of a package read from the card, released after the runtime is destroyed.

`tests/package.test.ts` builds `package.c` with the reader under ASan and
UBSan against the contract `tools/pocket host export` writes, with
`tests/package-admission.c` in place of PocketJS's admission: the stated
sections, slot, hashes and worker sections of an admitted package, every
callback of its source, the offer order and each message above.

## Packages in the firmware image

ESP-IDF includes `project_include.cmake` in every project that builds this
component. Its functions link `.pocket` files into the image as
`const pocketjs_system_package_t pocketjs_package_<name>` (`pocket/system.h`),
declared in `pocketjs_package_<name>.h`:

| Function | Package |
| --- | --- |
| `pocket_shell_compile_app(TARGET NAME MANIFEST [HOST_CONFIG] [PROJECT_ROOT] [PROFILE_EXPORT_DIR] [COMPILER_RECEIPT] [DEPENDS])` | compiled at build time from a `pocket.app.json` by Pocket Shell's CLI (`POCKETJS_CLI compile --manifest --host-config --depfile`) into `<binary dir>/pocket-shell/<name>/<name>.pocket`; the depfile lists the app's sources, theme and icon, the host config and the compiler's modules, so an edit to any of them compiles the app again |
| `pocket_shell_embed_package(TARGET NAME PACKAGE [HOST_CONFIG] [PROFILE_EXPORT_DIR])` | a prebuilt `.pocket` |

Both export the host config's contract with PocketJS's
`pocketjs_profile_header` (`pocket_profile.h` and `pocket.host.json` in
`PROFILE_EXPORT_DIR`, default `<binary dir>/pocket-shell/profile`, on the
target's include path) and run `devices/m5stack/tools/embed-package.ts`,
which checks the package as start admits it (layout and hashes, a variant
the exported contract admits, an app id in its plan) and writes
`pocketjs_package_<name>.{h,c,S}`: the `.S` includes the file with `.incbin`
in `.rodata` at 16-byte alignment. A package the firmware would refuse
fails the build. `HOST_CONFIG` defaults to
`${CMAKE_SOURCE_DIR}/pocket.host.config.ts`, `PROJECT_ROOT` to the
manifest's directory; `NAME` matches `[a-z][a-z0-9_]*`. The build needs Bun
on `PATH`.

## Guest lifecycle

The program loads the launcher (`pocketjs_system_load_launcher`), creates the
guest, calls `pocketjs_system_bind` with its realm and boots the runtime
with the app's package source (`pocketjs_system_app_source`, "Admission").
Each tick, before the turn, it calls `pocketjs_system_pump`; SELECT outside the launcher calls
`pocketjs_system_summon`. When `pocketjs_system_switch_pending` becomes true,
the program stops the runner, destroys the runtime and guest, calls
`pocketjs_system_unbind`, takes the target with `pocketjs_system_take_switch`
and boots it.

## Guest namespaces

| Global | Contract |
| --- | --- |
| `ui.appTable`, `ui.appLaunch`, `ui.appShot` | the `applications` operations, served by the program's operation provider from `pocketjs_system_app_table` and `pocketjs_system_launch` |
| `link` | `contracts/spec/link.ts` on Pocket Link 2 (`link2_guest.c`): `status`, `forget`, `catalog`, `install`, `remove`, `poll`, and `pairOpen`, `pairAsk`, `pairClose` for the pairing by a code ("Pocket Link"). `pair`, version 1's call for a scanned code, answers false. `status()` carries `limit`, the connection's payload limit, which a version 1 host's status does not have |
| `wifi` | `contracts/spec/wifi.ts`, with `scan`, `join` and `forget` |
| `fs` | `contracts/spec/fs.ts`, when the plan's features hold `data.fs` |
| `installer` | the launcher only: installs from an install QR code (below) |

The radio keeps three saved networks in NVS (namespace `pocketwifi`), joins
the most recently used at start, and saves a joined network once it has an
address. Storage and NVS are flash, so every call runs on one task with an
internal stack while the guest's task waits. A scan start, a scan result and
an RSSI read each cross the SDIO link to the ESP32-C6 and wait for its answer:
the `pocketjs_radio` task (8 KB, internal RAM) makes those calls, a scan when
the guest asked for one (`scan_requested`, `scan_done`) and the RSSI read on
an interval while connected; `status` answers from the cached state without
touching the link.

## Installs from a code

Pocket Shell installs an app from a QR code that holds an install URI:

```
pocketlink://install?v=1&a=<app id>&s=<sha256>[&n=<title>]&u=<url>
```

`a` is the manifest id the package carries, `s` the SHA-256 of the whole
`.pocket` file in 64 lowercase hex digits, `n` an optional percent-encoded
title, and `u` the package's `http://` or `https://` address. `u` comes
last and runs to the end of the URI, taken as written, so an address keeps
its own `&` and `%`; it holds no `#` or whitespace and is at most 200
bytes. A URI is at most 400 bytes. `install_uri.c` reads it;
`tests/install-uri.c` runs it under ASan and UBSan.

Only the launcher gets the namespace (`install.c`):

| Function | Result |
| --- | --- |
| `installer.installUri(uri)` | a request id, or `-1` when the URI does not parse or an install is running |
| `installer.poll()` | one JSON array of the events since the last call, or `undefined` |

The events have the shapes of the link's install events:
`{"t":"install.progress","id","app","received","bytes"}` (`bytes` is 0 while
the server has not said the length), then `{"t":"install.done","id","app","output"}`
or `{"t":"error","id","message"}`.

`fetch.c` downloads over `esp_http_client`. One download runs at a time, on
the `pocket_fetch` task: 12 KB of internal RAM for its stack, because it
writes the store, held only while the download runs. It waits for an address,
and for an `https://` address for the SNTP clock (at most 15 s), since
certificate dates are checked against it; with no SNTP answer by then it sets
a clock earlier than the firmware's build time to the build time, so a
certificate issued before the build passes, and SNTP corrects it later.
HTTPS uses the ESP certificate bundle with mbedTLS buffers in PSRAM. It
follows at most three redirects, accepts only a `200`, refuses a body over
24 MiB, writes 16 KB reads to `apps/<slot>/url-upload.pocket` and hashes
them with SHA-256. A connect or a read waits at most 10 s; a read that times
out is tried again until no byte has come for 30 s. `install_pump`, on
the system task once per frame, compares the hash with the URI's and commits
the package with `link_host_install`, the path of an install from the Hub: it admits the
package by the firmware's host facts ("Admission") and refuses
one whose app id does not hash to the slot of `a`, as it does for a package
read from any slot. A guest switch keeps the download running and drops only
its events.

## Pocket Link

`link2_host.c` creates the firmware's one Pocket Link 2 client (pocketjs
`docs/POCKET-LINK.md`, `devices/services/link2.h`) at start and pumps it
once per frame on the system task. Its sockets are lwIP's BSD sockets
(`link2_bsd.c`); while the radio has no address every socket call answers
"gone", so the link drops when the address does and searches again when it
is back.

The firmware lists these groups in its `hello` (§6.1):

| Group | What the firmware does |
| --- | --- |
| `apps` | reports the launcher's row and the launcher's table as `runtime.apps`, after `ready` and after each install or removal |
| `runtime` | answers `runtime.status`, switches to an installed app on `runtime.launch`, and installs and starts a package on `runtime.push` (below); a screenshot answers `unsupported` |
| `runtime.remove` | removes an installed applet at the Hub's request; never the launcher, the running app or a bundled package |
| `catalog`, `install` | the store of `globalThis.link`: the Hub's offer for target `tab5-home`, and a package streamed into the `apps` partition ("Store") |
| `net.http` | the worker's requests to `companion.pocket` ("Companion services") |

It opens no applet channel, runs no agent and has no DevTools stream. The
Tab5 keeps one committed package a slot and no record of package generations
or of a last good package, so `runtime.status` says `generation` 0 and
`lastGood` zeros; `active` and `running` are the hash of the package that
runs, `phase` is `starting`, `booted` or `switching`, and `frame` counts the
pumps.

**A push from the Hub** (§6.2 `runtime.push`) is how a Hub installs an applet
on the Tab5 without the owner opening the store on the device. Its bytes
stream into the stage of the `apps` partition as a catalog install's do
("Store"), and nowhere else: a push finds the stage taken by another install
and answers `busy`, finds no run of free pages and answers `storage` with
the free space, and is never staged in a file. The request names no app, so
the slot is the one the package's own app id hashes to, read when the last
byte is in. Admission is a catalog install's ("Admission"); a package whose
footer is not the declared hash, that no variant of fits this firmware, or
whose slot holds a package of the firmware image (the launcher's among
them) is refused with `rejected`, phase `rejected`, and its pages stay free.
An admitted package is committed in its slot and the launcher switches to
it; the `staged` event leaves when its guest binds and the `accepted` reply
at its first frame. A guest that does not boot puts the launcher in its
place as for any app, and the push ends with `rejected` and "the app did
not start", the package installed. **A push of the running app** is held
admitted and uncommitted while that app runs, because it reads its package
from the pages the commit frees: the switch is requested at admission, the
commit made when its guest is torn down (`link2_host_guest_end`), and the new
package boots in its place. A push that has not reached its app's first
frame 20 s after admission ends with `timeout`, under the Hub's 30 s
(§5.5).

**Pairing.** The Tab5 pairs by a code it shows (§3.11): its owner opens a
pairing in the launcher (`link.pairOpen()`), the client makes a code of 6
digits and lists the Hubs whose beacons it hears, the owner chooses one
(`link.pairAsk(hub)`), and that Hub's owner enters the code. The Hub's offer
carries the link key under the code; the client checks its proof, writes
`link/companions/<hub id>.txt` itself and links by the handshake of §3.3.
A code lasts 5 minutes and takes 3 offers with a wrong proof. Nothing but
the store is needed, so a Tab5 without a card, whose store is the `storage`
flash partition, pairs the same way. `link.status().pair` carries the code,
what is left of its time and tries, and the Hubs to choose from. A Hub can
also write `link/device.txt` and its key file onto a card in its computer's
reader, the procedure of §3.2 with the link directory `link`; the client
reads them when the firmware starts. Key files a version 1 firmware wrote
under `link/companions/` have the same format: the client loads them, lists
them in `link.status()` and links to none, since no version 2 Hub holds
their id and key; `link.forget` removes them.

**Memory.** Internal RAM that DMA reaches is what the Wi-Fi coprocessor's
driver takes a buffer from for every packet (`eh_sdio`), and an applet with a
worker and an HTTPS request leaves little of it, so the link keeps none:

- The client allocates once, at start (`link2.h`, "Memory"): its record
  (12,520 bytes), a 16,384-byte receive buffer, a 32,780-byte send buffer and
  its request and stream tables (11,208 bytes), 72,892 bytes in all. Each but
  the send buffer is at most `CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL` (16,384)
  bytes, which `malloc` places in internal RAM. `CMakeLists.txt` therefore
  compiles `link2.c` with its `malloc` and `calloc` named
  `pocket_system_link_malloc` and `pocket_system_link_calloc`
  (`services_host.c`), which take PSRAM first.
- The static state of `link2.c`, `link2_guest.c`, `link2_http.c` and
  `link2_host.c`, 26,152 bytes of `.bss` (20,668 of them the two HTTP
  requests below), is placed in PSRAM by `linker.lf`
  (`CONFIG_SPIRAM_ALLOW_BSS_SEG_EXTERNAL_MEMORY`; the map file lists no
  other object in `.ext_ram.bss`). Every function of those files runs on the
  system task.

Measured on a Tab5 in the launcher, linked, as the free bytes of
`MALLOC_CAP_DMA`: 68,515 with both; 39,451 with the static state in internal
RAM; 47,291 for the version 1 firmware before this port. Hacker News leaves
about 25 KB of them while it runs and each of its HTTPS requests takes about
8 KB more: with 39,451 at the start its first request found 551 bytes, the
driver sent no packet for the 7 s the name lookup waited, and the link
dropped for silence.

`tests/link-host.test.ts` builds `link2_host.c` and `companion.c` with the
link client under ASan and UBSan and runs them against the reference Hub
(`link/v2/hub.ts` at the repository root) in the test process: the pairing files of
a setup, the handshake, `runtime.status`, `runtime.apps`, a launch, a
removal, the companion route and a link that closes under a request.

## Companion services

A worker reaches the paired Hub's services at
`https://companion.pocket/<service>/...` (Pocket Shell `docs/APPLETS.md`;
`LINK_SERVICES_HOST` in `runtime/spec/link.ts`) through its `http` node.
`pocketjs_system_companion` is the `pocket_http_esp` transport for that host:
`companion.c` sends the request over the Pocket Link as a `net.http` request
(§6.5) with devices/services `link2_http.c`. The request names the
running app, taken from the launcher and not from the guest, and the Hub
answers it for the services that app declares while it serves that origin
(§11 leaves open when a Hub stops). The request task makes each call on the
system task (`system_run`), where the link runs. Every other host goes out
over the radio as before.

| When | The request fails with |
| --- | --- |
| no Hub is paired | `unavailable: no Mac is paired` |
| the paired Hub is not linked | `unavailable: the paired Mac is not connected` |
| `net.http` is not in use: the Hub does not list it, or the connection's payload limit is under 12,288 bytes | `unavailable: the paired Mac offers no companion services` |
| the link closes during the request | `unavailable: the Pocket Link closed`, status `unknown` |

The link client holds two requests (`LINK_HTTP_SLOTS`), each with a 1 KiB
headers record, a 1 KiB request body and an 8 KiB receive window that is the
response stream's whole credit: 20,668 bytes of `.bss`, in PSRAM.

## Clock and worker support

`clock.c` starts the SNTP client (`esp_netif_sntp`,
`CONFIG_POCKET_SYSTEM_SNTP_SERVER`, `pool.ntp.org` by default) each time the
radio is assigned an address, so a new network synchronizes the clock within
one exchange; lwIP then synchronizes every `CONFIG_LWIP_SNTP_UPDATE_DELAY` ms
(one hour). The clock is UTC and backs `gettimeofday` and the guest's `Date`.
`pocketjs_system_online` and `pocketjs_system_clock_wait` serve the program's
HTTP node from any task; `pocketjs_system_app_worker` and
`pocketjs_system_app_worker_bytecode` return the worker source and the
worker bytecode section of an app (sections 8 and 9 of the admitted variant,
as its package source states them), whose bytes live as long as the app.
