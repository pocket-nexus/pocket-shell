# Tab5 Demo

The launcher of M5Stack's
[M5Tab5-UserDemo](https://github.com/m5stack/M5Tab5-UserDemo), the Tab5's
factory firmware, on PocketJS, for `programs/m5stack-tab5` (host
`tab5-home`, 640×360 auxiliary surface presented at 2x). The factory block
diagram is the background picture; live values, switch states and plug
arrows are drawn over it where the factory firmware draws them, and its
tiles open the tool windows at the factory positions, sizes and colours. The
factory screen is 1280×720 and places everything by offsets from its centre,
so every position and size here is half of the factory value (`X`, `Y` and
`Frame` in `ui.tsx`). The pictures are M5Stack's, MIT licensed; see
[art/README.md](art/README.md). The music is this app's own.

At start the factory boot animation plays: "Tab" rises in on white, "5"
slides beside it, a chord sounds, and the launcher fades in.

## Launcher

| Factory element | Source | Shows and does |
| --- | --- | --- |
| V and A bubble, charge arrows | INA226 at 0x41 (5 mΩ shunt), worker `sys` node | bus voltage and current at 5 Hz; the arrows show while the current is not negative |
| °C bubble | `device.status()` | SoC temperature |
| RTC bubble and RTC Setting | RX8130CE at 0x32, worker | time and date (UTC); the tile opens the setting window |
| IMU box | BMI270 at 0x68, worker | a dot at 20 Hz that follows the tilt and grows with motion, X/Y/Z in g |
| LCD % and its + and − | `device.setBrightness` | 20 % to 100 % in steps of 20; the detected panel (ST7121, ST7123, ILI9881C) above |
| SPEAKER VOLUME % and its + and − | `device.setVolume` | 0 % to 100 % in steps of 20 |
| CHG, 0.5A (QC), USB 5V OUT, EXT 5V, RF SWITCH | `device.setSwitch` | each picture shows its switch; a press toggles it and shows a toast; the RF switch also opens the access point card |
| arrows at USB A, USB-C, HEADSET | `device.status()` ports | shown while a device or headset is plugged in |
| OFF, SLEEP & TOUCH, SLEEP & SHAKE, SLEEP 10 SECONDS | `device.powerOff`, worker | power off after a 15 s countdown; backlight off until a touch; power off with the BMI270 any-motion interrupt armed; power off with the RX8130CE wake-up timer at 10 s |
| Mic Test, Record Test, Music Test | `globalThis.audio` | the microphones, the headset microphone and the music test (below) |
| Camera, I2C SCAN, File Scan, GPIO TEST, Com Monitor | camera, worker, `device` | the tool windows (below) |
| the ⓘ beside the RF switch | `globalThis.wifi` | the access point card |
| Wi-Fi at the top left | `globalThis.wifi` | the station: state, scan, open and saved networks (not in the factory firmware) |

## Tool windows

| Window | Source | Does |
| --- | --- | --- |
| RTC Setting | worker | a month calendar and hour, minute and second rollers (each half of a roller steps it); Apply writes the RTC and a toast reports the verified readback |
| Camera | `globalThis.camera` (camera.qr) | the SC202CS preview fitted to the window; a press shows it over the whole screen; a decoded QR code shows as a toast |
| Mic Test | `openAudioInput("microphones")` | peaks of the left and right microphones; REC 3S records at 22050 Hz and plays it back |
| Record Test | `openAudioInput("headset")` | the same for a headset microphone, and whether a headphone is plugged in |
| Music Test | `startPlayer`, `openAudioInput("loopback")` | plays an original eight-bar tune synthesized on the device (11025 Hz, integer sine table) and shows the speaker loopback the ES7210 captures |
| SD-Card File Scan | `device.listDirectory` | names of the card's root and its directories, 7 rows a page, up to 64 entries a directory |
| I2C SCAN | worker `sys` and `porta` nodes | address-only probes of 0x08..0x77 written into the factory chart, every 2 s; PORT.A (G53 SDA, G54 SCL) scans only with EXT 5V on, which its picture toggles |
| Ext.Port1 and MBUS | `device.setPin`, `device.releasePin` | every free pin a LOW/HIGH toggle; the pins drive low while open and are released on close; Ext.Port1's G0 and G1 carry the keyboard's bus and are not listed |
| Com Monitor | worker `rs485` node | UART1 at 115200 8N1 (TX G20, RX G21, DE G34): sends `Hello M5Stack!` and shows received lines |
| access point card | `globalThis.wifi` | the SSID `M5Tab5-PocketJS` and the page's address; the factory firmware starts the access point at boot, this app with the card's button |

The waveforms sweep (each update rewrites the newest bar) where the factory
charts scroll: moving every bar each update held the window at 12 fps.

## Worker

`worker.ts` drives the sensors in TypeScript over the `sys` I2C node:
`drivers/rx8130ce.ts` (see [RX8130CE clock setting](drivers/RX8130CE.md)),
`drivers/bmi270.ts`, `drivers/ina226.ts` and `drivers/wake.ts` (the RTC
wake-up timer and the motion interrupt). One 20 Hz timer reads the IMU,
reads the battery monitor every fourth tick and publishes the `sensors`
snapshot; each awaited transfer is a worker turn, and turns on the PSRAM heap
share the cache with the renderer, so the sensors follow the display's rate.
Commands arrive on the `commands` ring; `protocol.ts` lists the record
layouts.

A wake-up is armed before `device.powerOff()`. When the board is still on
after the power-off pulses, the window reports it and the worker disarms
both interrupts. The BMI270 feature image is from Bosch SensorAPI v2.86.1;
[BOSCH-LICENSE.txt](drivers/BOSCH-LICENSE.txt) applies to that image.

## Build

The firmware bundles the demo (`POCKETJS_TAB5_BUNDLED_APPS`): Pocket Shell
lists it as "Tab5 Demo", and the home ball returns to Pocket Shell. Built on
its own and embedded as the launcher package, the demo runs in place of Pocket
Shell and the home ball has nothing to return to:

```sh
bun run app build apps/tab5-demo/pocket.app.json
idf.py -C programs/m5stack-tab5 \
  -DPOCKETJS_TAB5_SHELL_PACKAGE=$PWD/.pocket-build/apps/tab5-demo.pocket build
```

Building with `-DPOCKETJS_TAB5_SHELL_PACKAGE=` restores Pocket Shell. The home
ball rests over the Com Monitor and Camera tiles; drag it aside to reach
them.
The baked glyphs cover printable ASCII; a file name outside it shows `?`.
