import { io, ResourceError, ResourceStatus, type I2CDevice } from "@pocketjs/framework/io";
import { bytes, read, write, type I2CStep } from "@pocketjs/framework/io/i2c";
import { sleep } from "@pocketjs/framework/worker";

/** The Tab5's battery monitor: an INA226 at 0x41 across a 5 mΩ shunt. */
const ADDRESS = 0x41;
const SHUNT_OHMS = 0.005;
/** Calibrated for 8.192 A full scale: a current LSB of 0.25 mA. */
const CURRENT_LSB = 8.192 / 32768;
const CALIBRATION = Math.round(0.00512 / (CURRENT_LSB * SHUNT_OHMS));
/** Averages of 16 conversions of 1.1 ms, shunt and bus continuous. */
const CONFIGURATION = 0x4000 | (0b010 << 9) | (0b100 << 6) | (0b100 << 3) | 0b111;

export interface PowerSample { volts: number; amps: number; watts: number }

/** TI INA226 datasheet SBOS547, §7.5 and §7.6: configure and calibrate,
 *  then read bus voltage (1.25 mV/LSB) and current (0.25 mA/LSB) when asked.
 *  Registers are big endian. */
export class Ina226 {
  readonly device: I2CDevice;
  state: "starting" | "ready" | "fault" = "starting";
  latest: PowerSample | undefined;
  error: string | undefined;
  private reading = false;
  constructor(node: string) {
    this.device = io.i2c(node).open({ address: ADDRESS, timeoutMillis: 20 });
    void this.run();
  }
  private async transfer(script: readonly I2CStep[]): Promise<Uint8Array> {
    for (;;) {
      try { return await this.device.run(script); }
      catch (error) {
        if (error instanceof ResourceError && error.request < 0 && error.status === ResourceStatus.busy) { await sleep(1000); continue; }
        throw error;
      }
    }
  }
  private async run(): Promise<void> {
    await sleep(0);
    try {
      const id = await this.transfer([read(0xfe, [bytes(2)])]);
      if (((id[0]! << 8) | id[1]!) !== 0x5449) throw new Error("Unexpected INA226 manufacturer ID");
      await this.transfer([write(0x00, CONFIGURATION >> 8, CONFIGURATION & 0xff),
        write(0x05, CALIBRATION >> 8, CALIBRATION & 0xff)]);
      this.state = "ready";
    } catch (error) {
      this.fail(error);
    }
  }
  private fail(error: unknown): void {
    this.state = "fault";
    this.error = error instanceof Error ? error.message : String(error);
  }
  /** Bus voltage and current on the caller's schedule. A two-byte register
   *  read takes six of the controller's eight command slots: one register
   *  per transaction. Power is their product, as the INA226 computes it. */
  async sample(): Promise<void> {
    if (this.state !== "ready" || this.reading) return;
    this.reading = true;
    try {
      const word = (raw: Uint8Array) => (raw[0]! << 8) | raw[1]!;
      const volts = word(await this.transfer([read(0x02, [bytes(2)])])) * 0.00125;
      const raw = word(await this.transfer([read(0x04, [bytes(2)])]));
      const amps = (raw & 0x8000 ? raw - 0x10000 : raw) * CURRENT_LSB;
      this.latest = { volts, amps, watts: volts * amps };
    } catch (error) {
      this.fail(error);
    } finally {
      this.reading = false;
    }
  }
}
