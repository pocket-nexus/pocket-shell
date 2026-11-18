// Packages a built Tab5 firmware for distribution.
//   bun tools/firmware-dist.ts [--build programs/m5stack-tab5/build] [--out .pocket-build/dist]
// Run with the ESP-IDF environment exported (esptool on PATH). Writes, for
// the build's project version <v>:
//   pocket-m5-tab5-<v>.bin   bootloader, partition table and app merged from
//                            0x0, padded with 0xFF (erases nvs and phy_init)
//   pocket-m5-tab5-<v>.zip   the three images and flash_args, for an update
//                            that keeps nvs (saved Wi-Fi networks)
//   SHA256SUMS               SHA-256 of the .bin and the .zip
//   RELEASE.md               versions and flashing commands
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return resolve(index >= 0 && args[index + 1] ? args[index + 1]! : fallback);
};
const build = option("--build", join(root, "programs", "m5stack-tab5", "build"));
const out = option("--out", join(root, ".pocket-build", "dist"));

const run = (command: string, argv: string[], cwd: string) => {
  const result = spawnSync(command, argv, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${argv.join(" ")} exited with ${result.status ?? result.error}`);
  }
  return result.stdout.trim();
};

interface FlasherArgs {
  write_flash_args: string[];
  flash_files: Record<string, string>;
  extra_esptool_args: { chip: string };
}
const flasher = JSON.parse(readFileSync(join(build, "flasher_args.json"), "utf8")) as FlasherArgs;
const project = JSON.parse(readFileSync(join(build, "project_description.json"), "utf8")) as {
  project_version: string;
  git_revision: string;
  target: string;
};
const chip = flasher.extra_esptool_args.chip;
const version = project.project_version;
const name = `pocket-m5-tab5-${version}`;
const pocketjs = run("git", ["-C", join(root, "third_party", "pocketjs"), "rev-parse", "--short=8", "HEAD"], root);

rmSync(out, { recursive: true, force: true });
const parts = join(out, name);
mkdirSync(parts, { recursive: true });
const offsets = Object.entries(flasher.flash_files).sort(([a], [b]) => Number(a) - Number(b));
for (const [, file] of offsets) {
  mkdirSync(join(parts, dirname(file)), { recursive: true });
  copyFileSync(join(build, file), join(parts, file));
}
const flashArgs = [flasher.write_flash_args.join(" "), ...offsets.map(([offset, file]) => `${offset} ${file}`)].join("\n") + "\n";
writeFileSync(join(parts, "flash_args"), flashArgs);

const merged = `${name}.bin`;
run("python", ["-m", "esptool", "--chip", chip, "merge-bin", "-o", join(out, merged), "@flash_args"], parts);
const zip = `${name}.zip`;
run("zip", ["-qr", join(out, zip), name], out);
rmSync(parts, { recursive: true });

const sha256 = (file: string) => createHash("sha256").update(readFileSync(join(out, file))).digest("hex");
writeFileSync(join(out, "SHA256SUMS"), [merged, zip].map(file => `${sha256(file)}  ${file}\n`).join(""));

const layout = offsets.map(([offset, file]) => `| \`${offset}\` | \`${basename(file)}\` |`).join("\n");
writeFileSync(join(out, "RELEASE.md"), `PocketJS firmware for the M5Stack Tab5 (${chip}), ${version}.

| Component | Version |
| --- | --- |
| pocket-m5 | \`${version}\` |
| pocketjs | \`${pocketjs}\` |
| ESP-IDF | \`${project.git_revision}\` |

## Install

\`${merged}\` holds the bootloader, partition table and app from offset 0x0.
Writing it erases the \`nvs\` partition (saved Wi-Fi networks); the
\`apps\` and \`storage\` partitions and the microSD card keep their apps
and data.

\`\`\`sh
python -m esptool --chip ${chip} -p <port> -b 460800 write-flash 0x0 ${merged}
\`\`\`

## Update and keep saved networks

\`${zip}\` holds the images and \`flash_args\`:

\`\`\`sh
unzip ${zip} && cd ${name}
python -m esptool --chip ${chip} -p <port> -b 460800 write-flash @flash_args
\`\`\`

| Offset | Image |
| --- | --- |
${layout}

\`SHA256SUMS\` lists the SHA-256 of both files.
`);
console.log(`${out}: ${merged}, ${zip}, SHA256SUMS, RELEASE.md`);
