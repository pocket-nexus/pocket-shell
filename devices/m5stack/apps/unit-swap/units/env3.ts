// ENV III: an SHT30 at 0x44 (temperature, humidity) and a QMP6988 at 0x70
// (pressure, temperature), sampled together twice a second.
import { bytes, read, receive, u8, write } from "@pocketjs/framework/io/i2c";
import { sleep } from "@pocketjs/framework/worker";
import { encodeEnv, hex2, Kind, type EnvReading, type HistoryPoint } from "../protocol";
import { message, type Device } from "./bus";
import { altitude, decodeSht30, decodeSht30Status, dewPoint, qmpCalibration, qmpCompensate, type QmpCalibration } from "./decode";
import { now, pace, REMOVED_AFTER, type Identify, type Unit } from "./unit";

const SHT30 = 0x44, QMP6988 = 0x70;
const PERIOD = 500_000;
/** SHT3x single shot, high repeatability, no clock stretching: at most
 *  15.5 ms (datasheet table 4); the read header is NACKed until then. */
const SHT_MEASURE = [write(0x24, 0x00)];
/** QMP6988 CTRL_MEAS: temperature x1, pressure x8, forced mode. */
const QMP_MEASURE = [write(0xf4, (0b001 << 5) | (0b100 << 2) | 0b01)];
const CONVERSION = 25_000;

export const identifyEnv3: Identify = async ({ bus, changed }) => {
  const sht = await bus.open(SHT30);
  const qmp = await bus.open(QMP6988).catch(error => { sht.close(); throw error; });
  try {
    const id = (await qmp.run([read(0xd1, [u8])]))[0]!;
    if (id !== 0x5c) throw new Error(`QMP6988 chip id 0x${hex2(id)}, expected 0x5C`);
    // Status in one transaction: the 0xF32D command, then a bare read of
    // the word and its CRC.
    const status = decodeSht30Status(await sht.run([write(0xf3, 0x2d), receive([bytes(3)])]));
    if (status === undefined) throw new Error("SHT30 status CRC mismatch");
    // QMP6988 soft reset (0xE6 to RESET), then the OTP coefficients.
    await qmp.run([write(0xe0, 0xe6)]).catch(() => undefined);
    await sleep(20_000);
    await qmp.run([write(0xe0, 0x00)]);
    const calibration = qmpCalibration(await qmp.run([read(0xa0, [bytes(25)])]));
    if (!calibration) throw new Error("QMP6988 calibration read");
    await qmp.run([write(0xf1, 0x02)]); // IIR filter, N = 4
    console.log(`ENV III: SHT30 status 0x${status.toString(16)}, QMP6988 calibrated`);
    return new Env3(sht, qmp, calibration, changed);
  } catch (error) {
    console.log(`ENV III identify: ${message(error)}`);
    sht.close(); qmp.close();
    return undefined;
  }
};

class Env3 implements Unit {
  readonly kind = Kind.env3;
  ready = false;
  crcErrors = 0;
  private reading: EnvReading = { samples: 0, celsius: 0, humidity: 0, pascals: 0, qmpCelsius: 0, dewPoint: 0, altitude: 0 };
  private closed = false;
  private sampledAt = 0;
  constructor(private readonly sht: Device, private readonly qmp: Device, private readonly calibration: QmpCalibration,
    private readonly changed: () => void) {}

  /** The last reading when it is at most two periods old. */
  history(): HistoryPoint | undefined {
    return this.ready && now() - this.sampledAt <= 2 * PERIOD ? { celsius: this.reading.celsius, humidity: this.reading.humidity } : undefined;
  }

  async run(): Promise<void> {
    let misses = 0;
    while (!this.closed) {
      const start = now();
      try {
        // Both sensors convert during one wait.
        await this.sht.run(SHT_MEASURE);
        await this.qmp.run(QMP_MEASURE);
        await sleep(CONVERSION);
        const sht = decodeSht30(await this.sht.run([receive([bytes(6)])]));
        const qmp = qmpCompensate(this.calibration, await this.qmp.run([read(0xf7, [bytes(6)])]));
        misses = 0;
        if (sht && qmp) {
          this.reading = {
            samples: this.reading.samples + 1, celsius: sht.celsius, humidity: sht.humidity, pascals: qmp.pascals,
            qmpCelsius: qmp.celsius, dewPoint: dewPoint(sht.celsius, sht.humidity), altitude: altitude(qmp.pascals),
          };
          this.ready = true;
          this.sampledAt = now();
          this.changed();
          if (this.reading.samples % 20 === 1) {
            const r = this.reading;
            console.log(`ENV III: ${r.celsius.toFixed(2)} C ${r.humidity.toFixed(1)} %RH ${(r.pascals / 100).toFixed(2)} hPa ` +
              `(QMP6988 ${r.qmpCelsius.toFixed(2)} C, ${this.crcErrors} CRC errors)`);
          }
        } else {
          ++this.crcErrors;
        }
      } catch (error) {
        if (++misses >= REMOVED_AFTER) {
          console.log(`ENV III stopped answering: ${message(error)}`);
          return;
        }
      }
      await pace(start, PERIOD);
    }
  }

  encode(into: Uint8Array): void {
    encodeEnv(this.reading, into);
  }

  close(): void {
    this.closed = true;
    this.sht.close(); this.qmp.close();
  }
}

