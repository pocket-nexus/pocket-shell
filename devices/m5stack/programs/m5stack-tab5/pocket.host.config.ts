import { defineHostConfig } from "@pocketjs/framework/host-config";

/**
 * Pocket Shell and its apps on the Tab5 held in landscape
 * (pocket.host.json, host id tab5-home). The picture is the auxiliary
 * surface, 640x360 at raster density 1, which the program presents at 2x
 * over the whole 1280x720 screen; the primary surface stays off screen. A
 * home control the program draws sends SELECT; the Tab5 keyboard on
 * Ext.Port1, when one is attached, sends text events. An app's worker domain
 * gets an `http` node (HTTP and HTTPS from the Tab5 over its Wi-Fi radio),
 * an `mqtt` node (MQTT 3.1.1 and 5.0 sessions over TCP, TLS and WebSocket),
 * the `sys` and `porta` I2C nodes (the system bus and Port A) and the
 * `rs485` UART node. `globalThis.device` sets the backlight, the speaker
 * level, the power rails and header pins; `globalThis.audio` plays PCM
 * streams on the speaker and records the microphones.
 */
export default defineHostConfig({ host: "./pocket.host.json" });
