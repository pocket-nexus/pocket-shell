// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "bun:test";
import { bootWorld, treeHasText, type SimWorld } from "../../../vendor/pocketjs/hosts/sim/sim.ts";
import { AQUA_THEME, CLASSIC_THEME, XP_THEME } from "../src/system-ui/theme.ts";

function step(world: SimWorld, frames = 2) {
  for (let i = 0; i < frames; i++) {
    world.frame(0);
    for (let tick = 0; tick < world.ticksPerFrame; tick++) world.tick();
  }
}
const psp = { id: "psp-1", kind: "psp", name: "PSP", connection: "PSPLINK USB", serial: "", vendor: 0x054c, product: 0x01c9 };
const ipod = { id: "ipod-1", kind: "ipodtouch4", name: "iPod touch 4", connection: "USB", serial: "fixture", vendor: 0x05ac, product: 0x129e };

async function desktop(keepBootWindows = false) {
  const inbox: string[] = [];
  const sent: string[] = [];
  const send = (message: object) => inbox.push(JSON.stringify(message));
  // Use the same entry as every desktop target; no separate Devices bundle.
  const world = await bootWorld("pocket-desktop-system-ui", 60, {}, ops => {
    ops.__host = "macos-app";
    ops.svcOpen = (name: string) => name === "system-ui";
    ops.svcPoll = () => inbox.splice(0).join("\n");
    ops.svcSend = (line: string) => sent.push(line);
  }, { width: 800, height: 600 });
  const has = (text: string) => treeHasText(world.getTree(), text);
  const mouse = (x: number, y: number, d: boolean) => send({ t: "mouse", x, y, d });
  const click = (x: number, y: number) => { mouse(x, y, true); mouse(x, y, false); step(world); };
  const key = (k: string, cmd = false, sh = false) => { send({ t: "key", k, cmd, sh }); step(world); };
  const painted = (cls: string) => JSON.stringify(world.getTree()).includes(JSON.stringify(cls));
  const count = (text: string) => JSON.stringify(world.getTree()).split(`"x":${JSON.stringify(text)}`).length - 1;
  send({ t: "hello", w: 800, h: 600 });
  step(world);
  if (!keepBootWindows) {
    // Exercise the real boot first, then isolate Devices through user controls.
    key("w", true); key("w", true); key("w", true);
    click(750, 50); click(750, 50);
  }
  step(world, 20); // finish the initial Dock entrance
  return { world, send, sent, has, mouse, click, key, painted, count };
}

test("Devices navigates categories, selection and discovery in an Explorer client", async () => {
  const { world, send, sent, has, click, key, painted } = await desktop();
  expect(painted(AQUA_THEME.desktop)).toBe(true);
  expect(painted(AQUA_THEME.taskList)).toBe(true);
  expect(has("Looking for connected devices...")).toBe(true);
  send({ t: "devices", devices: [psp, ipod] }); step(world);
  expect(has("PSPLINK USB")).toBe(true);
  expect(has("iPod touch 4")).toBe(true);
  // Client origin (65, 73): compact toolbar, category tree and sorted details.
  click(300, 150);
  expect(has("Media player / USB")).toBe(true);
  expect(has("Serial: fixture")).toBe(true);
  click(300, 184);
  expect(has("Game console / PSPLINK USB")).toBe(true);
  click(140, 161); // Game consoles category
  expect(has("iPod touch 4")).toBe(false);
  expect(has("PSP")).toBe(true);
  click(88, 92); // Back to all devices
  expect(has("iPod touch 4")).toBe(true);
  click(120, 92); // Forward to consoles
  expect(has("iPod touch 4")).toBe(false);
  key("Left"); key("Home");
  expect(has("Media player / USB")).toBe(true);
  click(680, 92);
  expect(sent).toContain(JSON.stringify({ t: "devices-refresh" }));
  send({ t: "devices", devices: [ipod, psp] }); step(world);
  expect(has("Serial: fixture")).toBe(true);
  send({ t: "devices", devices: [psp] }); step(world);
  expect(has("Select a device to view its properties.")).toBe(true);
  key("Down");
  expect(has("Game console / PSPLINK USB")).toBe(true);
  key("Escape");
  expect(has("Select a device to view its properties.")).toBe(true);
  step(world, 250);
  expect(has("PSPLINK USB")).toBe(false);
  expect(has("Device discovery unavailable. Reopen Pocket Shell to reconnect.")).toBe(true);
  send({ t: "devices", devices: [] }); step(world);
  expect(has("No supported devices connected")).toBe(true);
  expect(has("0 devices connected via USB")).toBe(true);
}, 30000);

test("Devices keeps independent navigation and selection through window and theme changes", async () => {
  const { world, send, sent, has, mouse, click, key, painted, count } = await desktop();
  send({ t: "devices", devices: [psp, ipod] }); step(world);
  mouse(300, 60, true); mouse(330, 90, true); mouse(330, 90, false); step(world);
  click(320, 213); // moved client's second row
  expect(has("Game console / PSPLINK USB")).toBe(true);
  mouse(752, 528, true); mouse(774, 540, true); mouse(774, 540, false); step(world);
  click(735, 124);
  expect(sent).toContain(JSON.stringify({ t: "devices-refresh" }));
  key("m", true);
  expect(count("File")).toBe(0);
  click(400, 574);
  expect(count("File")).toBe(1);
  expect(has("Game console / PSPLINK USB")).toBe(true);
  key("n", true); key("Home");
  expect(count("Connection")).toBe(2);
  expect(count("Game console / PSPLINK USB")).toBe(1);
  expect(count("Media player / USB")).toBe(1);
  key("w", true);
  for (const theme of [CLASSIC_THEME, XP_THEME, AQUA_THEME]) {
    key("t", true, true); step(world, 20);
    expect(painted(theme.desktop)).toBe(true);
    expect(painted(theme.caption(true))).toBe(true);
    expect(has("Game console / PSPLINK USB")).toBe(true);
    key("r", true);
  }
  key("w", true); step(world, 20);
  expect(count("Connection")).toBe(0);
  expect(has("Pocket Shell")).toBe(true);
  expect(has("Pocket Shell Desktop")).toBe(false);
  click(750, 50); click(750, 50); step(world, 20);
  expect(count("Connection")).toBe(1);
}, 30000);

