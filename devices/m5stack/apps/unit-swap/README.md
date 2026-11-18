# Unit Swap

A worker demonstration for `programs/m5stack-tab5` (host `tab5-home`): one
Port A, one unit at a time. Plug an ENV III, an RFID 2 or an Ultrasonic I2C
unit into Port A and the worker finds it, loads its driver and samples it;
unplug it and plug in another, and the worker switches drivers. The UI draws
the worker's channels and sends it commands.

| Unit | Addresses | Identity check | Sampling |
| --- | --- | --- | --- |
| ENV III | 0x44 (SHT30) and 0x70 (QMP6988) | QMP6988 `CHIP_ID` (0xD1) = 0x5C, SHT30 status word CRC | both sensors every 500 ms |
| RFID 2 | 0x28 (WS1850S, MFRC522 registers) | `VersionReg` (0x37) not 0x00 or 0xFF | WUPA every 150 ms |
| Ultrasonic I2C | 0x57 (RCWL-9620) | a first measurement completes | back to back, 120 ms each |

## Worker

`worker.ts` owns the `porta` I2C node (Port A, G53 SDA, G54 SCL, software
bus at 100 kHz).

- **Probing.** Every 250 ms the worker probes 0x08 and the catalogued
  addresses (0x28, 0x44, 0x57, 0x70), four address-only probes in flight at
  a time; every eighth round, and whenever 0x08 answers, it probes all of
  0x08..0x77. A closed handle's resource slot returns only after the node's
  executor releases it, so an open that finds every slot taken waits 2 ms
  and retries. More than 24 answering addresses is a bus fault (SDA held
  low reads as an acknowledgement for every address).
- **Matching.** `UNITS` in `protocol.ts` lists each unit's addresses; the
  first entry whose addresses all answered selects the driver, so ENV III,
  which needs two addresses, is listed before the single-address units.
  The worker identifies a match only when the same addresses answer again
  100 ms later: a Grove plug makes and breaks contact while it goes in, and
  without the second round an RFID 2 attached, failed two polls and
  attached again within 0.7 s.
  The driver (`units/*.ts`) opens its addresses, checks the identity
  registers and configures the device; a mismatch closes the handles and
  reports a rejected match.
- **Running.** The driver samples on its own schedule and calls back after
  each reading; the worker publishes the `state` snapshot then and every
  500 ms. Two failed cycles in a row end the driver: the worker closes its
  handles, reports the removal and probes again.
- **History.** Every 5 s the worker records the ENV III temperature and
  humidity when one is running and a gap otherwise; 64 points (5 min 20 s)
  go out on the `history` snapshot. The record lives in the worker, so
  the chart keeps its points while another unit is on the port.

The SHT30 and the RCWL-9620 return results to a bare read with no register
byte. The drivers use the I2C `receive(layout)` step (step op 3, from
pocket-nexus/pocketjs#639) for those reads: `[write(0xF3, 0x2D),
receive([bytes(3)])]` reads the SHT30 status word in one transaction.

The RFID 2 driver implements ISO 14443A in TypeScript on the MFRC522 register
interface: WUPA, anticollision and SELECT through three cascade levels,
CRC_A, MIFARE Classic key A authentication (key FFFFFFFFFFFF) and READ/WRITE
of block 4, and Ultralight/NTAG READ/WRITE of pages 4..7. A card left on the
reader is halted after each poll, so the next WUPA wakes it. "Write name"
writes `Pocket Tab5 #<n>` (16 bytes, zero padded) to block 4 or pages 4..7
and reads it back; on an NTAG this replaces the start of its NDEF message.

## Channels

| Channel | Kind | Direction | Record |
| --- | --- | --- | --- |
| `state` | snapshot | worker to UI | 96 bytes: phase, unit, counters, address bitmap, reading |
| `history` | snapshot | worker to UI | 260 bytes: 64 temperature and humidity points |
| `events` | ring of 8 | worker to UI | 16 bytes: attach, removal, unknown device, card, write result |
| `commands` | ring of 4 | UI to worker | 8 bytes: write card, reset the distance range |

`protocol.ts` defines the layouts.

## UI

A snapshot channel's UI mirror keeps its last record, so `observe()` returns
it every frame; the UI decodes `state` only when its sequence changes and
`history` only when its bytes change, and the chart's bars are an `Index`
that updates in place. The UI turns EXT 5V on at start, since Port A takes its supply from it, and
shows a toggle. The left panel follows the worker's phase: the unit list
while waiting, the identity check, the running unit's panel, an unknown
device's addresses, or a bus fault with a button that cuts EXT 5V for
500 ms.

## Build and validation

The firmware bundles the app (`POCKETJS_TAB5_BUNDLED_APPS`); Pocket Shell lists
it as "Unit Swap". Built on its own and embedded as the launcher package, it
runs in place of Pocket Shell:

```sh
bun run app build apps/unit-swap/pocket.app.json
idf.py -C programs/m5stack-tab5 \
  -DPOCKETJS_TAB5_SHELL_PACKAGE=$PWD/.pocket-build/apps/unit-swap.pocket build
```

`tests/unit-swap.test.ts` (run by `tools/test-worker-io.sh`) checks the
conversions, CRCs, catalogue matching and channel records on the host.
