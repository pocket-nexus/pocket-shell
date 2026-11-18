// Ultrasonic I2C: an RCWL-9620 at 0x57. Writing 0x01 starts a measurement;
// after 120 ms a bare three-byte read returns the distance in micrometres.
import { bytes, receive, write } from "@pocketjs/framework/io/i2c";
import { sleep } from "@pocketjs/framework/worker";
import { Command, encodeSonic, Kind, type SonicReading } from "../protocol";
import { message, type Device } from "./bus";
import { decodeDistance, median } from "./decode";
import { REMOVED_AFTER, type Identify, type Unit } from "./unit";

const ADDRESS = 0x57;
const TRIGGER = [write(0x01)];
const ECHO = [receive([bytes(3)])];
const MEASURE = 120_000;
/** The module's range: 20 mm to 4500 mm. */
const MIN_MM = 20, MAX_MM = 4500;
const WINDOW = 5;

async function measure(device: Device): Promise<number | undefined> {
  await device.run(TRIGGER);
  await sleep(MEASURE);
  return decodeDistance(await device.run(ECHO));
}

export const identifySonic: Identify = async ({ bus, changed }) => {
  const device = await bus.open(ADDRESS);
  try {
    const first = await measure(device);
    console.log(`Ultrasonic I2C: first echo ${first?.toFixed(1)} mm`);
    return new Sonic(device, changed);
  } catch (error) {
    console.log(`Ultrasonic identify: ${message(error)}`);
    device.close();
    return undefined;
  }
};

class Sonic implements Unit {
  readonly kind = Kind.sonic;
  ready = false;
  private window: number[] = [];
  private reading: SonicReading = { samples: 0, millimetres: 0, raw: 0, min: 0, max: 0, outOfRange: 0 };
  private closed = false;
  constructor(private readonly device: Device, private readonly changed: () => void) {}

  /** One measurement after another: each takes the trigger, the 120 ms wait
   *  and the read. A median of the last five drops single bad echoes. */
  async run(): Promise<void> {
    let misses = 0;
    while (!this.closed) {
      let raw: number | undefined;
      try {
        raw = await measure(this.device);
        misses = 0;
      } catch (error) {
        if (++misses >= REMOVED_AFTER) {
          console.log(`Ultrasonic stopped answering: ${message(error)}`);
          return;
        }
        continue;
      }
      const r = this.reading;
      if (raw === undefined || raw < MIN_MM || raw > MAX_MM) {
        this.reading = { ...r, samples: r.samples + 1, raw: raw ?? 0, outOfRange: r.outOfRange + 1 };
        if (this.ready) this.changed();
        continue;
      }
      this.window.push(raw);
      if (this.window.length > WINDOW) this.window.shift();
      const filtered = median(this.window);
      const first = !this.ready;
      this.reading = {
        samples: r.samples + 1, millimetres: filtered, raw, outOfRange: r.outOfRange,
        min: first ? filtered : Math.min(r.min, filtered), max: first ? filtered : Math.max(r.max, filtered),
      };
      this.ready = true;
      this.changed();
      if (this.reading.samples % 40 === 1) console.log(`Ultrasonic: ${filtered.toFixed(1)} mm (last echo ${raw.toFixed(1)} mm)`);
    }
  }

  command(command: number): void {
    if (command === Command.resetRange) this.reading = { ...this.reading, min: this.reading.millimetres, max: this.reading.millimetres };
  }

  encode(into: Uint8Array): void {
    encodeSonic(this.reading, into);
  }

  close(): void {
    this.closed = true;
    this.device.close();
  }
}
