// SPDX-License-Identifier: GPL-3.0-or-later
// ui/keep.ts — values that outlive a remount. The host sizes an
// applet's surface again when its window's tile changes (fullscreen, a
// second window beside it), and ui/window.tsx mounts the applet again for the
// new size: every signal in its components starts over. The realm stays, so a
// model, a client and a navigation record kept here are the same objects
// after the remount, and the timeline, the open thread and the scroll
// position carry over. Keys are per realm, so a short name is enough.
const kept = new Map<string, unknown>();

/** The value `create` made the first time this realm asked for `key`. */
export function keep<T>(key: string, create: () => T): T {
  if (!kept.has(key)) kept.set(key, create());
  return kept.get(key) as T;
}
