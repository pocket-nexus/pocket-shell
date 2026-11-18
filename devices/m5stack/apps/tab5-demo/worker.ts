// The Tab5 demo's worker: the RX8130CE clock, the BMI270 IMU and the INA226
// battery monitor on the system bus (`sys`), I2C scans of the system bus and
// Port A (`porta`), the RS485 port (`rs485`), and the RTC and motion wake-ups
// armed before the UI powers the board off. It publishes the sensors 20
// times a second; every command arrives on the `commands` ring.
import { FactKind, io, type ByteStream } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { Bmi270 } from "./drivers/bmi270";
import { Ina226 } from "./drivers/ina226";
import { Rx8130ce } from "./drivers/rx8130ce";
import { armMotion, armRtcTimer, disarmMotion, quietRtc } from "./drivers/wake";
import {
  Bus, Command, Driver, RtcSetting, SCAN_BYTES, SENSORS_BYTES, SERIAL_BYTES, SERIAL_PAYLOAD, ScanState,
  SerialKind, Wake, ascii, decodeClock, emptySensors, encodeScan, encodeSensors, type Scan,
} from "./protocol";

const SYS = "sys", PORTA = "porta", RS485 = "rs485";
/** The factory demo's "SLEEP 10 SECONDS". */
const RTC_WAKE_SECONDS = 10;
const sensors = emptySensors();
const sensorsChannel = io.channel("sensors");
const scanChannel = io.channel("scan");
const serialChannel = io.channel("serial");
const sensorsRecord = new Uint8Array(SENSORS_BYTES);
const scanRecord = new Uint8Array(SCAN_BYTES);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A wake-up armed before the last power-off leaves its interrupt enabled;
// the clock driver polls read-only meanwhile.
void quietRtc(SYS).catch(error => console.log(`RTC interrupts: ${message(error)}`));
const rtc = new Rx8130ce(SYS);
const imu = new Bmi270(SYS);
const power = new Ina226(SYS);

function publishSensors(): void {
  sensors.sequence += 1;
  const time = rtc.latest?.time;
  sensors.rtcValid = rtc.currentValid;
  if (time) {
    sensors.year = time.year; sensors.month = time.month; sensors.day = time.day;
    sensors.hour = time.hours; sensors.minute = time.minutes; sensors.second = time.seconds;
  }
  sensors.imu = imu.state === "ready" ? Driver.ready : imu.state === "fault" ? Driver.fault : Driver.starting;
  sensors.power = power.state === "ready" ? Driver.ready : power.state === "fault" ? Driver.fault : Driver.starting;
  if (imu.latest) {
    sensors.accel = [imu.latest.accel[0], imu.latest.accel[1], imu.latest.accel[2]];
    sensors.gyro = [imu.latest.gyro[0], imu.latest.gyro[1], imu.latest.gyro[2]];
  }
  if (power.latest) {
    sensors.volts = power.latest.volts; sensors.amps = power.latest.amps; sensors.watts = power.latest.watts;
  }
  sensorsChannel.publish(encodeSensors(sensors, sensorsRecord));
}

/* One 20 Hz tick reads the IMU and publishes; every fourth tick also reads
 * the battery monitor. Each awaited transfer is a worker turn, and the
 * worker's turns share the PSRAM cache with the renderer, so the sensors
 * follow the display's rate instead of their own timers. */
async function publishLoop(): Promise<void> {
  let ticks = 0;
  for await (const _ of io.timer(50_000)) {
    await imu.sample();
    if (ticks % 4 === 0) await power.sample();
    publishSensors();
    // One line every two seconds for the first 20 seconds, then every ten.
    ++ticks;
    if (ticks <= 400 ? ticks % 40 === 20 : ticks % 200 === 20) {
      const t = rtc.latest?.time;
      console.log(`rtc ${t ? `${t.year}-${t.month}-${t.day} ${t.hours}:${t.minutes}:${t.seconds}` : "invalid"}` +
        ` imu ${imu.state} ${sensors.accel.map(v => v.toFixed(2)).join(",")}` +
        ` power ${power.state} ${sensors.volts.toFixed(3)}V ${sensors.amps.toFixed(3)}A` +
        `${power.error ? ` (${power.error})` : ""}${imu.error ? ` imu: ${imu.error}` : ""} rtc transfers ${rtc.transfers}`);
    }
  }
}

// ---- I2C scan ----------------------------------------------------------------

