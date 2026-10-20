// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/discord-fixture.ts — the companion's discord service as NET
// routes for the Discord sim tests (hosts/sim/net.ts): servers, channels, a
// channel's pages, the live poll, sending and pictures. Every name and
// message is invented for the fixture.

import type { SimNetRequest, SimNetResponse, SimNetRoute } from "../../../vendor/pocketjs/hosts/sim/net.ts";

export const DISCORD = "https://companion.pocket/discord";

export interface FixtureMessage {
  id: string;
  author: { id: string; name: string; avatar: string | null; bot: boolean };
  content: string;
  time: number;
  when: string;
  edited: boolean;
  attachments: number;
  replyTo: { author: string; content: string } | null;
  system: boolean;
}

const PEOPLE = [
  { id: "301", name: "Alice", avatar: "a1", bot: false },
  { id: "302", name: "Bruno", avatar: null, bot: false },
  { id: "303", name: "pocketbot", avatar: "b0", bot: true },
];

export interface DiscordFixture {
  routes: Readonly<Record<string, SimNetRoute>>;
  /** Discord is not set up on the Mac: every data endpoint answers 409. */
  setup: boolean;
  /** Messages of #general, oldest first. */
  general: FixtureMessage[];
  /** Messages the next poll of #general returns. */
  push(content: string, author?: number): void;
  posted: { channel: string; content: string }[];
  polls: number;
}

let nextId = 5000;

export function message(content: string, author = 0, extra: Partial<FixtureMessage> = {}): FixtureMessage {
  const id = String(nextId++);
  return {
    id,
    author: PEOPLE[author]!,
    content,
    time: Date.UTC(2026, 9, 20, 6, 0) + Number(id) * 60_000,
    when: "Today at 14:03",
    edited: false,
    attachments: 0,
    replyTo: null,
    system: false,
    ...extra,
  };
}

/** A 32x32 PSM_4444 IMG entry, opaque blue. */
function picture(): Uint8Array {
  const entry = new Uint8Array(8 + 32 * 32 * 2);
  const view = new DataView(entry.buffer);
  view.setUint16(0, 32, true);
  view.setUint16(2, 32, true);
  entry[4] = 2;
  for (let index = 0; index < 32 * 32; index++) view.setUint16(8 + index * 2, 0xff40, true);
  return entry;
}

export function discordFixture(options: { setup?: boolean; history?: number } = {}): DiscordFixture {
  const history = options.history ?? 6;
  const general: FixtureMessage[] = [];
  general.push(message("Alice joined the server.", 0, { system: true }));
  for (let index = 1; index < history - 3; index++) general.push(message(`Message number ${index} in the backlog.`, index % 2));
  general.push(message("Has anyone tried running Discord on a 3DS? The touch screen is exactly the right size for a channel, and the shoulder buttons page through history.", 0));
  general.push(message("It works through the Mac.", 1, { replyTo: { author: "Alice", content: "Has anyone tried running Discord on a 3DS?" } }));
  general.push(message("Newest: the bot says hello.", 2));
  const pending: FixtureMessage[] = [];
  const fixture: DiscordFixture = {
    routes: {},
    setup: options.setup ?? true,
    general,
    push(content, author = 1) {
      pending.push(message(content, author));
    },
    posted: [],
    polls: 0,
  };
  const json = (status: number, value: unknown, delayTicks = 1): SimNetResponse => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(value), delayTicks });
  const handle = (request: SimNetRequest): SimNetResponse => {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/discord/, "");
    if (path.startsWith("/avatar/") || path.startsWith("/icon/")) return { status: 200, body: picture() };
    if (!fixture.setup) return json(409, { error: "Discord is not set up on the Mac.", setup: "bun tools/companion.ts service discord token <bot-token>" });
    if (path === "/guilds") {
      return json(200, { guilds: [{ id: "100", name: "Pocket Lab", icon: "i1" }, { id: "101", name: "Retro Handhelds", icon: null }] });
    }
    if (path === "/guilds/100/channels") {
      return json(200, {
        channels: [
          { id: "200", name: "welcome", category: null, topic: "" },
          { id: "201", name: "general", category: "Text Channels", topic: "say hi" },
          { id: "202", name: "3ds-dev", category: "Text Channels", topic: "" },
        ],
      });
    }
    const channel = path.match(/^\/channels\/(\d+)\/messages$/);
    if (channel) {
      const list = channel[1] === "201" ? general : [];
      if (request.method === "POST") {
        const { content } = JSON.parse(new TextDecoder().decode(request.body)) as { content: string };
        fixture.posted.push({ channel: channel[1]!, content });
        const sent = message(content, 2);
        list.push(sent);
        return json(200, { message: sent });
      }
      const after = url.searchParams.get("after");
      if (after) {
        fixture.polls++;
        const fresh = pending.splice(0);
        list.push(...fresh);
        // An empty poll is held, as the companion holds it for the gateway.
        return json(200, { messages: fresh }, fresh.length ? 2 : 90);
      }
      const before = url.searchParams.get("before");
      const older = before ? list.filter((entry) => Number(entry.id) < Number(before)) : list;
      const page = older.slice(-30);
      return json(200, { messages: page, more: older.length > page.length });
    }
    return json(404, { error: `no route ${path}` });
  };
  fixture.routes = new Proxy({} as Record<string, SimNetRoute>, {
    get: (_, key) => (typeof key === "string" && key.startsWith(DISCORD) ? handle : undefined),
  });
  return fixture;
}
