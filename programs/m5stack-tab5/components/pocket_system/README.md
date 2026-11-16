# pocket_system

The system services of the Tab5 as a launcher console: installed apps and
switching between them, the Pocket Link 2 client to a paired Hub, a guest's
`data.fs` tree, the Wi-Fi radio, the SNTP clock and installs from an install
QR code.

- Public header: `pocket/system.h`
- Shared state machines: `engine/host-services` (`link2.c` with
  `link2_proto.c`, `link2_guest.c`, `link2_http.c` and `link2_bsd.c`,
  `launcher.c`, `fs.c`), compiled from the repository
- `esp_wifi` comes from `espressif/esp_wifi_remote` and `espressif/esp_hosted`,
  which the program lists with its coprocessor's pins

## Store

`pocketjs_system_start` takes one mounted directory and the name of a data
partition:

| Place | Contents |
| --- | --- |
| `link/device.txt` | the device id, which the firmware makes at its first start |
| `link/companions/<hub id>.txt` | a paired Hub's key file, which that Hub writes ("Pocket Link") |
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
(`pocket_idf_package_open`: footer, FNV-1a64, then the first variant the
firmware's host facts satisfy: binding generation, raster density, animation
class, tick rate, viewport, presentation, capabilities and auxiliary
surface) and its header is written: no copy is read back into PSRAM and
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
reads every package where it is, without a copy or a second hash pass
(`POCKET_MEMORY_PACKAGE_VERIFIED`): the admission here is the hash pass.
`pocketjs_system_mount_flash` mounts a wear-levelled FAT partition when no
card is available.

## Guest lifecycle

The program loads the launcher (`pocketjs_system_load_launcher`), creates the
guest, calls `pocketjs_system_bind` with its realm and boots the runtime
with the app's bytes as its package source. Each tick, before the turn, it
calls `pocketjs_system_pump`; SELECT outside the launcher calls
`pocketjs_system_summon`. When `pocketjs_system_switch_pending` becomes true,
the program stops the runner, destroys the runtime and guest, calls
`pocketjs_system_unbind`, takes the target with `pocketjs_system_take_switch`
and boots it.

## Guest namespaces

| Global | Contract |
| --- | --- |
| `ui.appTable`, `ui.appLaunch`, `ui.appShot` | the `applications` operations, served by the program's operation provider from `pocketjs_system_app_table` and `pocketjs_system_launch` |
| `link` | `contracts/spec/link.ts` on Pocket Link 2 (`link2_guest.c`): `status`, `forget`, `catalog`, `install`, `remove`, `poll`. `pair` answers false: no pairing travels on the link. `status()` carries `limit`, the connection's payload limit, which a version 1 host's status does not have |
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
package by the firmware's host facts (`pocket_idf_package_open`) and refuses
one whose app id does not hash to the slot of `a`, as it does for a package
read from any slot. A guest switch keeps the download running and drops only
its events.

## Pocket Link

`link2_host.c` creates the firmware's one Pocket Link 2 client (pocketjs
`docs/POCKET-LINK.md`, `engine/host-services/link2.h`) at start and pumps it
once per frame on the system task. Its sockets are lwIP's BSD sockets
(`link2_bsd.c`); while the radio has no address every socket call answers
"gone", so the link drops when the address does and searches again when it
is back.

The firmware lists these groups in its `hello` (§6.1):

| Group | What the firmware does |
| --- | --- |
| `apps` | reports the launcher's row and the launcher's table as `runtime.apps`, after `ready` and after each install or removal |
| `runtime` | answers `runtime.status` and switches to an installed app on `runtime.launch`; a push and a screenshot answer `unsupported` |
| `runtime.remove` | removes an installed applet at the Hub's request; never the launcher, the running app or a bundled package |
| `catalog`, `install` | the store of `globalThis.link`: the Hub's offer for target `tab5-home`, and a package streamed into the `apps` partition ("Store") |
| `net.http` | the worker's requests to `companion.pocket` ("Companion services") |

It opens no applet channel, runs no agent and has no DevTools stream. The
Tab5 keeps one committed package a slot and no record of package generations
or of a last good package, so `runtime.status` says `generation` 0 and
`lastGood` zeros; `active` and `running` are the hash of the package that
runs, `phase` is `starting`, `booted` or `switching`, and `frame` counts the
pumps.

**Pairing.** No pairing travels on the link (§3): a Hub writes
`link/companions/<hub id>.txt`, with the link key, into the store, keeps
`link/device.txt` when it holds an id and writes one otherwise, and the
firmware reads both when it starts. The firmware never writes a key file.
With a card in the slot the store is the microSD card, so a Hub writes the
pairing onto the card in its computer's reader: the procedure of §3.2 with
the link directory `link` (the reference Hub: `link2 setup --card <mounted
card> --link-dir link`). **Without a card the store is the `storage` flash
partition, which no computer reaches, and the Tab5 cannot be paired**; §11
leaves a carrier without a file channel open. The firmware has no ftpd.
Key files a version 1 firmware wrote under `link/companions/` have the same
format: the client loads them, lists them in `link.status()` and links to
none, since no version 2 Hub holds their id and key; `link.forget` removes
them.

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
link client under ASan and UBSan and runs them against pocketjs's reference
Hub (`tools/pocket-link/v2/hub.ts`) in the test process: the pairing files of
a setup, the handshake, `runtime.status`, `runtime.apps`, a launch, a
removal, the companion route and a link that closes under a request.

## Companion services

A worker reaches the paired Hub's services at
`https://companion.pocket/<service>/...` (pocketjs `docs/APPLETS.md`;
`LINK_SERVICES_HOST` in `contracts/spec/link.ts`) through its `http` node.
`pocketjs_system_companion` is the `pocket_http_esp` transport for that host:
`companion.c` sends the request over the Pocket Link as a `net.http` request
(§6.5) with engine/host-services `link2_http.c`. The request names the
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
found by its variant hash), whose bytes live as long as the app.
