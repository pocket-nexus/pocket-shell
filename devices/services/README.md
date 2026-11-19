# Host services in C

Portable C that native programs compile directly into their binaries: the
services a console offers its guests besides the UI. Each source implements
one contract and calls the platform only through `host_services.h`, which
every program implements once.

The directory was imported from `engine/host-services` of PocketJS at
`806ac202`; PocketJS has since removed that directory. A path below with
"PocketJS" before it is read from `vendor/pocketjs`; `runtime/`, `link/`,
`devices/` and `docs/` are this repository's.

| Source | Contract | What it does |
| --- | --- | --- |
| `link2.c`, `link2.h` | `runtime/spec/link2.ts`, `docs/POCKET-LINK.md` | The Pocket Link 2 client: discovery, the handshake from the pairing files, pairing by a code the device shows (§3.11), both request tables, streams with credit, catalog and install, `net.http`, the runtime operations, the DevTools stream and the host half of applet channels. The program supplies its operations as `Link2Host` callbacks and its sockets, clock and randomness as `Link2Platform`. |
| `link2_proto.c`, `link2_proto.h` | `runtime/spec/link2.ts` | The socket-free half of version 2: preamble, the 12-byte header, the streaming frame reader, control frames, proofs, the pairing files' readers, a bounded JSON writer. |
| `link2_bsd.c` | | The socket half of a `Link2Platform` from BSD sockets (POSIX, the 3DS). |
| `link2_guest.c`, `link2_guest.h` | `runtime/spec/link.ts` `LinkStatus`, `LinkEvent` | `globalThis.link` on the version 2 client, in version 1's shape: status, forget, catalog, install into the app's slot, remove, poll; and the three calls of a host that pairs by a code (`link2_guest_pair_open`, `_ask`, `_close`), whose state rides the status as `pair`. |
| `link2_channel_qjs.c`, `link2_channel_qjs.h` | `docs/POCKET-LINK.md` §7.3, §7.4 | `globalThis.link.channel` for a QuickJS guest over `link2.h`'s channel calls: handles that carry the channel's generation, a buffer taken after the handle beside it, one side of an id closed. |
| `link2_http.c`, `link_http.h` | PocketJS `engine/worker/include/pocket/worker_protocol.h` | The worker's HTTP stream on version 2's `net.http`: bounded streaming with an 8 KiB receive window, byte credit, separate headers and terminal state. `link_http.h` declares the calls; fact kinds, statuses and the block size come from the worker protocol header. All calls run on the Link owner task. |
| `pocket_container.c`, `pocket_container.h` | `runtime/spec/pocket-package.ts`, `docs/POCKET-PACKAGE.md` | The `.pocket` reader: verifies a whole file (layout, target ids, the footer and every variant's payload hash), states where a variant's sections lie as `pocket_package_sections`, and offers the variants to the program's admission in the order `runtime/spec/admission.ts` selects them. PocketJS admits and boots the variant through the program's package source; it checks no container hash for stated sections. |
| `launcher.c`, `launcher.h` | the `applications` operations (PocketJS keeps ops 39 to 41 and 51 for a product host) | The app table of a console with installed apps, the switch request, SELECT summons, `resume` and `lastError`. The program's main loop performs the switch. |
| `fs.c`, `fs.h` | PocketJS `contracts/spec/fs.ts` | One guest's `data.fs` tree: the nine ops, quota, and replacement of a file on FAT, which refuses a rename onto an existing name. |
| `jscan.c`, `jscan.h` | | A bounded JSON reader and a growable JSON writer for the program's own records. |
| `sha256.c`, `sha256.h` | | SHA-256, HMAC-SHA256, hex, and the slot of an app id (the first 16 hex digits of SHA-256 of the id). |
| `photos_image.c`, `photos_image.h` | `runtime/spec/camera.ts` | DCF photo names, RGB565 to RGB888 for the encoder, and the box-filtered thumbnail and full view in `PSM_5650`. Each program brings its own JPEG codec. |
| `media_wire.h`, `media_adpcm.h` | `runtime/spec/media.ts`, `runtime/spec/media-adpcm.ts`, `docs/MEDIA.md` | The media stream's header and packet layouts, PAL8 frame expansion, and the IMA ADPCM block decoder. |
| `quirc/` | | QR-code recognition, vendored unmodified (`quirc/VENDORED.txt`). |

**Pocket Link 1's C client was not imported.** `link.c`, `link_proto.c`,
`link_proto.h`, `link.h` and version 1's `link_http.c` were left out because
no program here compiles them, and PocketJS removed them with
`engine/host-services`. `link_http.h` is here because `link2_http.c`
implements it.

## Programs

| Program | Build | `host_services.h` implementation |
| --- | --- | --- |
| Nintendo 3DS product | `devices/3ds/Makefile` (`SHARED`) | `devices/3ds/src/services_host.c`: libctru clocks and `ps:ps` randomness, the CFG owner name, `soc:U`, the SD card runtime slots (`runtime.c`), the agent channel (`agent.c`) |
| M5Stack Tab5 | `devices/m5stack/programs/m5stack-tab5/components/pocket_system`, `pocket_camera`, `pocket_media` (each `CMakeLists.txt` sets `shared`) | `src/services_host.c` in `pocket_system`: `esp_timer`, `esp_fill_random`, lwIP, the `/pocket` store; the camera and media components compile the photo, QR and media sources |

Two sources of the 3DS platform read headers from this directory through the
3DS Makefile's include path: `devices/3ds/platform/media.c` includes
`media_wire.h` and `media_adpcm.h`, and `devices/3ds/platform/worker.c`
includes `host_services.h` and `link_http.h`.

## Tests

`bun run check:devices` compiles these sources for the build machine and
runs them (`test/`, with a C compiler):

| Test | Sources | Checked against |
| --- | --- | --- |
| `pocket-link-2-c.test.ts` | `link2_proto.c`, `sha256.c`, `jscan.c` under ASan and UBSan | the conformance vectors (`link/vectors/`) and the reference codec (`link/v2/`) |
| `pocket-link-2-client.test.ts` | `link2.c`, `link2_bsd.c`, `link2_proto.c`, `sha256.c`, `jscan.c` as a process under ASan and UBSan | the reference Hub (`link/v2/hub.ts`) on loopback |
| `fs-3ds.test.ts` | `fs.c`, `jscan.c` under ASan and UBSan | PocketJS's sim fs host (`platforms/sim/fs.ts`), op by op |
| `jscan-quirc.test.ts` | `jscan.c`, `quirc/` under ASan and UBSan | a code of the reference QR encoder (`link/qr.ts`) in a 320x240 frame |
| `media-wire.test.ts` | `media_wire.h`, `media_adpcm.h` | the producer (`link/media-stream.ts`, `runtime/spec/media-adpcm.ts`) |
| `pocket-container-c.test.ts` | `pocket_container.c` under ASan and UBSan | the TypeScript codec (`runtime/spec/pocket-package.ts`) on the admission corpus (`runtime/test/fixtures/admission`) and generated packages, damaged packages, the selection order of `runtime/spec/admission.ts` |

`devices/3ds/test` compiles `fs.c`, `jscan.c`, `link2_proto.c`, `sha256.c`
and `photos_image.c` with the product's sources, and
`devices/m5stack/tests/link-host.test.ts` compiles the client, `link2_guest.c`,
`link2_http.c` and `launcher.c` with the Tab5's `link2_host.c` and
`companion.c`. `link2_http.c` needs PocketJS `engine/worker/include` on the
include path.
