// Formats C and C++ sources with the clang-format pinned in package.json.
//   bun run format           rewrite files in place
//   bun run format:check     exit 1 when any file differs
// Tracked and untracked (non-ignored) files are included; third_party/ is not.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const check = process.argv.includes("--check");
const listed = spawnSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--",
    "*.c", "*.h", "*.cc", "*.cpp", "*.hpp", ":!:third_party/**"],
  { cwd: root, encoding: "utf8" },
);
if (listed.status !== 0) {
  process.stderr.write(listed.stderr);
  process.exit(listed.status ?? 1);
}
const files = [...new Set(listed.stdout.split("\0").filter(Boolean))];
const clangFormat = join(root, "node_modules", ".bin", "clang-format");
const mode = check ? ["--dry-run", "--Werror"] : ["-i"];
let failed = false;
for (let i = 0; i < files.length; i += 64) {
  const result = spawnSync(clangFormat, [...mode, "--style=file", ...files.slice(i, i + 64)], {
    cwd: root,
    stdio: "inherit",
  });
  failed ||= result.status !== 0;
}
console.log(`${check ? "checked" : "formatted"} ${files.length} file(s)`);
process.exit(failed ? 1 : 0);
