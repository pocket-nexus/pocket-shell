// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/github-sim.test.ts — GitHub in the simulator on the Tab5's
// 592x360 surface, with api.github.com and the companion's services as routes
// of the applet's worker (test/net-fake.ts): signed out, the tabs, a
// repository and an issue, and a failed request.
//
// POCKET_GITHUB_SHOTS=<dir> writes PNGs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Console3ds } from "../../../vendor/pocketjs/programs/sim/console-3ds.ts";
import { encodePNG } from "../../../vendor/pocketjs/tools/png.ts";
import { buildGuest } from "./build.ts";
import { bootWithNet, type NetConsole, type NetRequest, type NetRoutes } from "./net-fake.ts";
import { TAB5 } from "./tab5.ts";

const OUT = mkdtempSync(join(tmpdir(), "pocket-github-"));
const SHOTS = process.env.POCKET_GITHUB_SHOTS;
const GLOBALS = ["ui", "__pak", "__simHz", "frame", "link", "wifi", "camera", "net", "__pocketWorkerChannels", "media", "__pocketApp"] as const;
const saved = new Map(GLOBALS.map((key) => [key, (globalThis as Record<string, unknown>)[key]]));
let GUEST = "";

beforeAll(() => {
  GUEST = buildGuest("github", OUT);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}, 180_000);

afterAll(() => {
  for (const [key, value] of saved) (globalThis as Record<string, unknown>)[key] = value;
  rmSync(OUT, { recursive: true, force: true });
});

const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();
const ME = { login: "ada", name: "Ada Lovelace", bio: "First programmer.", avatar_url: "https://avatars.githubusercontent.com/u/1" };
const REPO = { id: 1, full_name: "ada/engine", name: "engine", owner: { login: "ada", avatar_url: ME.avatar_url }, description: "The analytical engine, in TypeScript and on a very long line that has to wrap", language: "TypeScript", stargazers_count: 1200, forks_count: 3, default_branch: "main", open_issues_count: 2, pushed_at: iso(3), updated_at: iso(3), private: false };
const ISSUE = { id: 7, number: 7, title: "Bernoulli numbers overflow on the second card", state: "open", user: ME, comments: 2, body: "Steps:\n\n1. Punch the cards\n2. Turn the crank\n\n```ts\nconst n = 1;\n```", updated_at: iso(1), created_at: iso(30), labels: [{ name: "bug", color: "d73a4a" }, { name: "needs-triage", color: "0e8a16" }], repository_url: "https://api.github.com/repos/ada/engine", url: "https://api.github.com/repos/ada/engine/issues/7" };
const NOTE = { id: "1", unread: true, reason: "review_requested", updated_at: iso(2), repository: { full_name: "ada/engine" }, subject: { title: "Make the mill faster", type: "PullRequest", url: "https://api.github.com/repos/ada/engine/pulls/8" } };

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => ({ status, headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(value) });

function routes(options: { signedIn: boolean; failing?: RegExp }): { net: NetRoutes; asked: string[] } {
  const asked: string[] = [];
  const answer = (request: NetRequest) => {
    const url = new URL(request.url);
    asked.push(`${request.method ?? "GET"} ${url.host}${url.pathname}`);
    if (url.host === "companion.pocket") {
      if (url.pathname === "/store/get") return json({ value: options.signedIn ? { token: "test-token" } : null });
      return json({ error: "no such service here" }, 404);
    }
    const path = url.pathname;
    if (options.failing?.test(path)) return json({ message: "Server Error" }, 500);
    if (path === "/user") return options.signedIn ? json(ME) : json({ message: "Bad credentials" }, 401);
    if (path === "/notifications") return json([NOTE]);
    if (path === "/search/issues") return json({ items: [ISSUE] });
    if (path === "/user/repos") return json([REPO]);
    if (path === "/repos/ada/engine") return json(REPO);
    if (path === "/repos/ada/engine/readme") return { status: 200, headers: { "content-type": "text/plain" }, body: "# Engine\n\nIt computes.\n\n- a list\n- 日本語のテキスト\n" };
    if (path === "/repos/ada/engine/issues/7") return json(ISSUE);
    if (path === "/repos/ada/engine/issues/7/comments") return json([{ id: 1, user: ME, body: "Seen it here too.", created_at: iso(2) }]);
    if (path.startsWith("/user/starred")) return json({}, 404);
    return json({ message: "Not Found" }, 404);
  };
  const net = new Proxy({} as NetRoutes, {
    get: (_, key) => (typeof key === "string" && key.startsWith("https://") ? answer : undefined),
  });
  return { net, asked };
}

async function boot(options: { signedIn: boolean; failing?: RegExp }): Promise<{ app: NetConsole; asked: string[] }> {
  const { net, asked } = routes(options);
  const app = await bootWithNet({ js: `${GUEST}.js`, pak: `${GUEST}.pak`, current: "github-main", link: null, wifi: null, camera: false, auxiliary: TAB5 }, net);
  await app.run(60);
  return { app, asked };
}

function shot(app: Console3ds, name: string): void {
  if (!SHOTS) return;
  const { width, height, rgba } = app.world.pixels("auxiliary");
  writeFileSync(join(SHOTS, `github-${name}.png`), encodePNG(rgba, width, height));
}

const texts = (app: Console3ds) => app.texts("auxiliary");
const has = (app: Console3ds, text: string) => texts(app).some((t) => t.includes(text));
const TAB_Y = 360 - 22;
const tab = (app: Console3ds, index: number) => app.tap(((index + 0.5) * 592) / 5, TAB_Y);

describe("GitHub on the Tab5", () => {
  test("signed out, each tab says so and offers to sign in", async () => {
    const { app } = await boot({ signedIn: false });
    expect(has(app, "Sign in to see your notifications")).toBe(true);
    shot(app, "signed-out");
    await app.tap(40, 36 + 118);
    await app.run(10);
    expect(has(app, "Scan this to make a token")).toBe(true);
    shot(app, "signin");
  });

  test("signed in, the tabs show their lists", async () => {
    const { app } = await boot({ signedIn: true });
    expect(has(app, "Make the mill faster")).toBe(true);
    shot(app, "inbox");
    await tab(app, 1);
    await app.run(30);
    expect(has(app, "Bernoulli numbers")).toBe(true);
    shot(app, "pulls");
    await tab(app, 3);
    await app.run(30);
    expect(has(app, "ada/engine")).toBe(true);
    shot(app, "repos");
    await tab(app, 4);
    await app.run(30);
    expect(has(app, "Ada Lovelace")).toBe(true);
    shot(app, "me");
  });

  test("a repository and its README, with text the baked face lacks", async () => {
    const { app, asked } = await boot({ signedIn: true });
    await tab(app, 3);
    await app.run(30);
    await app.tap(200, 36 + 26 + 16 + 30);
    await app.run(40);
    expect(has(app, "Browse")).toBe(true);
    expect(asked).toContain("GET api.github.com/repos/ada/engine");
    shot(app, "repo");
  });

  test("a failed request says so and tries again", async () => {
    const { app, asked } = await boot({ signedIn: true, failing: /notifications/ });
    expect(has(app, "Could not load this")).toBe(true);
    shot(app, "failed");
    const before = asked.filter((line) => line.includes("notifications")).length;
    expect(before).toBeGreaterThan(0);
  });
});