test("Devices scrolls long lists and fits the minimum viewport", async () => {
  const { world, send, sent, has, click, key } = await desktop();
  send({ t: "resize", w: 640, h: 480 });
  send({ t: "devices", devices: Array.from({ length: 12 }, (_, i) => ({
    ...psp, id: `psp-${i}`, name: `PSP ${String(i).padStart(2, "0")}`, serial: `device-${i}`,
  })) }); step(world);
  click(590, 72);
  expect(sent).toContain(JSON.stringify({ t: "devices-refresh" }));
  key("End");
  expect(has("Serial: device-11")).toBe(true);
  expect(has("PSP 00")).toBe(false);
  expect(has("PSP 11")).toBe(true);
  key("Home");
  expect(has("Serial: device-0")).toBe(true);
  click(300, 40); click(300, 40); // zoom through shared window chrome
  expect(has("Serial: device-0")).toBe(true);
  key("End");
  expect(has("Serial: device-11")).toBe(true);
}, 30000);

test("Aqua Dock rises, lowers and reverses while Classic keeps its taskbar", async () => {
  const { world, send, click, key, painted, count } = await desktop();
  const strip = () => Buffer.from(world.render().slice(548 * 800 * 4));
  const visible = strip();
  key("w", true);
  expect(count("Connection")).toBe(0);
  expect(painted(AQUA_THEME.taskList)).toBe(true); // retained while leaving
  const leaving = strip();
  step(world, 5);
  const middle = strip();
  expect(leaving.equals(visible)).toBe(false);
  expect(middle.equals(leaving)).toBe(false);
  step(world, 20);
  expect(painted(AQUA_THEME.taskList)).toBe(false);
  const hidden = strip();
  expect(hidden.equals(middle)).toBe(false);
  click(750, 50); click(750, 50);
  const entering = strip();
  step(world, 4);
  expect(strip().equals(entering)).toBe(false);
  key("w", true); // reverse the rise, then reverse again before it is hidden
  click(750, 50); click(750, 50); step(world, 20);
  expect(count("Connection")).toBe(1);
  expect(painted(AQUA_THEME.taskList)).toBe(true);
  key("t", true, true);
  key("w", true); step(world, 20);
  expect(painted(CLASSIC_THEME.taskbar)).toBe(true);
  expect(count("Start")).toBe(1);
}, 30000);

test("macOS starts Files, Devices and Minesweeper as independent usable applications", async () => {
  const { world, send, has, click, key, painted, count } = await desktop(true);
  expect(has("Pocket Shell - Files")).toBe(true);
  expect(has("Minesweeper")).toBe(true);
  expect(count("Connection")).toBe(1);
  expect(count("Game")).toBe(1); // Minesweeper is initially focused.
  expect(painted(AQUA_THEME.minesCell("revealed"))).toBe(false);
  click(596, 144); // first safe reveal in the visible Minesweeper window
  expect(painted(AQUA_THEME.minesCell("revealed"))).toBe(true);
  click(280, 141); click(280, 141); // Files -> Applications
  expect(has("Applications - Files")).toBe(true);
  expect(has("Go")).toBe(true);
  expect(count("Game")).toBe(0);
  key("n", true); // another Files window at the same directory
  expect(count("Applications - Files")).toBe(2); // independently owned windows
  key("w", true);
  expect(count("Applications - Files")).toBe(1);
  click(45, 96); // Back toolbar button -> desktop root
  expect(has("Pocket Shell - Files")).toBe(true);
  click(76, 96); // Forward -> Applications
  expect(has("Applications - Files")).toBe(true);
  key("m", true);
  expect(has("Go")).toBe(false);
  click(400, 574); // middle Dock tile restores Files
  expect(has("Go")).toBe(true);
  click(60, 170); // Documents sidebar
  expect(has("Documents - Files")).toBe(true);
  expect(has("welcome.txt")).toBe(true);
  key("m", true);
  expect(count("Game")).toBe(1); // focus returns to the next visible app
  click(448, 574); // minimize the active Minesweeper from the Dock
  expect(count("Game")).toBe(0);
  click(448, 574); // restore it without losing the game
  expect(count("Game")).toBe(1);
  expect(painted(AQUA_THEME.minesCell("revealed"))).toBe(true);
  key("F2");
  expect(painted(AQUA_THEME.minesCell("revealed"))).toBe(false);
  send({ t: "devices", devices: [psp, ipod] });
  step(world);
  click(352, 574); // Devices keeps receiving discoveries while behind other apps
  expect(has("View")).toBe(true);
  expect(has("PSPLINK USB")).toBe(true);
  for (const theme of [CLASSIC_THEME, XP_THEME, AQUA_THEME]) {
    key("t", true, true);
    expect(painted(theme.desktop)).toBe(true);
    expect(has("Documents - Files")).toBe(true);
    expect(has("Minesweeper")).toBe(true);
  }
  key("escape", true);
  expect(has("Files")).toBe(true);
  expect(has("Minesweeper")).toBe(true);
  expect(has("Hero")).toBe(false);
}, 30000);
