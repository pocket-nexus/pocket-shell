# `.pocket` format 2

`runtime/spec/pocket-package.ts` defines the binary container. TypeScript,
Rust and Python readers share maintained valid and malformed fixtures.

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

**Format 1 packages are rejected by format 2 runtimes.**
**Every current program uses binding generation 12.** Values 1–11 from the
former per-target numbering are rejected.
See the PocketJS [compatibility matrix](../vendor/pocketjs/site/content/docs/native-contract.md#package-and-driver-compatibility). Rebuild the application
to produce a format 2 package. Admission selects the first variant the host's
facts satisfy (binding generation, raster density, animation class, rate,
viewport, presentation, capabilities and auxiliary surface), preferring a
variant whose host contract hash equals the host's, then checks its resources.
ESP-IDF's embed step applies the same rules to the binary host-input record.
