// RFID 2: a WS1850S at 0x28, register compatible with the NXP MFRC522
// (datasheet MFRC522 rev 3.9). In I2C mode every byte of one write or read
// goes to the same register, so one step moves a whole FIFO frame. ISO
// 14443A framing, CRC_A and the card protocols run here; the reader only
// transmits, receives and runs Crypto1.
import { bytes, read, u8, write } from "@pocketjs/framework/io/i2c";
import { sleep } from "@pocketjs/framework/worker";
import { CardType, Command, DataState, encodeRfid, Event, hex2, Kind, WriteState, type RfidReading } from "../protocol";
import { message, type Device } from "./bus";
import { cardText, cardType, crcA, crcAValid } from "./decode";
import { now, pace, REMOVED_AFTER, type Emit, type Identify, type Unit } from "./unit";

const ADDRESS = 0x28;
const Reg = {
  command: 0x01, comIrq: 0x04, error: 0x06, status2: 0x08, fifoData: 0x09, fifoLevel: 0x0a,
  bitFraming: 0x0d, coll: 0x0e, mode: 0x11, txMode: 0x12, rxMode: 0x13, txControl: 0x14, txAsk: 0x15,
  modWidth: 0x24, tMode: 0x2a, tPrescaler: 0x2b, tReloadH: 0x2c, tReloadL: 0x2d, version: 0x37,
} as const;
const Pcd = { idle: 0x00, transceive: 0x0c, authent: 0x0e, softReset: 0x0f } as const;
/** ComIrqReg bits. */
const Irq = { rx: 0x20, idle: 0x10, timer: 0x01 } as const;
/** ErrorReg: BufferOvfl, ParityErr, ProtocolErr; CollErr apart. */
const FRAME_ERRORS = 0x13, COLLISION = 0x08;
const SELECT = [0x93, 0x95, 0x97] as const;
const WUPA = 0x52, READ = 0x30, WRITE_CLASSIC = 0xa0, WRITE_PAGE = 0xa2, AUTH_KEY_A = 0x60;
const HLTA = [0x50, 0x00, ...crcA([0x50, 0x00])];
const DEFAULT_KEY = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
/** Sector 1's first data block on a Classic card; pages 4..7 on an
 *  Ultralight or NTAG. */
const DATA_BLOCK = 4;
const POLL = 150_000;
/** A card answers WUPA 91 us after the frame; 5 ms covers the I2C round
 *  trips. Other commands wait for the reader's 25 ms timer. */
const WUPA_WAIT = 5_000, FRAME_WAIT = 30_000;

interface Frame { data: Uint8Array; error: number }

export const identifyRfid2: Identify = async ({ bus, emit, changed }) => {
  const device = await bus.open(ADDRESS);
  try {
    const version = (await device.run([read(Reg.version, [u8])]))[0]!;
    if (version === 0x00 || version === 0xff) throw new Error(`VersionReg 0x${hex2(version)}`);
    await device.run([write(Reg.command, Pcd.softReset)]).catch(() => undefined);
    await sleep(50_000);
    for (let attempt = 0; ((await device.run([read(Reg.command, [u8])]))[0]! & 0x10) && attempt < 10; ++attempt) await sleep(5_000);
    // Timer: TAuto, prescaler 0xA9 (40 kHz), reload 1000: 25 ms after each
    // transmission. 100 % ASK, CRC preset 0x6363.
    await device.run([write(Reg.txMode, 0x00), write(Reg.rxMode, 0x00), write(Reg.modWidth, 0x26)]);
    await device.run([write(Reg.tMode, 0x80), write(Reg.tPrescaler, 0xa9), write(Reg.tReloadH, 0x03)]);
    await device.run([write(Reg.tReloadL, 0xe8), write(Reg.txAsk, 0x40), write(Reg.mode, 0x3d)]);
    const tx = (await device.run([read(Reg.txControl, [u8])]))[0]!;
    if ((tx & 0x03) !== 0x03) await device.run([write(Reg.txControl, tx | 0x03)]);
    console.log(`RFID 2: VersionReg 0x${hex2(version)}, antenna on`);
    return new Rfid2(device, version, emit, changed);
  } catch (error) {
    console.log(`RFID 2 identify: ${message(error)}`);
    device.close();
    return undefined;
  }
};

class Rfid2 implements Unit {
  readonly kind = Kind.rfid2;
  ready = false;
  private reading: RfidReading;
  private closed = false;
  private writeRequested = false;
  private writes = 0;
  constructor(private readonly device: Device, version: number, private readonly emit: Emit, private readonly changed: () => void) {
    this.reading = {
      polls: 0, version, present: false, cards: 0, atqa: 0, sak: 0, cardType: CardType.none,
      uid: new Uint8Array(0), dataState: DataState.none, data: new Uint8Array(16), writeState: WriteState.idle,
    };
  }

