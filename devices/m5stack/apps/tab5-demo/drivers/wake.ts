import { io, ResourceStatus, type I2CDevice } from "@pocketjs/framework/io";
import { bytes, read, write, type I2CStep } from "@pocketjs/framework/io/i2c";
import { settle, sleep } from "@pocketjs/framework/worker";

// What powers the Tab5 back on after device.powerOff(): the RX8130CE's
// /IRQ and the BMI270's INT1 reach the board's power controller.

const RTC = 0x32, IMU = 0x68;
/* RX8130CE (Epson ETM50E-10 §13.2): FLAG write-zero-to-clear, CTRL0 enables,
 * EXTENSION holds the wake-up timer's enable (TE) and source (TSEL). */
const EXTENSION = 0x1c, FLAG = 0x1d, CTRL0 = 0x1e, CTRL1 = 0x1f;
const TE = 0x10, TSEL_MASK = 0x07, TSEL_1HZ = 0x02;
const AF = 0x08, TF = 0x10, UF = 0x20, AIE = 0x08, TIE = 0x10, UIE = 0x20;
/* Writing one keeps a flag; bit 6 is reserved and VBFF read-only. */
const KEEP_FLAGS = 0xbf;
/* CTRL1: INIEN (backup switching) and CHGEN (backup charging). */
const BACKUP = 0x30;

async function run(device: I2CDevice, script: readonly I2CStep[]): Promise<Uint8Array> {
  let request: number;
  while ((request = device.submit(script)) < 0) await sleep(1000);
  const record = await settle(request);
  if (record.status !== ResourceStatus.ok) throw new Error(`I2C status ${record.status}`);
  return record.data;
}

async function withDevice<T>(node: string, address: number, body: (device: I2CDevice) => Promise<T>): Promise<T> {
  const device = io.i2c(node).open({ address, timeoutMillis: 20 });
  try { return await body(device); } finally { device.close(); }
}

/** Boot state: no alarm, timer or update interrupt holds /IRQ, the wake-up
 *  timer is stopped, and the backup battery charges and takes over when the
 *  supply drops, as the vendor firmware sets them. */
export async function quietRtc(node: string): Promise<void> {
  await withDevice(node, RTC, async device => {
    const [control] = await run(device, [read(CTRL0, [bytes(1)])]);
    await run(device, [write(CTRL0, control! & ~(AIE | TIE | UIE)), write(FLAG, KEEP_FLAGS & ~(AF | TF | UF))]);
    const [extension] = await run(device, [read(EXTENSION, [bytes(1)])]);
    if (extension! & TE) await run(device, [write(EXTENSION, extension! & ~TE)]);
    const [backup] = await run(device, [read(CTRL1, [bytes(1)])]);
    if ((backup! & BACKUP) !== BACKUP) await run(device, [write(CTRL1, backup! | BACKUP)]);
  });
}

/** Arm the wake-up timer (§14.5): stop it, load `seconds` into the 16-bit
 *  counter, count at 1 Hz, start it and let its flag drive /IRQ. */
export async function armRtcTimer(node: string, seconds: number): Promise<void> {
  await withDevice(node, RTC, async device => {
    const [extension] = await run(device, [read(EXTENSION, [bytes(1)])]);
    const stopped = extension! & ~TE;
    await run(device, [write(EXTENSION, stopped), write(0x1a, seconds & 0xff, seconds >> 8)]);
    const [control] = await run(device, [read(CTRL0, [bytes(1)])]);
    await run(device, [write(FLAG, KEEP_FLAGS & ~TF), write(CTRL0, (control! & ~UIE) | TIE)]);
    await run(device, [write(EXTENSION, (stopped & ~TSEL_MASK) | TSEL_1HZ | TE)]);
  });
}

/** Bosch BMI270 SensorAPI v2.86.1: any-motion on feature page 1 at offset
 *  0x0C (duration 1 s in 20 ms steps, all axes, threshold 0xFF ≈ 125 mg,
 *  enabled), INT1 push-pull active high and latched, mapped to any-motion.
 *  The IMU must have been initialized (Bmi270). */
export async function armMotion(node: string): Promise<void> {
  await withDevice(node, IMU, async device => {
    await run(device, [read(0x1c, [bytes(1)])]); // INT_STATUS_0 clears on read
    await run(device, [write(0x2f, 1)]);
    const page = await run(device, [read(0x30, [bytes(16)])]);
    const duration = 0x32, threshold = 0xff;
    page[0x0c] = duration & 0xff;
    page[0x0d] = (duration >> 8 & 0x1f) | 0xe0;
    page[0x0e] = threshold & 0xff;
    page[0x0f] = (threshold >> 8 & 0x07) | 0x80;
    await run(device, [write(0x30, page)]);
    await run(device, [write(0x53, 0x0a), write(0x55, 1)]);
    const [map] = await run(device, [read(0x56, [bytes(1)])]);
    await run(device, [write(0x56, map! | 0x40)]);
  });
}

/** Undo armMotion: unmap any-motion from INT1 and disable the pin's output.
 *  The UI calls this, with quietRtc, when the board stayed on. */
export async function disarmMotion(node: string): Promise<void> {
  await withDevice(node, IMU, async device => {
    const [map] = await run(device, [read(0x56, [bytes(1)])]);
    await run(device, [write(0x56, map! & ~0x40), write(0x53, 0x00)]);
    await run(device, [read(0x1c, [bytes(1)])]);
  });
}
