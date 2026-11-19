# `.pocket` format 2

A `.pocket` file holds one application: its app contract (`pocket.app.json`)
and one build of it for each host it targets, a **variant**. Pocket Shell
writes it (`cli/pocket-shell.ts compile`, `devices/3ds/build.ts`), the
launcher installs it, the 3DS program and the Tab5 firmware boot it, and
pocket-hub and the applet store serve it. `runtime/spec/pocket-package.ts`
defines the binary container and is its TypeScript codec.

| Region | Contents |
| --- | --- |
| Header, 32 bytes | `PCKT`, version 2, manifest length, variant count, string table offset and size, two zero reserved words |
| Manifest | Original `pocket.app.json` bytes, padded to 16 bytes |
| Variant, 64 bytes | Target string offset and size, binding generation, section count and table offset, zero reserved word, FNV-1a64 payload hash, 32-byte host contract hash |
| String table | UTF-8 target IDs, 1–65535 bytes each, without NUL terminators |
| Section entry, 16 bytes | Kind, zero reserved word, payload offset and length |
| Payloads | Identity, plan, NUL-terminated JavaScript, asset pack, cover, or other declared sections, each padded to 16 bytes |
| Footer, 8 bytes | FNV-1a64 over all preceding bytes |

Variants sort by UTF-8 bytes and section kinds increase within each variant.
Strings, section tables and payloads occupy contiguous regions in that order.
Readers reject overlap, duplicate IDs or kinds, invalid UTF-8, nonzero reserved
words, trailing data and out-of-range offsets. Unknown section kinds retain
their payloads. Empty payloads may share an offset. Thinning preserves both
the payload hash and the host contract hash.

**Format 1 packages are rejected by format 2 readers.**
**Every current program uses binding generation 12.** Values 1–11 from the
former per-target numbering are rejected.

## Sections

The section kinds are the ones PocketJS gives its own one-application bundle
(`.pkb`, PocketJS `contracts/spec/bundle.ts`), with the same numbers and
payloads, so **a variant maps onto a bundle section for section**:

| Kind | Section | Bundle section |
| --- | --- | --- |
| 1 | identity: output, id, title, each a u16-length-prefixed UTF-8 string | identity |
| 2 | the resolved build plan (JSON) | plan |
| 3 | the UI bundle, NUL-terminated | js |
| 4 | the asset pack | pak |
| 5 | the cover picture, from the app contract's `icon` | icon |
| 6 | the UI bundle as QuickJS bytecode (QJBC envelope) | bytecode |
| 7 | the ESP-IDF host-input record | hostInputs |
| 8 | the worker bundle, NUL-terminated | workerJs |
| 9 | the worker bundle as QuickJS bytecode | workerBytecode |

The PSP program embeds its guests as bundles: `shells/3ds/scripts/psp.ts`
writes each admitted variant's sections into a `.pkb`
(`runtime/package/bundle.ts`).

## Admission on a device

PocketJS boots one program from a package source. A device program that keeps
`.pocket` files reads them with **`devices/services/pocket_container.c`**:
it verifies the layout, the target IDs, the footer and every variant's payload
hash, then offers the variants to PocketJS one at a time through its package
source, whose `sections` callback states where the offered variant's plan,
JavaScript, asset pack, bytecode and worker sections lie in the file. PocketJS
admits that variant's plan against the host's facts (binding generation,
raster density, animation class, rate, viewport, presentation, capabilities
and auxiliary surface) and checks its sections by the path boot takes; **it
checks no container hash for stated sections**, which is why the reader
verifies the file first. The 3DS program admits through its core's
`pocket_package_open_source` (`devices/3ds/core`), the Tab5 firmware through
PocketJS's `pocket_idf_package_open_source`; both then boot the same source.

Variants whose host contract hash equals the host's are offered first, then
the others in file order; the first admitted variant wins. The tools apply the
same selection in TypeScript (`runtime/spec/admission.ts`). The footer hash
names a stored package on the device, and the admitted variant's payload hash
travels with it.

[The admission corpus](../runtime/test/fixtures/admission/package.pocket)
(`runtime/test/fixtures/admission`, from PocketJS's corpus at `89162fb7`) is
one package with two variants and the hosts that admit or refuse them
(`cases.json`). `runtime/test/package-admission.test.ts` checks the
TypeScript selection against it, and
`devices/services/test/pocket-container-c.test.ts` checks the C reader
against the TypeScript codec on it and on generated and damaged packages.

ESP-IDF's embed step applies the same rules to the binary host-input record.