  // ---- reader ----------------------------------------------------------------

  private io(script: Parameters<Device["run"]>[0]): Promise<Uint8Array> {
    return this.device.run(script);
  }

  /** Polls ComIrqReg until a bit of `mask` is set; false when the reader's
   *  timer expires or `wait` passes first. */
  private async waitIrq(mask: number, wait: number): Promise<boolean> {
    const start = now();
    for (;;) {
      const irq = (await this.io([read(Reg.comIrq, [u8])]))[0]!;
      if (irq & mask) return true;
      if (irq & Irq.timer || now() - start > wait) return false;
      await sleep(1_500);
    }
  }

  /** Idle the reader, clear the interrupts, flush the FIFO, load the frame
   *  and start sending: two scripts of three register writes. */
  private async start(command: number, frame: readonly number[], lastBits: number): Promise<void> {
    await this.io([write(Reg.command, Pcd.idle), write(Reg.comIrq, 0x7f), write(Reg.fifoLevel, 0x80)]);
    await this.io(command === Pcd.transceive
      ? [write(Reg.fifoData, frame), write(Reg.command, command), write(Reg.bitFraming, 0x80 | lastBits)]
      : [write(Reg.fifoData, frame), write(Reg.command, command)]);
  }

  /** Sends one frame and reads the answer; undefined when no card answered. */
  private async transceive(frame: readonly number[], lastBits = 0, wait = FRAME_WAIT): Promise<Frame | undefined> {
    await this.start(Pcd.transceive, frame, lastBits);
    if (!(await this.waitIrq(Irq.rx | Irq.idle, wait))) return undefined;
    const error = (await this.io([read(Reg.error, [u8])]))[0]! & (FRAME_ERRORS | COLLISION);
    const level = (await this.io([read(Reg.fifoLevel, [u8])]))[0]! & 0x7f;
    const data = level ? await this.io([read(Reg.fifoData, [bytes(level)])]) : new Uint8Array(0);
    return { data, error };
  }

  private static acked(frame: Frame | undefined): boolean {
    return !!frame && frame.data.length === 1 && (frame.data[0]! & 0x0f) === 0x0a;
  }

  // ---- ISO 14443A ------------------------------------------------------------

  /** WUPA wakes an idle or halted card; its ATQA, LSB first. */
  private async wake(): Promise<number | undefined> {
    const answer = await this.transceive([WUPA], 7, WUPA_WAIT);
    return answer && !answer.error && answer.data.length === 2 ? answer.data[0]! | (answer.data[1]! << 8) : undefined;
  }

  /** HLTA, which a card does not answer, and Crypto1 off. A halted card
   *  answers the next WUPA, so a card left on the reader keeps answering. */
  private async halt(): Promise<void> {
    await this.start(Pcd.transceive, HLTA, 0);
    await sleep(1_000);
    await this.io([write(Reg.command, Pcd.idle), write(Reg.status2, 0x00)]);
  }

  /** Anticollision and SELECT through up to three cascade levels. */
  private async select(): Promise<{ uid: number[]; sak: number } | undefined> {
    const uid: number[] = [];
    await this.io([write(Reg.coll, 0x00)]);
    for (const level of SELECT) {
      const anticollision = await this.transceive([level, 0x20]);
      if (!anticollision || anticollision.error || anticollision.data.length !== 5) return undefined;
      const [a, b, c, d, bcc] = Array.from(anticollision.data);
      if ((a! ^ b! ^ c! ^ d!) !== bcc) return undefined;
      const frame = [level, 0x70, a!, b!, c!, d!, bcc!];
      const answer = await this.transceive([...frame, ...crcA(frame)]);
      if (!answer || answer.error || answer.data.length !== 3 || !crcAValid(answer.data)) return undefined;
      const sak = answer.data[0]!;
      // A cascade tag (0x88) leads a level whose SAK says the UID goes on.
      if (sak & 0x04) {
        if (a !== 0x88) return undefined;
        uid.push(b!, c!, d!);
        continue;
      }
      uid.push(a!, b!, c!, d!);
      return { uid, sak };
    }
    return undefined;
  }

  /** MIFARE Classic key A authentication of one block: the reader runs
   *  MFAuthent and sets MFCrypto1On in Status2Reg on success. */
  private async authenticate(block: number, uid: readonly number[]): Promise<boolean> {
    await this.start(Pcd.authent, [AUTH_KEY_A, block, ...DEFAULT_KEY, ...uid.slice(uid.length - 4)], 0);
    if (!(await this.waitIrq(Irq.idle, FRAME_WAIT))) return false;
    return ((await this.io([read(Reg.status2, [u8])]))[0]! & 0x08) !== 0;
  }

