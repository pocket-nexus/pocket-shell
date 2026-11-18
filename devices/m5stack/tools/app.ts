// Compiles an app for the host contract of programs/m5stack-tab5 (tab5-home).
//   bun run app build apps/unit-swap/pocket.app.json [--host-config <path>]
// Packages land in .pocket-build/apps/<output>.pocket.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const [command, manifestArgument, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf(name);
  return index >= 0 ? rest[index + 1] : undefined;
};
const usage = () => {
  console.error("usage: bun run app build <pocket.app.json> [--host-config <path>]");
  process.exit(2);
};
if (command !== "build" || !manifestArgument) usage();

const hostConfig = option("--host-config") ? resolve(option("--host-config")!)
  : join(root, "programs", "m5stack-tab5", "pocket.host.config.ts");
const frameworkRoot = process.env.POCKETJS_ROOT ?? resolve(root, "../../vendor/pocketjs");
if (!existsSync(hostConfig)) {
  console.error(`no host config: ${hostConfig}`);
  process.exit(2);
}
const manifest = resolve(manifestArgument!);
const output: string = JSON.parse(readFileSync(manifest, "utf8")).app.output;
const buildRoot = join(root, ".pocket-build", "apps");
const pocket = join(buildRoot, `${output}.pocket`);
const compile = spawnSync(
  "bun",
  [join(frameworkRoot, "tools", "pocket.ts"), "compile",
    "--manifest", manifest, "--host-config", hostConfig,
    "--project-root", dirname(manifest), "--outdir", join(buildRoot, output),
    "--plan-dir", join(buildRoot, output, "plans"), "--output", pocket],
  { cwd: root, stdio: "inherit" },
);
if (compile.status !== 0) process.exit(compile.status ?? 1);
