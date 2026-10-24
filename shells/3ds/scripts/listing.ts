// SPDX-License-Identifier: GPL-3.0-or-later
// bun run listing — Pocket Studio's listings of Pocket Shell and Pocket
// Companion, into dist/listing/{shell,companion}/ for `pocket-studio listing`.
//
// The words are listing/{shell,companion}.json. Pocket Shell's pictures are the
// real-console screenshots in media/hw/ (400x480: the two screens stacked),
// doubled with nearest-neighbour sampling and set on a 1600x1000 frame; its
// applets' icons are Home's. Pocket Companion's pictures are its own pages,
// drawn by the app built by `bun run release` (`--snapshot … --window`)
// against a scratch store holding one paired console, on the same frame.
// Never a picture of the console's Photos or Camera applets.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "bun";
import { PROJECT_ROOT, ROOT } from "./paths.ts";

const FRAME = { width: 1600, height: 1000, colour: "#171226" } as const;
const CARD = { width: 1200, height: 630 } as const;
const out = resolve(ROOT, "dist/listing");
const companionApp = resolve(ROOT, ".pocket-build/companion/Pocket Companion.app");

interface Words {
  media: Array<{ file: string; caption: string; still?: string; page?: string }>;
  card: string;
  applets?: Array<{ name: string; icon: string; line: string; companion: boolean }>;
  [field: string]: unknown;
}

const words = (slug: string): Words => JSON.parse(readFileSync(resolve(PROJECT_ROOT, "listing", `${slug}.json`), "utf8"));

/** `source` through `filter` (its scaling), centred on the frame. */
async function frame(source: string, file: string, filter: string) {
  await $`ffmpeg -nostdin -v error -y -i ${source} -frames:v 1 -vf ${`${filter},pad=${FRAME.width}:${FRAME.height}:(ow-iw)/2:(oh-ih)/2:color=${FRAME.colour}`} -q:v 2 ${file}`;
}

async function card(source: string, file: string, filter: string) {
  await $`ffmpeg -nostdin -v error -y -i ${source} -frames:v 1 -vf ${`${filter},pad=${CARD.width}:${CARD.height}:(ow-iw)/2:(oh-ih)/2:color=${FRAME.colour}`} -q:v 3 ${file}`;
}

async function shell() {
  const dir = resolve(out, "shell");
  mkdirSync(dir, { recursive: true });
  const listing = words("shell");
  const media = [];
  for (const entry of listing.media) {
    // 400x480 doubled is 800x960, inside the frame's 1000 rows.
    await frame(resolve(PROJECT_ROOT, entry.still!), resolve(dir, entry.file), "scale=iw*2:ih*2:flags=neighbor");
    media.push({ kind: "image", file: entry.file, width: FRAME.width, height: FRAME.height, from: "3ds", caption: entry.caption });
  }
  await card(resolve(PROJECT_ROOT, listing.card), resolve(dir, "card.jpg"), `scale=-2:${CARD.height}:flags=neighbor`);
  const applets = [];
  for (const applet of listing.applets!) {
    await $`ffmpeg -nostdin -v error -y -i ${resolve(PROJECT_ROOT, `home/art/icons/${applet.icon}-64.png`)} -frames:v 1 -vf scale=128:128:flags=lanczos ${resolve(dir, `${applet.icon}.png`)}`;
    applets.push({ ...applet, icon: `${applet.icon}.png` });
  }
  writeFileSync(resolve(dir, "listing.json"), `${JSON.stringify({ ...listing, media, card: "card.jpg", applets }, null, 2)}\n`);
  return dir;
}

async function companion() {
  if (!existsSync(companionApp)) throw new Error("listing: build Pocket Companion first (bun run release)");
  const dir = resolve(out, "companion");
  const scratch = resolve(ROOT, ".pocket-build/listing-store");
  mkdirSync(dir, { recursive: true });
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const hex = (bytes: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");
  // One paired console, so Get Started shows the first two steps done.
  writeFileSync(resolve(scratch, "companion.json"), JSON.stringify({
    version: 1,
    id: hex(8),
    consoles: [{ id: hex(8), name: "Nintendo 3DS", model: "3DS", key: hex(32), lastAddress: "192.168.1.20", lastSeen: Date.now() - 3_600_000 }],
  }), { mode: 0o600 });
  const listing = words("companion");
  const pages = new Map<string, string>();
  for (const page of new Set([...listing.media.map((entry) => entry.page!), listing.card])) {
    const png = resolve(scratch, `${page}.png`);
    const app = Bun.spawn([resolve(companionApp, "Contents/MacOS/PocketCompanion"), "--snapshot", png, "--page", page, "--window"], {
      env: { ...process.env, POCKET_COMPANION_HOME: scratch },
      stdout: "ignore",
      stderr: "ignore",
    });
    for (let waited = 0; !existsSync(png) && waited < 20_000; waited += 250) await Bun.sleep(250);
    app.kill();
    await app.exited;
    if (!existsSync(png)) throw new Error(`listing: the Companion drew no ${page} page`);
    pages.set(page, png);
    await Bun.sleep(2_500); // the daemon leaves with its parent
  }
  const media = [];
  for (const entry of listing.media) {
    await frame(pages.get(entry.page!)!, resolve(dir, entry.file), `scale=${FRAME.width - 80}:${FRAME.height - 80}:force_original_aspect_ratio=decrease:flags=lanczos`);
    media.push({ kind: "image", file: entry.file, width: FRAME.width, height: FRAME.height, from: "macos", caption: entry.caption });
  }
  await card(pages.get(listing.card)!, resolve(dir, "card.jpg"), `scale=${CARD.width - 40}:${CARD.height - 40}:force_original_aspect_ratio=decrease:flags=lanczos`);
  writeFileSync(resolve(dir, "listing.json"), `${JSON.stringify({ ...listing, media, card: "card.jpg" }, null, 2)}\n`);
  rmSync(scratch, { recursive: true, force: true });
  return dir;
}

rmSync(out, { recursive: true, force: true });
console.log(`listing: ${await shell()}`);
console.log(`listing: ${await companion()}`);