  /** READ: 16 bytes from the block (Classic) or pages block..block+3. */
  private async readBlock(block: number): Promise<Uint8Array | undefined> {
    const frame = [READ, block];
    const answer = await this.transceive([...frame, ...crcA(frame)]);
    return answer && !answer.error && answer.data.length === 18 && crcAValid(answer.data) ? answer.data.slice(0, 16) : undefined;
  }

  /** Classic WRITE: the command, a 4-bit ACK, the 16 bytes, another ACK. */
  private async writeClassic(block: number, data: Uint8Array): Promise<boolean> {
    const command = [WRITE_CLASSIC, block];
    if (!Rfid2.acked(await this.transceive([...command, ...crcA(command)]))) return false;
    return Rfid2.acked(await this.transceive([...data, ...crcA(data)]));
  }

  /** Ultralight / NTAG WRITE: four bytes a page, pages block..block+3. */
  private async writePages(block: number, data: Uint8Array): Promise<boolean> {
    for (let page = 0; page < 4; ++page) {
      const frame = [WRITE_PAGE, block + page, ...data.subarray(page * 4, page * 4 + 4)];
      if (!Rfid2.acked(await this.transceive([...frame, ...crcA(frame)]))) return false;
    }
    return true;
  }

  // ---- card session ----------------------------------------------------------

  /** A woken card: select it, read the data block (and write it when the UI
   *  asked), halt it. */
  private async session(atqa: number): Promise<void> {
    const selected = await this.select();
    if (!selected) return;
    const type = cardType(selected.sak);
    const classic = type === CardType.classic1k || type === CardType.classic4k || type === CardType.mini;
    const uid = Uint8Array.from(selected.uid);
    const fresh = !this.reading.present;
    let dataState: number = DataState.unsupported, data: Uint8Array = new Uint8Array(16), writeState = this.reading.writeState;
    if (classic || type === CardType.ultralight) {
      if (classic && !(await this.authenticate(DATA_BLOCK, selected.uid))) {
        dataState = DataState.authFailed;
      } else {
        if (this.writeRequested) {
          const text = cardText(`Pocket Tab5 #${++this.writes}`);
          const ok = classic ? await this.writeClassic(DATA_BLOCK, text) : await this.writePages(DATA_BLOCK, text);
          writeState = ok ? WriteState.written : WriteState.failed;
          this.emit(Event.written, ok ? 1 : 0, uid);
          console.log(`RFID 2: write ${ok ? "ok" : "failed"}`);
        }
        const block = await this.readBlock(DATA_BLOCK);
        dataState = block ? DataState.read : DataState.failed;
        if (block) data = block;
      }
    } else if (this.writeRequested) {
      writeState = WriteState.failed;
    }
    if (dataState === DataState.authFailed && this.writeRequested) writeState = WriteState.failed;
    this.writeRequested = false;
    await this.halt();
    this.reading = {
      ...this.reading, present: true, cards: this.reading.cards + (fresh ? 1 : 0), atqa, sak: selected.sak,
      cardType: type, uid, dataState, data, writeState,
    };
    if (fresh) {
      this.emit(Event.card, type, uid);
      console.log(`RFID 2: card ${Array.from(uid, hex2).join("")} SAK 0x${hex2(selected.sak)} data ${dataState}`);
    }
  }

  async run(): Promise<void> {
    let misses = 0, absent = 0;
    this.ready = true;
    while (!this.closed) {
      const start = now();
      try {
        const atqa = await this.wake();
        if (atqa !== undefined) {
          absent = 0;
          if (!this.reading.present || this.writeRequested) await this.session(atqa);
          else await this.halt();
        } else if (this.reading.present && ++absent >= 2) {
          this.reading = { ...this.reading, present: false };
          this.emit(Event.cardGone, this.reading.cardType, this.reading.uid);
        }
        if (this.writeRequested && !this.reading.present) {
          this.writeRequested = false;
          this.reading = { ...this.reading, writeState: WriteState.noCard };
        }
        this.reading = { ...this.reading, polls: this.reading.polls + 1 };
        this.changed();
        misses = 0;
      } catch (error) {
        if (++misses >= REMOVED_AFTER) {
          console.log(`RFID 2 stopped answering: ${message(error)}`);
          return;
        }
      }
      await pace(start, POLL);
    }
  }

  command(command: number): void {
    if (command !== Command.writeCard) return;
    this.writeRequested = true;
    this.reading = { ...this.reading, writeState: WriteState.pending };
  }

  encode(into: Uint8Array): void {
    encodeRfid(this.reading, into);
  }

  close(): void {
    this.closed = true;
    this.device.close();
  }
}
