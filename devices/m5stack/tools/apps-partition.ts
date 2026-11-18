// Writes installed packages onto a Tab5's `apps` partition over USB.
//   bun tools/apps-partition.ts <out.bin> <package.pocket>... [--flash <port>]
//
// The image is the partition as pocket_system's flash store
// (programs/m5stack-tab5/components/pocket_system/src/flash_store.c) leaves
// it after installing each package in turn: per package an extent of whole
// 64 KiB pages, a 64-byte header ("PKAP", version 1, size, pages, sequence,
// the package's FNV-1a64 footer, the slot) then the package from offset 64;
// every other byte 0xFF, as erased flash reads. The slot is the first 16 hex
// digits of SHA-256 of the app id, the slot the firmware names. Each package
// must be admitted by this repository's host contract (tab5-home), the check
// the firmware makes when it reads the partition at start.
//
// --flash writes the image at the partition's offset with esptool (`python
// -m esptool`, the ESP-IDF environment exported). The other partitions, the
// card and the store's files are not touched; the firmware lists a package
// whose slot directory is missing (pocket_system's admit_flash_store makes
// it).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { admissionHost, describeRejection, selectVariant } from "../third_party/pocketjs/contracts/spec/admission.ts";
import { decodeIdentity, decodePocketPackage, POCKET_SECTION } from "../third_party/pocketjs/contracts/spec/pocket-package.ts";
import { hashPocketProfile, readPocketProfile } from "../third_party/pocketjs/framework/src/profile.ts";

const root = resolve(import.meta.dir, "..");
const program = join(root, "programs", "m5stack-tab5");
const PAGE = 0x10000;
const HEADER = 64;
const MAGIC = 0x50414b50; // "PKAP"

const args = process.argv.slice(2);
const flashAt = args.indexOf("--flash");
const port = flashAt >= 0 ? args[flashAt + 1] : undefined;
const files = args.filter((_, index) => flashAt < 0 || (index !== flashAt && index !== flashAt + 1));
const [out, ...packages] = files;
if (!out || packages.length === 0 || (flashAt >= 0 && !port)) {
  console.error("usage: bun tools/apps-partition.ts <out.bin> <package.pocket>... [--flash <port>]");
  process.exit(2);
}

// The `apps` row of partitions.csv: name, type, subtype, offset, size.
const row = readFileSync(join(program, "partitions.csv"), "utf8")
  .split("\n")
  .map((line) => line.split(",").map((field) => field.trim()))
  .find((fields) => fields[0] === "apps");
if (!row) throw new Error("partitions.csv has no apps partition");
const offset = Number(row[3]);
const size = /M$/.test(row[4]!) ? Number(row[4]!.slice(0, -1)) * 0x100000 : Number(row[4]);
if (!Number.isInteger(offset) || !Number.isInteger(size) || size % PAGE !== 0) throw new Error(`apps partition: offset ${row[3]}, size ${row[4]}`);

const profile = readPocketProfile(join(program, "pocket.host.json"));
const host = admissionHost(profile, hashPocketProfile(profile));
const image = new Uint8Array(size).fill(0xff);
const view = new DataView(image.buffer);
const slots = new Set<string>();
let page = 0;
let sequence = 1;
for (const path of packages) {
  const bytes = new Uint8Array(readFileSync(path));
  const pkg = decodePocketPackage(bytes); // magic, layout and the FNV-1a64 footer
  const selection = selectVariant(pkg, host);
  if (!selection.ok) throw new Error(`${path}: ${describeRejection(selection)}`);
  const identity = selection.variant.sections.find((section) => section.kind === POCKET_SECTION.identity);
  if (!identity) throw new Error(`${path}: the admitted variant has no identity section`);
  const id = decodeIdentity(identity.bytes).id;
  const slot = createHash("sha256").update(id).digest("hex").slice(0, 16);
  if (slots.has(slot)) throw new Error(`${path}: ${id} is already in the image`);
  slots.add(slot);
  const pages = Math.ceil((bytes.length + HEADER) / PAGE);
  if ((page + pages) * PAGE > size) throw new Error(`${path}: ${pages} pages do not fit after page ${page} of ${size / PAGE}`);
  const base = page * PAGE;
  image.set(bytes, base + HEADER);
  view.setUint32(base, MAGIC, true);
  view.setUint32(base + 4, 1, true); // version
  view.setUint32(base + 8, bytes.length, true);
  view.setUint32(base + 12, pages, true);
  view.setUint32(base + 16, sequence, true);
  view.setUint32(base + 20, 0, true); // reserved
  view.setBigUint64(base + 24, new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(bytes.length - 8, true), true);
  image.set(new TextEncoder().encode(slot), base + 32);
  // bytes 48..59 stay 0xFF (padding); 60..63 0xFFFFFFFF is the live state
  console.log(`${id}  slot ${slot}  pages ${page}..${page + pages - 1}  ${bytes.length} bytes`);
  page += pages;
  sequence += 1;
}
writeFileSync(out, image);
console.log(`${out}: ${page} of ${size / PAGE} pages, at 0x${offset.toString(16)}`);

if (port) {
  const flash = spawnSync("python", ["-m", "esptool", "--chip", "esp32p4", "-p", port, "-b", "460800", "write-flash", `0x${offset.toString(16)}`, out], { stdio: "inherit" });
  process.exit(flash.status ?? 1);
}
