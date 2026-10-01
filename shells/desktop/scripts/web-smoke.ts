// SPDX-License-Identifier: GPL-3.0-only
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
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
  if (!binary) {
    throw new Error("Pocket Shell Desktop web smoke requires Chrome or Chromium (set CHROME_BIN)");
  }
  return binary;
}

async function waitFor<T>(
  label: string,
  read: () => Promise<T | null>,
  timeoutMs = 30_000,
): Promise<T> {
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
  throw new Error(
    `timed out waiting for ${label}${lastError ? `: ${String(lastError)}` : ""}`,
  );
}

const previewPort = 41_000 + (process.pid % 1_000);
const debugPort = previewPort + 1_000;
const previewUrl = `http://127.0.0.1:${previewPort}/`;
const profile = mkdtempSync(resolve(tmpdir(), "pocket-desktop-chrome-"));
const server = Bun.spawn([process.execPath, "scripts/web.ts"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(previewPort) },
  stdout: "inherit",
  stderr: "inherit",
});
let chrome: ReturnType<typeof Bun.spawn> | null = null;
let socket: WebSocket | null = null;
let screenshotTaken = false;

try {
  await waitFor("the web preview server", async () => {
    const response = await fetch(previewUrl);
    return response.ok ? true : null;
  }, 60_000);

  chrome = Bun.spawn(
    [
      chromeBinary(),
      "--headless=new",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1280,1000",
      previewUrl,
    ],
    { stdout: "ignore", stderr: "inherit" },
  );

  const target = await waitFor<{ webSocketDebuggerUrl: string }>(
    "Chrome DevTools target",
    async () => {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (!response.ok) return null;
      const targets = (await response.json()) as Array<{
        type?: string;
        url?: string;
        webSocketDebuggerUrl?: string;
      }>;
      const page = targets.find(
        (entry) =>
          entry.type === "page" &&
          entry.url?.startsWith(previewUrl) &&
          entry.webSocketDebuggerUrl,
      );
      return page?.webSocketDebuggerUrl
        ? { webSocketDebuggerUrl: page.webSocketDebuggerUrl }
        : null;
    },
  );

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolveOpen, reject) => {
    socket!.addEventListener("open", () => resolveOpen(), { once: true });
    socket!.addEventListener(
      "error",
      () => reject(new Error("Chrome DevTools WebSocket failed")),
      { once: true },
    );
  });

  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >();
  const pageErrors: string[] = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as CdpReply;
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? "CDP error"));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      pageErrors.push(JSON.stringify(message.params));
    }
    if (message.method === "Log.entryAdded") {
      const entry = (message.params as { entry?: { level?: string; text?: string } })
        ?.entry;
      if (entry?.level === "error") pageErrors.push(entry.text ?? "page log error");
    }
  });

  const command = <T = unknown>(method: string, params: object = {}): Promise<T> => {
    const id = ++nextId;
    return new Promise<T>((resolveCommand, reject) => {
      pending.set(id, {
        resolve: (value) => resolveCommand(value as T),
        reject,
      });
      socket!.send(JSON.stringify({ id, method, params }));
    });
  };
  const evaluate = async <T>(expression: string): Promise<T> => {
    const reply = await command<{
      result?: { value?: T };
      exceptionDetails?: unknown;
    }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
    return reply.result?.value as T;
  };

  await command("Runtime.enable");
  await command("Log.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1280, height: 1000, deviceScaleFactor: 2, mobile: false,
  });
  await waitFor("Pocket Shell Desktop Ready state", async () => {
    const status = await evaluate<string | null>(
      "document.querySelector('#status')?.textContent ?? null",
    );
    if (status === "Preview failed") throw new Error(await evaluate<string>("document.querySelector('#log')?.textContent ?? 'Preview failed'"));
    return status?.startsWith("Ready") ? status : null;
  }, 60_000);

  const rect = await evaluate<{ left: number; top: number; width: number; height: number }>(
    "(() => { const r = document.querySelector('#desktop').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()",
  );
  const backing = await evaluate<number[]>("(() => { const c = document.querySelector('#desktop'); return [c.width, c.height]; })()");
  if (rect.width !== 400 || rect.height !== 300 || backing[0] !== 800 || backing[1] !== 600) {
    throw new Error(`Expected 800x600 pixels displayed at 400x300, got ${backing} in ${rect.width}x${rect.height}`);
  }
  const x = rect.left + (45 / 800) * rect.width;
  const y = rect.top + (320 / 600) * rect.height;
  const click = async (clickCount: number) => {
    await command("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount,
    });
    await command("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount,
    });
  };
  await click(1);
  await Bun.sleep(80);
  await click(2);

  await Bun.sleep(500);
  const screenshotPath = resolve(ROOT, "dist/web-smoke.png");
  const capture = async () => {
    const screenshot = await command<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await Bun.write(screenshotPath, Buffer.from(screenshot.data, "base64"));
    screenshotTaken = true;
  };
  await capture();

  const appLog = await waitFor("the composited Hero AppInstance", async () => {
    const value = await evaluate<string>(
      "document.querySelector('#log')?.textContent ?? ''",
    );
    return value.includes("composited AppInstance dev.pocket-nexus.hero")
      ? value
      : null;
  }, 30_000);
  await Bun.sleep(250);
  const brightPixels = await evaluate<number>(
    "(() => { const data = document.querySelector('#desktop').getContext('2d').getImageData(390, 140, 20, 20).data; let bright = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) bright++; return bright; })()",
  );
  if (brightPixels < 300) {
    throw new Error(
      `Hero child raster did not replace the gray shell fallback (${brightPixels}/400 bright pixels)`,
    );
  }
  await capture();
  if (pageErrors.length > 0) {
    throw new Error(`browser page errors:\n${pageErrors.join("\n")}`);
  }
  console.log(
    `Pocket Shell Desktop web smoke: Ready, Hero AppInstance composited, screenshot ${screenshotPath}`,
  );
  console.log(appLog.trim());
} finally {
  socket?.close();
  chrome?.kill();
  server.kill();
  await Promise.allSettled([chrome?.exited, server.exited]);
  rmSync(profile, { recursive: true, force: true });
  if (!screenshotTaken) {
    console.error("Pocket Shell Desktop web smoke failed before the acceptance screenshot");
  }
}
