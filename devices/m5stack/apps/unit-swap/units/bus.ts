// Port A through the worker's `porta` I2C node: request counters, retries
// while the request table is full, and address probing.
import { io, ResourceError, ResourceStatus, type I2CDevice } from "@pocketjs/framework/io";
import type { I2CStep } from "@pocketjs/framework/io/i2c";
import { sleep } from "@pocketjs/framework/worker";

/** Handles open at once while probing. The worker holds eight resources
 *  and eight requests in all, and a closed handle's slot returns only after
 *  the node's executor releases it. */
const PROBE_BATCH = 4;

export class Bus {
  requests = 0;
  failures = 0;
  constructor(readonly node: string) {}

  /** Opens a handle, waiting 2 ms and retrying while every resource slot is
   *  taken (a handle closed after a completion is released a moment later). */
  async open(address: number, timeoutMillis = 25): Promise<Device> {
    for (let attempt = 0; ; ++attempt) {
      try {
        return new Device(this, io.i2c(this.node).open({ address, timeoutMillis }));
      } catch (error) {
        if (attempt >= 100 || !message(error).endsWith(`: ${ResourceStatus.busy}`)) throw error;
        await sleep(2000);
      }
    }
  }

  /** Address-only probes, PROBE_BATCH in flight at a time; the addresses
   *  that acknowledged, ascending. */
  async probe(addresses: readonly number[]): Promise<number[]> {
    const answered: number[] = [];
    for (let start = 0; start < addresses.length; start += PROBE_BATCH) {
      const batch: { address: number; device: Device }[] = [];
      for (const address of addresses.slice(start, start + PROBE_BATCH)) batch.push({ address, device: await this.open(address, 5) });
      const results = await Promise.all(batch.map(({ device }) => device.probe()));
      batch.forEach(({ address, device }, index) => {
        device.close();
        if (results[index]) answered.push(address);
      });
    }
    return answered;
  }
}

export class Device {
  constructor(readonly bus: Bus, private readonly handle: I2CDevice) {}

  /** One script; a full request table waits 1 ms and resubmits. Rejects with
   *  the ResourceError of a failed transaction (a removed unit NACKs). */
  async run(script: readonly I2CStep[], timeoutMillis?: number): Promise<Uint8Array> {
    for (let attempt = 0; ; ++attempt) {
      ++this.bus.requests;
      try {
        return await this.handle.run(script, timeoutMillis ? { timeoutMillis } : undefined);
      } catch (error) {
        if (error instanceof ResourceError && error.request < 0 && error.status === ResourceStatus.busy && attempt < 100) {
          await sleep(1000);
          continue;
        }
        ++this.bus.failures;
        throw error;
      }
    }
  }

  async probe(): Promise<boolean> {
    for (let attempt = 0; ; ++attempt) {
      ++this.bus.requests;
      try {
        return await this.handle.probe();
      } catch (error) {
        if (attempt < 100) { await sleep(1000); continue; }
        throw error;
      }
    }
  }

  close(): void {
    this.handle.close();
  }
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