let scanSequence = 0;
async function scanBus(bus: number): Promise<void> {
  const node = bus === Bus.porta ? PORTA : SYS;
  const scan: Scan = { sequence: ++scanSequence, bus, state: ScanState.scanning, addresses: [] };
  scanChannel.publish(encodeScan(scan, scanRecord));
  for (let address = 0x08; address <= 0x77; ++address) {
    let device;
    try { device = io.i2c(node).open({ address, timeoutMillis: 10 }); }
    catch { continue; }
    // An address-only probe: nothing is written to the device.
    let answered = false;
    for (let attempt = 0; attempt < 10; ++attempt) {
      try { answered = await device.probe(); break; }
      catch { await sleep(1000); } // the request table was full
    }
    device.close();
    if (answered) scan.addresses.push(address);
  }
  scan.state = ScanState.done;
  scanChannel.publish(encodeScan(scan, scanRecord));
  console.log(`scan ${node}: ${scan.addresses.map(a => `0x${a.toString(16).padStart(2, "0")}`).join(" ") || "nothing"}`);
}

// ---- RS485 -------------------------------------------------------------------

let serial: ByteStream | undefined;
function report(kind: number, data: Uint8Array = new Uint8Array(0)): void {
  for (let offset = 0; offset < data.length || offset === 0; offset += SERIAL_PAYLOAD) {
    const chunk = data.subarray(offset, offset + SERIAL_PAYLOAD);
    const record = new Uint8Array(SERIAL_BYTES);
    record[0] = kind; record[1] = chunk.length; record.set(chunk, 2);
    serialChannel.publish(record);
    if (data.length === 0) break;
  }
}

async function serialLoop(stream: ByteStream): Promise<void> {
  for await (const fact of stream.observe()) {
    if (fact.kind === FactKind.data) report(SerialKind.received, fact.data);
    else if (fact.kind === FactKind.end || fact.kind === FactKind.error) break;
  }
  if (serial === stream) {
    serial = undefined;
    report(SerialKind.closed);
  }
}

function openSerial(): void {
  if (serial) return;
  try {
    serial = io.uart(RS485).open({ baudRate: 115200 });
    report(SerialKind.opened);
    void serialLoop(serial);
  } catch (error) {
    console.log(`RS485: ${message(error)}`);
    report(SerialKind.failed);
  }
}

function closeSerial(): void {
  const stream = serial;
  serial = undefined;
  stream?.close();
  report(SerialKind.closed);
}

// ---- commands ----------------------------------------------------------------

async function armWake(kind: number, sequence: number): Promise<void> {
  sensors.wake = Wake.none;
  try {
    if (kind === Wake.rtc) {
      await armRtcTimer(SYS, RTC_WAKE_SECONDS);
      console.log(`RTC wake-up timer: ${RTC_WAKE_SECONDS} s`);
    } else {
      await armMotion(SYS);
      console.log("motion wake armed");
    }
    sensors.wake = kind;
  } catch (error) {
    console.log(`wake: ${message(error)}`);
    sensors.wake = Wake.failed;
  }
  sensors.wakeSequence = sequence;
  publishSensors();
}

async function commands(): Promise<void> {
  for await (const record of io.channel("commands").observe()) {
    const sequence = new DataView(record.buffer, record.byteOffset, record.byteLength).getUint32(4, true);
    switch (record[0]) {
      case Command.setRtc: {
        if (rtc.setting) break;
        const clock = decodeClock(record);
        sensors.rtcSequence = sequence;
        if (!rtc.requestSetTime(clock)) { sensors.rtcSetting = RtcSetting.failed; break; }
        sensors.rtcSetting = RtcSetting.busy;
        void rtc.settled().then(status => {
          sensors.rtcSetting = status === "succeeded" ? RtcSetting.succeeded : RtcSetting.failed;
          console.log(`RTC set ${status}${rtc.setError ? `: ${rtc.setError}` : ""}`);
        });
        break;
      }
      case Command.scan:
        await scanBus(record[8] === Bus.porta ? Bus.porta : Bus.sys);
        break;
      case Command.serialOpen:
        openSerial();
        break;
      case Command.serialClose:
        closeSerial();
        break;
      case Command.serialSend: {
        const data = record.subarray(9, 9 + Math.min(record[8]!, record.length - 9));
        const accepted = serial ? serial.write(data) : -1;
        report(accepted > 0 ? SerialKind.sent : SerialKind.failed, data.subarray(0, Math.max(accepted, 0)));
        if (accepted > 0) console.log(`RS485 sent ${ascii(data.subarray(0, accepted)).trim()}`);
        break;
      }
      case Command.armRtcWake:
        await armWake(Wake.rtc, sequence);
        break;
      case Command.armMotionWake:
        await armWake(Wake.motion, sequence);
        break;
      case Command.disarmWake:
        // The board stayed on (USB holds it up): no interrupt stays armed.
        await quietRtc(SYS).catch(error => console.log(`RTC disarm: ${message(error)}`));
        if (imu.state === "ready") await disarmMotion(SYS).catch(error => console.log(`IMU disarm: ${message(error)}`));
        sensors.wake = Wake.none;
        console.log("wake disarmed");
        break;
    }
  }
}

console.log("tab5-demo worker: sys, porta and rs485 nodes declared");
publishLoop().catch(error => console.log(`sensor loop: ${message(error)}`));
commands().catch(error => console.log(`command loop: ${message(error)}`));
