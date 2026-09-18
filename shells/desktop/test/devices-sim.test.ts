// SPDX-License-Identifier: GPL-3.0-only
import { expect, test } from "bun:test";
import type { HostOps } from "@pocketjs/framework/host";
import { bootWorld, treeHasText, type SimWorld } from "../../../vendor/pocketjs/hosts/sim/sim.ts";
import { AQUA_THEME, CLASSIC_THEME, XP_THEME } from "../src/system-ui/theme.ts";

import { cascadePos, contentTop, desktopIconPosition } from "../src/system-ui/wm.ts";

function step(world: SimWorld, frames = 2) {
  for (let i = 0; i < frames; i++) {
    world.frame(0);
    for (let tick = 0; tick < world.ticksPerFrame; tick++) world.tick();
  }
}
const psp = { id: "psp-1", kind: "psp", name: "Sony PSP", connection: "PSPLINK USB", serial: "", vendor: 0x054c, product: 0x01c9 };
const ipod = { id: "ipod-1", kind: "ipodtouch4", name: "iPod touch 4", connection: "USB", serial: "fixture", vendor: 0x05ac, product: 0x129e };

async function desktop(keepBootWindows = false, native = false) {
  const inbox: string[] = [];
  const sent: string[] = [];
  const iconTextures = new Set<number>();
  const send = (message: object) => inbox.push(JSON.stringify(message));
  // Use the same entry as every desktop target; no separate Devices bundle.
  const world = await bootWorld("pocket-desktop-system-ui", 60, {}, ops => {
    const textures = ops as unknown as HostOps;
    const upload = textures.uploadTexture.bind(ops), free = textures.freeTexture?.bind(ops);
    textures.uploadTexture = (pixels, w, h, psm) => {
      const handle = upload(pixels, w, h, psm);
      if (pixels.length === 4096 && pixels[0] === 12 && pixels[1] === 190 && handle >= 0) iconTextures.add(handle);
      return handle;
    };
    textures.freeTexture = handle => { iconTextures.delete(handle); free?.(handle); };
    ops.__host = "macos-app";
    if (native) {
      ops.__applications = [{ package: "dev.pocket-stack.openstrike", title: "OpenStrike", viewport: [640, 360], native: true }];
      ops.__surfaces = { "dev.pocket-stack.openstrike": 1 };
    }
    ops.svcOpen = (name: string) => name === "system-ui";
    ops.svcPoll = () => inbox.splice(0).join("\n");
    ops.svcSend = (line: string) => {
      sent.push(line);
      const request = JSON.parse(line);
      if (request.t === "files-list") {
        const path = request.path === "home" ? "/Users/example" : request.path === "documents" ? "/Users/example/Documents" : request.path;
        const entries = request.path === "native-apps"
          ? [{ path: "/Applications/Calculator.app", name: "Calculator", kind: "application", size: 0, icon: Buffer.from(new Uint8Array(4096).map((_, i) => [12, 190, 80, 255][i % 4]!)).toString("base64") }]
          : Array.from({ length: request.path === "documents" ? 1 : 40 }, (_, i) => ({
              path: `${path}/document-${String(i).padStart(2, "0")}.txt`, name: `document-${String(i).padStart(2, "0")}.txt`, kind: "file", size: i * 1024,
            }));
        const offset = request.offset ?? 0, next = Math.min(entries.length, offset + 32);
        send({ t: "files", request: request.request, path, label: request.path === "home" ? "Home" : request.path === "native-apps" ? "Native Apps" : "Documents", parent: "/", offset, next, entries: entries.slice(offset, next), done: next === entries.length });
      } else if (request.t === "files-open") send({ t: "files", request: request.request, opened: true });
    };
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
  return { world, send, sent, has, mouse, click, key, painted, count, iconTextures };
}

test("Devices switches between icon and list views without exposing icon categories", async () => {
  const { world, send, sent, has, click, key, painted, count } = await desktop();
  expect(painted(AQUA_THEME.desktop)).toBe(true);
  expect(has("Looking for connected devices...")).toBe(true);
  send({ t: "devices", devices: [psp, ipod] }); step(world);
  expect(has("Sony PSP")).toBe(true);
  expect(has("iPod touch 4")).toBe(true);
  expect(has("Game consoles")).toBe(false);
  expect(has("Media players")).toBe(false);
  expect(has("Connection")).toBe(false);
  click(128, 136);
  expect(has("iPod touch 4 / USB / fixture")).toBe(true);
  click(680, 87); // List, same device selection
  expect(has("Connection")).toBe(true);
  expect(count("PSPLINK USB")).toBe(1);
  expect(has("iPod touch 4 / USB / fixture")).toBe(true);
  key("Down");
  expect(has("Sony PSP / PSPLINK USB")).toBe(true);
  click(620, 87); // Icons
  expect(has("Connection")).toBe(false);
  expect(count("PSPLINK USB")).toBe(0);
  expect(has("Sony PSP / PSPLINK USB")).toBe(true);
  click(90, 87);
  expect(sent).toContain(JSON.stringify({ t: "devices-refresh" }));
  send({ t: "devices", devices: [ipod, psp] }); step(world);
  expect(has("Sony PSP / PSPLINK USB")).toBe(true);
  send({ t: "devices", devices: [ipod] }); step(world);
  expect(has("1 device connected via USB")).toBe(true);
  key("Home"); expect(has("iPod touch 4 / USB / fixture")).toBe(true);
  key("Escape"); expect(has("1 device connected via USB")).toBe(true);
  step(world, 250);
  expect(has("Device discovery unavailable. Reopen Pocket Shell to reconnect.")).toBe(true);
  send({ t: "devices", devices: [] }); step(world);
  expect(has("No supported devices connected")).toBe(true);
}, 30000);

test("Devices keeps independent views through window and theme changes", async () => {
  const { world, send, sent, has, mouse, click, key, painted, count } = await desktop();
  send({ t: "devices", devices: [psp, ipod] }); step(world);
  key("End"); click(680, 87);
  expect(count("Connection")).toBe(1);
  mouse(300, 60, true); mouse(330, 90, true); mouse(330, 90, false); step(world);
  expect(has("Sony PSP / PSPLINK USB")).toBe(true);
  mouse(752, 528, true); mouse(774, 540, true); mouse(774, 540, false); step(world);
  click(110, 118);
  expect(sent).toContain(JSON.stringify({ t: "devices-refresh" }));
  key("m", true); expect(count("File")).toBe(0);
  click(400, 574); expect(count("File")).toBe(1);
  key("n", true); key("Home");
  expect(count("Refresh")).toBe(2);
  expect(count("Connection")).toBe(1); // New window defaults to Icons
  expect(has("Sony PSP / PSPLINK USB")).toBe(true);
  expect(has("iPod touch 4 / USB / fixture")).toBe(true);
  key("w", true);
  for (const theme of [CLASSIC_THEME, XP_THEME, AQUA_THEME]) {
    key("t", true, true); step(world, 20);
    expect(painted(theme.desktop)).toBe(true);
    expect(painted(theme.caption(true))).toBe(true);
    expect(has("Sony PSP / PSPLINK USB")).toBe(true);
    expect(count("Connection")).toBe(1);
    expect(count("PSPLINK USB")).toBe(1);
    key("r", true);
  }
  key("w", true); step(world, 20);
  expect(count("Refresh")).toBe(0);
  expect(has("Pocket Shell")).toBe(true);
  click(750, 50); click(750, 50); step(world, 20);
  expect(count("Refresh")).toBe(1);
}, 30000);

test("Devices scrolls a grid and fits the minimum viewport", async () => {
  const { world, send, has, click, key } = await desktop();
  send({ t: "resize", w: 640, h: 480 });
  send({ t: "devices", devices: Array.from({ length: 40 }, (_, i) => ({
    ...psp, id: `psp-${i}`, name: `PSP ${String(i).padStart(2, "0")}`, serial: `device-${i}`,
  })) }); step(world);
  key("End");
  expect(has("PSP 39 / PSPLINK USB / device-39")).toBe(true);
  expect(has("PSP 00")).toBe(false);
  expect(has("PSP 39")).toBe(true);
  key("Home"); expect(has("PSP 00 / PSPLINK USB / device-0")).toBe(true);
  click(300, 40); click(300, 40);
  expect(has("PSP 00 / PSPLINK USB / device-0")).toBe(true);
  key("End"); expect(has("PSP 39 / PSPLINK USB / device-39")).toBe(true);
}, 30000);

test("Aqua Dock rises, lowers and reverses while Classic keeps its taskbar", async () => {
  const { world, send, click, key, painted, count } = await desktop();
  const strip = () => Buffer.from(world.render().slice(548 * 800 * 4));
  const visible = strip();
  key("w", true);
  expect(count("Refresh")).toBe(0);
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
  expect(count("Refresh")).toBe(1);
  expect(painted(AQUA_THEME.taskList)).toBe(true);
  key("t", true, true);
  key("w", true); step(world, 20);
  expect(painted(CLASSIC_THEME.taskbar)).toBe(true);
  expect(count("Start")).toBe(1);
}, 30000);

test("Files navigates real directories, launches native apps and keeps Pocket windows independent", async () => {
  const { world, send, sent, has, click, key, painted, count, iconTextures } = await desktop(true);
  expect(has("Home - Files")).toBe(true);
  expect(count("Game")).toBe(1);
  click(596, 144);
  expect(painted(AQUA_THEME.minesCell("revealed"))).toBe(true);
  click(280, 69); // focus Files by its caption
  key("End");
  expect(has("document-39.txt")).toBe(true);
  expect(has("document-00.txt")).toBe(false);
  key("Enter");
  expect(sent.map(v => JSON.parse(v)).some(v => v.t === "files-open" && v.path === "/Users/example/document-39.txt")).toBe(true);
  key("Home");
  expect(has("document-00.txt")).toBe(true);
  // Only Home / Native Apps / Pocket Apps appear in the sidebar.
  click(80, 148); // Native Apps
  expect(has("Native Apps - Files")).toBe(true);
  expect(iconTextures.size).toBe(1);
  for (let i = 0; i < 3; i++) {
    key("t", true, true); step(world, 20);
    const pixels = world.render();
    let green = 0;
    for (let at = 0; at < pixels.length; at += 4) if (pixels[at] === 12 && pixels[at + 1] === 190 && pixels[at + 2] === 80) green++;
    expect(green).toBe(256); // Actual uploaded icon remains visible through theme changes.
    expect(iconTextures.size).toBe(1);
  }
  click(280, 141); click(280, 141);
  expect(sent.map(v => JSON.parse(v)).some(v => v.t === "files-open" && v.path === "/Applications/Calculator.app")).toBe(true);
  click(80, 168); // Pocket Apps
  expect(has("Pocket Apps - Files")).toBe(true);
  expect(iconTextures.size).toBe(0);
  expect(has("Cards")).toBe(true);
  expect(has("Motions")).toBe(true);
  expect(has("Stats")).toBe(true);
  expect(has("OpenStrike")).toBe(true);
  for (const app of ["Motions", "Cards", "Stats"]) {
    send({ t: "ch", s: app }); step(world);
    key("Enter");
    expect(has(`PocketJS: ${app}`)).toBe(true);
    click(80, 168); // Files remains independent behind every child window
    step(world, 70); // next type-ahead query
  }
  key("n", true);
  expect(count("Pocket Apps - Files")).toBe(2);
  key("w", true);
  expect(count("Pocket Apps - Files")).toBe(1);
  click(80, 128); // Home
  expect(has("Home - Files")).toBe(true);
  expect(has("document-00.txt")).toBe(true);
  click(45, 96); // Back
  expect(has("Pocket Apps - Files")).toBe(true);
  click(76, 96); // Forward
  expect(has("Home - Files")).toBe(true);
  for (const theme of [CLASSIC_THEME, XP_THEME, AQUA_THEME]) {
    key("t", true, true); step(world, 20);
    expect(painted(theme.desktop)).toBe(true);
    expect(has("Home - Files")).toBe(true);
    expect(has("Minesweeper")).toBe(true);
  }
  for (let i = 0; i < 6; i++) key("w", true); step(world, 20);
  for (const theme of [AQUA_THEME, CLASSIC_THEME, XP_THEME]) {
    if (theme !== AQUA_THEME) key("t", true, true);
    const p = desktopIconPosition(0, 10, theme.metrics, 800);
    const art = () => {
      const pixels = world.render();
      return Buffer.concat(Array.from({ length: 32 }, (_, y) => Buffer.from(pixels.slice(((p.y + y) * 800 + p.x + 21) * 4, ((p.y + y) * 800 + p.x + 53) * 4))));
    };
    click(400, 500); // clear selection
    const before = art();
    click(p.x + 37, p.y + 16);
    expect(art().equals(before)).toBe(false);
  }
}, 30000);


test("native content claims pointer input after chrome, and failures stay in their window", async () => {
  const { world, send, sent, has, mouse, click, key } = await desktop(true, true);
  key("w", true); key("w", true); key("w", true);
  click(750, 224); click(750, 224);
  expect(has("OpenStrike")).toBe(true);
  const m = AQUA_THEME.metrics;
  const geo = cascadePos(0, 800, 600, 640 + m.frame * 2, 360 + contentTop({ menuWidths: [] }, m) + m.frame, m);
  sent.length = 0;
  mouse(geo.x + geo.w - 2, geo.y + geo.h - 2, true); step(world);
  mouse(geo.x + geo.w - 82, geo.y + geo.h - 52, true); step(world);
  mouse(geo.x + geo.w - 82, geo.y + geo.h - 52, false); step(world);
  expect(sent.map(line => JSON.parse(line)).some(line => line.t === "native-pointer" && line.d)).toBe(false);
  click(geo.x + 100, geo.y + 100);
  expect(sent.map(line => JSON.parse(line)).some(line => line.t === "native-pointer" && line.d && line.package === "dev.pocket-stack.openstrike")).toBe(true);
  send({ t: "app-error", package: "dev.pocket-stack.openstrike", error: "Native module build mismatch" }); step(world);
  expect(has("Native module build mismatch")).toBe(true);
  key("w", true);
  expect(has("Native module build mismatch")).toBe(false);
});
