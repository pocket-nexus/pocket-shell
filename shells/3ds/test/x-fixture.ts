// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/test/x-fixture.ts — a deterministic X for the X sim tests: the
// companion's x service (https://companion.pocket/x/) as NET routes
// (hosts/sim/net.ts), in the JSON shape PocketJS tools/companion/services/x.ts
// answers. Every name and post is invented for the fixture.

import { encodeImageEntry } from "../../../vendor/pocketjs/framework/compiler/pak.ts";
import { PSM } from "../../../vendor/pocketjs/contracts/spec/spec.ts";
import type { SimNetRoute } from "../../../vendor/pocketjs/hosts/sim/net.ts";
import type { Post } from "../x/api.ts";

export const X_SERVICE = "https://companion.pocket/x";
/** The console sim's default boot epoch. */
export const X_NOW = Date.UTC(2026, 9, 19, 1, 41, 0);
const AVATAR = "https://pbs.twimg.com/profile_images/1/face_bigger.jpg";

const NAMES: [string, string][] = [
  ["Ruth Kim", "ruthk"], ["Pocket Dev", "pocketdev"], ["Luis Moreno", "lmoreno"], ["The Hinge", "thehinge"],
  ["D-Pad Fan", "dpadfan"], ["Kestrel", "kestrel"], ["Nina Baker", "nbaker"], ["Sora Ito", "s_ito"],
];
const TEXTS = [
  "Shipped a dual-screen reader for the 3DS today. The top screen belongs to a little orange mascot now.",
  "Resistive touch screens are underrated for handwriting.",
  "QuickJS on an ARM11 at 268 MHz is faster than you would think.",
  "What is the smallest computer you still use every day?",
  "PICA200 notes, part 3: the texture combiner stages.",
  "Moved our build cache to SQLite and the CI got 40% faster.",
  "A font atlas is just a very specific kind of sprite sheet.",
  "Rust on ARMv6K without an operating system, a thread.",
];

function post(index: number, extra: Partial<Post> = {}): Post {
  const [name, handle] = NAMES[index % NAMES.length]!;
  return {
    id: String(1000 + index),
    name,
    handle,
    text: TEXTS[index % TEXTS.length]!,
    time: X_NOW - (index + 1) * 25 * 60 * 1000,
    replies: index * 3,
    reposts: index * 7,
    likes: 1200 + index * 31,
    views: 54_000,
    ...(index % 2 === 0 ? { avatar: AVATAR } : {}),
    ...extra,
  };
}

export function xPosts(page: 1 | 2): Post[] {
  if (page === 2) return Array.from({ length: 8 }, (_, i) => post(20 + i));
  return [
    post(0),
    post(1, { repostedBy: "Kestrel" }),
    post(2, { quote: { name: "Nina Baker", handle: "nbaker", text: "Fonts are sprites. Change my mind." } }),
    post(3, { media: { count: 2, kind: "photo" }, replyTo: "ruthk" }),
    ...Array.from({ length: 8 }, (_, i) => post(4 + i)),
  ];
}

function avatarEntry(): Uint8Array {
  const rgba = new Uint8Array(32 * 32 * 4).map((_, i) => (i % 4 === 3 ? 255 : i % 4 === 2 ? 220 : 60));
  return encodeImageEntry({ width: 32, height: 32, rgba }, PSM.PSM_5650);
}

/** NET routes serving the fixture; `signedOut` answers like a Mac with no X session. */
export function xRoutes(options: { signedOut?: boolean } = {}): Record<string, SimNetRoute> {
  const json = (value: unknown, status = 200): SimNetRoute => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(value), delayTicks: 3 });
  if (options.signedOut) {
    const refused = json({ error: "signed-out", message: "Not signed in to X on the Mac. Run: bun tools/companion.ts service x login" }, 401);
    return { [`${X_SERVICE}/timeline?kind=following`]: refused, [`${X_SERVICE}/timeline?kind=foryou`]: refused };
  }
  const first = xPosts(1);
  const routes: Record<string, SimNetRoute> = {
    [`${X_SERVICE}/timeline?kind=following`]: json({ posts: first, cursor: "PAGE-2" }),
    [`${X_SERVICE}/timeline?kind=following&cursor=PAGE-2`]: json({ posts: xPosts(2), cursor: null }),
    [`${X_SERVICE}/timeline?kind=foryou`]: json({ posts: [...first].reverse(), cursor: null }),
    [`${X_SERVICE}/avatar?u=${encodeURIComponent(AVATAR)}`]: { status: 200, body: avatarEntry(), delayTicks: 2 },
    [`${X_SERVICE}/post/1002`]: json({
      post: first[2],
      before: [first[0]],
      replies: [post(40, { text: "Agreed, and a glyph cache is a texture atlas too." }), post(41, { text: "This is why my 3DS port bakes fonts at build time." })],
      cursor: null,
    }),
    [`${X_SERVICE}/post/1040`]: json({ post: post(40, { text: "Agreed, and a glyph cache is a texture atlas too." }), before: [first[2]], replies: [], cursor: null }),
  };
  return routes;
}
