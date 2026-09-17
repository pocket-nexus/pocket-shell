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

async function desktop() {
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
  return { world, send, sent, has, mouse, click, key, painted, count };
}

test("Devices runs inside the Aqua desktop and tracks the USB discovery feed", async () => {
  const { world, send, sent, has, click, key, painted } = await desktop();
  expect(painted(AQUA_THEME.desktop)).toBe(true);
  expect(painted(AQUA_THEME.screenBar)).toBe(true);
  expect(painted(AQUA_THEME.taskList)).toBe(true);
  expect(painted(AQUA_THEME.caption(true))).toBe(true);
  expect(has("Looking for connected devices...")).toBe(true);
  for (const unwanted of ["Notepad", "Minesweeper", "Hero", "All Programs", "My Computer"]) expect(has(unwanted)).toBe(false);
  send({ t: "devices", devices: [psp, ipod] });
  step(world);
  expect(has("PSPLINK USB")).toBe(true);
  expect(has("iPod touch 4")).toBe(true);
  // Client origin is (65, 73): the shell subtracts the window frame and caption.
  click(165, 198);
  expect(has("Sony PlayStation Portable")).toBe(true);
  click(165, 151);
  expect(has("iPod touch 4")).toBe(false);
  click(165, 151);
  expect(has("iPod touch 4")).toBe(true);
  click(165, 248);
  expect(has("Apple iPod touch (4th generation)")).toBe(true);
  click(680, 99);
  expect(sent).toContain(JSON.stringify({ t: "devices-refresh" }));
  send({ t: "devices", devices: [ipod, psp] });
  step(world);
  expect(has("Apple iPod touch (4th generation)")).toBe(true);
  send({ t: "devices", devices: [psp] });
  step(world);
  expect(has("Connected devices")).toBe(true);
  expect(has("iPod touch 4")).toBe(false);
  key("Down");
  expect(has("Sony PlayStation Portable")).toBe(true);
  key("Escape");
  expect(has("Connected devices")).toBe(true);
  step(world, 250);
  expect(has("PSPLINK USB")).toBe(false);
  expect(has("Device discovery unavailable. Reopen Pocket Shell to reconnect.")).toBe(true);
  send({ t: "devices", devices: [] });
  step(world);
  expect(has("No supported devices connected")).toBe(true);
  expect(has("0 devices connected via USB")).toBe(true);
}, 30000);

test("Devices uses desktop dragging, resizing, Dock, close/reopen and independent windows", async () => {
  const { world, send, sent, has, mouse, click, key, painted, count } = await desktop();
  send({ t: "devices", devices: [psp, ipod] });
  step(world);
  mouse(300, 60, true); mouse(330, 90, true); mouse(330, 90, false); step(world);
  click(195, 228); // the moved window's first row
  expect(has("Sony PlayStation Portable")).toBe(true);
  mouse(752, 528, true); mouse(774, 540, true); mouse(774, 540, false); step(world);
  click(735, 131); // refresh follows the resized client's right edge
  expect(sent).toContain(JSON.stringify({ t: "devices-refresh" }));
  key("m", true);
  expect(has("File")).toBe(false); // no focused window's screen menus
  click(400, 574); // Dock restores the minimized window
  expect(has("File")).toBe(true);
  click(195, 278);
  expect(has("Apple iPod touch (4th generation)")).toBe(true);
  key("w", true);
  expect(count("Overview")).toBe(0);
  expect(painted(AQUA_THEME.desktop)).toBe(true);
  click(750, 50); click(750, 50); // desktop icon reopens the app
  expect(count("Overview")).toBe(1);
  key("Down");
  expect(count("Sony PlayStation Portable")).toBe(1);
  key("n", true);
  expect(count("Overview")).toBe(2);
  key("Down"); key("Down");
  expect(count("Sony PlayStation Portable")).toBe(1);
  expect(count("Apple iPod touch (4th generation)")).toBe(1);
  key("w", true);
  expect(count("Overview")).toBe(1);
  expect(has("Sony PlayStation Portable")).toBe(true);
  for (const theme of [CLASSIC_THEME, XP_THEME, AQUA_THEME]) {
    key("t", true, true);
    expect(painted(theme.desktop)).toBe(true);
    expect(painted(theme.caption(true))).toBe(true);
    expect(has("Sony PlayStation Portable")).toBe(true);
    key("r", true);
  }
  // The reduced app catalog also applies to launcher menus and shortcuts.
  key("escape", true);
  expect(has("Appearance")).toBe(true);
  expect(has("Notepad")).toBe(false);
  expect(has("Hero")).toBe(false);
}, 30000);


test("Devices stays usable at the minimum viewport and scrolls long inventories", async () => {
  const { world, send, sent, has, click, key, count } = await desktop();
  send({ t: "resize", w: 640, h: 480 });
  send({ t: "devices", devices: Array.from({ length: 8 }, (_, i) => ({
    ...psp, id: `psp-${i}`, name: `PSP ${i}`, serial: `device-${i}`,
  })) });
  step(world);
  // The fitted window has origin (8, 30), client origin (9, 53).
  click(590, 80);
  expect(sent).toContain(JSON.stringify({ t: "devices-refresh" }));
  for (let i = 0; i < 8; i++) key("Down");
  expect(has("device-7")).toBe(true);
  expect(has("PSP 0")).toBe(false);
  expect(has("PSP 7")).toBe(true);
  key("w", true);
  key("n", true);
  expect(count("Overview")).toBe(1);
  click(109, 178);
  expect(has("device-0")).toBe(true);
  // Caption zoom remains part of the shared desktop chrome.
  click(300, 40); click(300, 40);
  click(100, 168); // first device in the maximized window
  expect(has("device-0")).toBe(true);
  key("w", true);
  expect(count("Overview")).toBe(0);
}, 30000);
