// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, resolve } from "node:path";
import { ROOT } from "./system-plan.ts";

interface CdpReply {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
  params?: unknown;
}

function chromeBinary(): string {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    Bun.which("google-chrome"),
    Bun.which("chromium"),
    Bun.which("chromium-browser"),
  ];
  const binary = candidates.find(
    (candidate): candidate is string => Boolean(candidate && existsSync(candidate)),
  );
  if (!binary) throw new Error("Pocket Shell Desktop site smoke requires Chrome or Chromium (set CHROME_BIN)");
  return binary;
}

async function waitFor<T>(label: string, read: () => Promise<T | null>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(100);
  }
  throw new Error("timed out waiting for " + label + (lastError ? ": " + String(lastError) : ""));
}

async function browserSmoke(origin: string): Promise<void> {
  const debugPort = 45_000 + (process.pid % 1_000);
  const profile = mkdtempSync(resolve(tmpdir(), "pocket-desktop-site-chrome-"));
  const chrome = Bun.spawn([
    chromeBinary(),
    "--headless=new",
    "--remote-debugging-port=" + debugPort,
    "--user-data-dir=" + profile,
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1280,1000",
    origin + "/",
  ], { stdout: "ignore", stderr: "inherit" });
  let socket: WebSocket | null = null;
  try {
    const target = await waitFor<{ webSocketDebuggerUrl: string }>("Chrome DevTools target", async () => {
      const response = await fetch("http://127.0.0.1:" + debugPort + "/json/list");
      if (!response.ok) return null;
      const targets = await response.json() as Array<{ type?: string; url?: string; webSocketDebuggerUrl?: string }>;
      const page = targets.find((entry) => entry.type === "page" && entry.url?.startsWith(origin) && entry.webSocketDebuggerUrl);
      return page?.webSocketDebuggerUrl ? { webSocketDebuggerUrl: page.webSocketDebuggerUrl } : null;
    });
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolveOpen, reject) => {
      socket!.addEventListener("open", () => resolveOpen(), { once: true });
      socket!.addEventListener("error", () => reject(new Error("Chrome DevTools WebSocket failed")), { once: true });
    });
    let nextId = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
    const pageErrors: string[] = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpReply;
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        if (!waiter) return;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message ?? "CDP error"));
        else waiter.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(JSON.stringify(message.params));
      }
    });
    const command = <T = unknown>(method: string, params: object = {}): Promise<T> => {
      const id = ++nextId;
      return new Promise<T>((resolveCommand, reject) => {
        pending.set(id, { resolve: (value) => resolveCommand(value as T), reject });
        socket!.send(JSON.stringify({ id, method, params }));
      });
    };
    const evaluate = async <T>(expression: string): Promise<T> => {
      const reply = await command<{ result?: { value?: T }; exceptionDetails?: unknown }>("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
      return reply.result?.value as T;
    };
    await command("Runtime.enable");
    await command("Page.enable");
    // Module scripts install the theme and preview listeners after parsing.
    // A visible heading alone can precede those listeners on a fresh load.
    await waitFor("the page modules", async () =>
      await evaluate<boolean>("document.readyState === 'complete'") ? true : null
    );
    await waitFor("the landing page", async () =>
      (await evaluate<string>("document.querySelector('h1')?.textContent ?? ''")).includes("One process") ? true : null
    );
    await evaluate("document.querySelector('[data-theme-shot=classic]')?.click()");
    await waitFor("the classic theme preview", async () =>
      (await evaluate<string>("document.querySelector('#theme-screenshot')?.getAttribute('src') ?? ''")).endsWith("classic-theme.png") ? true : null
    );
    await evaluate("document.querySelector('#launch-preview')?.click()");
    const ready = await waitFor<string>("the embedded WASM System", async () => {
      const status = await evaluate<string>("document.querySelector('#preview-mount iframe')?.contentDocument?.querySelector('#status')?.textContent ?? ''");
      return status.startsWith("Ready") ? status : null;
    }, 60_000);
    await evaluate("document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0, document.querySelector('.live-section').offsetTop); document.querySelectorAll('.reveal').forEach((node) => node.classList.add('shown'))");
    await Bun.sleep(800);
    const screenshot = await command<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await Bun.write(resolve(ROOT, "dist/site-smoke.png"), Buffer.from(screenshot.data, "base64"));
    if (pageErrors.length > 0) throw new Error("site browser errors:\n" + pageErrors.join("\n"));
    console.log("Pocket Shell Desktop site browser: theme switch and embedded preview " + ready);
  } finally {
    socket?.close();
    chrome.kill();
    await chrome.exited;
    rmSync(profile, { recursive: true, force: true });
  }
}

const output = resolve(ROOT, "dist/site");
const required = [
  "index.html",
  "docs/index.html",
  "docs/architecture/index.html",
  "docs/run/index.html",
  "docs/themes/index.html",
  "docs/contributing/index.html",
  "404.html",
  "site.css",
  "site.js",
  "favicon.svg",
  "assets/classic-theme.png",
  "assets/xp-theme.png",
  "assets/aqua-theme.png",
  "play/index.html",
  "play/runtime/platforms/web/pocketjs.wasm",
  "play/pocket-desktop.system.plan.json",
];
for (const file of required) {
  const path = resolve(output, file);
  if (!existsSync(path) || statSync(path).size === 0) throw new Error("missing site artifact: " + file);
}

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".json": "application/json",
};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    let relative = url.pathname.slice(1);
    if (!relative || relative.endsWith("/")) relative += "index.html";
    const path = resolve(output, relative);
    if (!path.startsWith(output + "/") || !existsSync(path)) {
      return new Response(Bun.file(resolve(output, "404.html")), { status: 404 });
    }
    return new Response(Bun.file(path), {
      headers: { "content-type": mime[extname(path)] ?? "application/octet-stream" },
    });
  },
});

const origin = "http://127.0.0.1:" + server.port;
const routes = ["/", "/docs/", "/docs/architecture/", "/docs/run/", "/docs/themes/", "/docs/contributing/", "/play/"];
try {
  for (const route of routes) {
    const response = await fetch(origin + route);
    if (!response.ok) throw new Error(route + " returned " + response.status);
    const html = await response.text();
    if (!html.includes("Pocket Shell Desktop")) throw new Error(route + " is not a Pocket Shell Desktop document");
  }
  const home = await (await fetch(origin + "/")).text();
  for (const contract of ["native process", "/play/", "25.35", "AppSupervisor", "GPLv3"]) {
    if (!home.includes(contract)) throw new Error("landing page is missing contract: " + contract);
  }
  const architecture = await (await fetch(origin + "/docs/architecture/")).text();
  for (const contract of ["ResolvedSystemPlan", "ui.compositor-surfaces", "raster-resource revision"]) {
    if (!architecture.includes(contract)) throw new Error("architecture docs are missing contract: " + contract);
  }
  const missing = await fetch(origin + "/not-a-real-page");
  if (missing.status !== 404) throw new Error("missing page returned " + missing.status);
  await browserSmoke(origin);
  console.log("Pocket Shell Desktop site smoke: " + routes.length + " routes, product contracts, preview artifacts, and 404 passed");
} finally {
  server.stop(true);
}
