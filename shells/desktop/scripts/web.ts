// SPDX-License-Identifier: GPL-3.0-only
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { extname, resolve } from "node:path";
import { buildDesktopSystem } from "./build-system.ts";
import { POCKETJS_ROOT, ROOT } from "./system-plan.ts";

async function run(command: string[], cwd = ROOT): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`command failed (${code}): ${command.join(" ")}`);
}

const output = resolve(ROOT, "dist/web");
const runtime = resolve(output, "runtime");
const artifacts = resolve(output, "dist");
const planDir = resolve(ROOT, ".pocket/web-app");
rmSync(output, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });
const receipt = await buildDesktopSystem({
  target: "web-app",
  dist: artifacts,
  planDir,
});
await run([process.execPath, resolve(POCKETJS_ROOT, "tools/wasm.ts")], POCKETJS_ROOT);

await run([process.execPath, resolve(POCKETJS_ROOT, "tools/text-wasm.ts")], POCKETJS_ROOT);

// The web program (programs/web) imports the browser platform
// (platforms/web) by relative path, so both keep pocketjs's layout under
// runtime/: the scripts and wasm of the platform, and the program's three
// entry files.
const platform = resolve(POCKETJS_ROOT, "platforms/web");
mkdirSync(resolve(runtime, "platforms/web"), { recursive: true });
for (const file of readdirSync(platform)) {
  if (/\.(js|wasm)$/.test(file)) cpSync(resolve(platform, file), resolve(runtime, "platforms/web", file));
}
// platforms/web/generated-ui.js re-exports the generated guest bindings.
mkdirSync(resolve(runtime, "engine/guest-web/src"), { recursive: true });
for (const file of ["generated-ui.js", "ui-descriptors.js"]) {
  cpSync(resolve(POCKETJS_ROOT, "engine/guest-web/src", file), resolve(runtime, "engine/guest-web/src", file));
}
mkdirSync(resolve(runtime, "programs/web"), { recursive: true });
for (const file of ["app-instance.html", "app-instance.js", "system-engine.js"]) {
  cpSync(resolve(POCKETJS_ROOT, "programs/web", file), resolve(runtime, "programs/web", file));
}
for (const file of ["index.html", "preview.js", "preview.css"]) {
  cpSync(resolve(ROOT, "preview", file), resolve(output, file));
}
cpSync(
  resolve(ROOT, "src/system-ui/icons/pocket-app.svg"),
  resolve(output, "favicon.svg"),
);
cpSync(receipt.systemPlanPath, resolve(output, "pocket-desktop.system.plan.json"));
console.log(
  `Pocket Shell Desktop web preview: System UI + ${receipt.applicationCount} applications in ${output}`,
);

if (process.argv.includes("--build-only")) process.exit(0);

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".pak": "application/octet-stream",
};
const port = Number(process.env.PORT ?? 4173);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    const url = new URL(request.url);
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (relative.includes("..")) return new Response("not found", { status: 404 });
    const path = resolve(output, relative);
    if (!existsSync(path)) return new Response("not found", { status: 404 });
    return new Response(Bun.file(path), {
      headers: {
        "content-type": mime[extname(path)] ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  },
});
console.log(`Pocket Shell Desktop web preview: http://127.0.0.1:${server.port}`);
