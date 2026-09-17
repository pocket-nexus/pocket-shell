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
  return { world, send, sent, has, mouse, click, key, painted, count };
}

test("Devices runs inside the Aqua desktop and tracks the USB discovery feed", async () => {
  const { world, send, sent, has, click, key, painted } = await desktop();
  expect(painted(AQUA_THEME.desktop)).toBe(true);
  expect(painted(AQUA_THEME.screenBar)).toBe(true);
  expect(painted(AQUA_THEME.taskList)).toBe(true);
  expect(painted(AQUA_THEME.caption(true))).toBe(true);
  expect(has("Looking for connected devices...")).toBe(true);
  for (const unwanted of ["Notepad", "Hero", "All Programs", "My Computer"]) expect(has(unwanted)).toBe(false);
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
  expect(count("File")).toBe(0); // no focused window's screen menus
  click(400, 574); // Dock restores the minimized window
  expect(count("File")).toBe(1);
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
  // With no focused app Cmd+N now opens Files; launch Devices from its icon.
  click(600, 50); click(600, 50);
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


test("macOS starts Files, Devices and Minesweeper as independent usable applications", async () => {
  const { world, send, has, click, key, painted, count } = await desktop(true);
  expect(has("Pocket Shell - Files")).toBe(true);
  expect(has("Minesweeper")).toBe(true);
  expect(count("Overview")).toBe(1);
  expect(has("Game")).toBe(true); // Minesweeper is initially focused.
  expect(painted(AQUA_THEME.minesCell("revealed"))).toBe(false);
  click(596, 144); // first safe reveal in the visible Minesweeper window
  expect(painted(AQUA_THEME.minesCell("revealed"))).toBe(true);
  click(280, 141); click(280, 141); // Files -> Applications
  expect(has("Applications - Files")).toBe(true);
  expect(has("Go")).toBe(true);
  expect(has("Game")).toBe(false);
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
  expect(has("Game")).toBe(true); // focus returns to the next visible app
  click(448, 574); // minimize the active Minesweeper from the Dock
  expect(has("Game")).toBe(false);
  click(448, 574); // restore it without losing the game
  expect(has("Game")).toBe(true);
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
