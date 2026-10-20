// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/x/model.ts — the X timelines, the threads the reader opened and
// the avatars on screen, as signals over the API client.
//
// A timeline loads PAGE posts at a time from the Mac, each page after the
// cursor of the last. A thread is the post, the posts it answers and its
// replies. An avatar is a texture registered under its own key once its IMG
// entry arrives; at most AVATARS stay uploaded, the least recently shown
// freed first, and a row draws its initials until its face is in.

import { createSignal, type Accessor } from "solid-js";
import { getOps } from "@pocketjs/framework/host";
import { registerTexture } from "@pocketjs/framework/renderer";
import { createXClient, errorText, type Kind, type Post, type XClient } from "./api.ts";

const AVATARS = 64;

export interface TimelineState {
  status: "loading" | "ready" | "error";
  posts: Post[];
  cursor: string | null;
  /** A next page is on its way. */
  more: boolean;
  error: { title: string; detail: string } | null;
}

export interface ThreadState {
  id: string;
  status: "loading" | "ready" | "error";
  post: Post | null;
  before: Post[];
  replies: Post[];
  cursor: string | null;
  more: boolean;
  error: { title: string; detail: string } | null;
}

export interface XModel {
  client: XClient;
  kind: Accessor<Kind>;
  setKind(kind: Kind): void;
  state: Accessor<TimelineState>;
  reload(): void;
  more(): void;
  /** Threads by post id, kept while their pages are on the stack. */
  thread(id: string): ThreadState | undefined;
  /** Bumped when a thread changes. */
  threads: Accessor<number>;
  openThread(id: string): void;
  moreReplies(id: string): void;
  /** The texture key of `url`'s avatar, or "" until it is uploaded; asks for it. */
  avatar(url: string | undefined): string;
  /** Bumped when an avatar arrives. */
  avatars: Accessor<number>;
}

const EMPTY: TimelineState = { status: "loading", posts: [], cursor: null, more: false, error: null };

export function createXModel(client: XClient = createXClient()): XModel {
  const [kind, setKindSignal] = createSignal<Kind>("following");
  const [states, setStates] = createSignal<Partial<Record<Kind, TimelineState>>>({});
  const [threads, setThreads] = createSignal(0);
  const [avatars, setAvatars] = createSignal(0);
  const threadMap = new Map<string, ThreadState>();
  const generation: Partial<Record<Kind, number>> = {};
  const put = (which: Kind, state: TimelineState) => setStates({ ...states(), [which]: state });

  const load = (which: Kind) => {
    const run = (generation[which] = (generation[which] ?? 0) + 1);
    put(which, { ...EMPTY });
    client.timeline(which).then(
      (page) => {
        if (generation[which] !== run) return;
        put(which, { status: "ready", posts: page.posts ?? [], cursor: page.cursor ?? null, more: false, error: null });
      },
      (error: unknown) => {
        if (generation[which] !== run) return;
        put(which, { ...EMPTY, status: "error", error: errorText(error) });
      },
    );
  };

  const more = () => {
    const which = kind();
    const state = states()[which];
    if (!state || state.status !== "ready" || state.more || !state.cursor) return;
    const run = generation[which];
    put(which, { ...state, more: true });
    client.timeline(which, state.cursor).then(
      (page) => {
        const now = states()[which];
        if (generation[which] !== run || !now) return;
        const have = new Set(now.posts.map((post) => post.id));
        const fresh = (page.posts ?? []).filter((post) => !have.has(post.id));
        // A page with nothing new ends the list.
        put(which, { ...now, posts: [...now.posts, ...fresh], cursor: fresh.length > 0 ? (page.cursor ?? null) : null, more: false });
      },
      () => {
        const now = states()[which];
        if (generation[which] === run && now) put(which, { ...now, more: false, cursor: null });
      },
    );
  };

  const putThread = (state: ThreadState) => {
    threadMap.set(state.id, state);
    setThreads(threads() + 1);
  };

  const openThread = (id: string) => {
    putThread({ id, status: "loading", post: null, before: [], replies: [], cursor: null, more: false, error: null });
    client.thread(id).then(
      (thread) => putThread({ id, status: "ready", post: thread.post, before: thread.before ?? [], replies: thread.replies ?? [], cursor: thread.cursor ?? null, more: false, error: null }),
      (error: unknown) => putThread({ id, status: "error", post: null, before: [], replies: [], cursor: null, more: false, error: errorText(error) }),
    );
  };

  const moreReplies = (id: string) => {
    const state = threadMap.get(id);
    if (!state || state.status !== "ready" || state.more || !state.cursor) return;
    putThread({ ...state, more: true });
    client.thread(id, state.cursor).then(
      (page) => {
        const now = threadMap.get(id)!;
        const have = new Set(now.replies.map((post) => post.id));
        const fresh = (page.replies ?? []).filter((post) => !have.has(post.id) && post.id !== id);
        putThread({ ...now, replies: [...now.replies, ...fresh], cursor: fresh.length > 0 ? (page.cursor ?? null) : null, more: false });
      },
      () => putThread({ ...threadMap.get(id)!, more: false, cursor: null }),
    );
  };

  // -- avatars ------------------------------------------------------------------
  const faces = new Map<string, { key: string; handle: number; shown: number }>();
  const asked = new Set<string>();
  let nextFace = 0;
  let clock = 0;
  const avatar = (url: string | undefined): string => {
    if (!url) return "";
    const face = faces.get(url);
    if (face) {
      face.shown = ++clock;
      return face.key;
    }
    if (!asked.has(url)) {
      asked.add(url);
      client.avatar(url).then(
        (bytes) => {
          const ops = getOps();
          const handle = ops.uploadImgEntry ? ops.uploadImgEntry(bytes) : -1;
          if (handle < 0) return;
          if (faces.size >= AVATARS) {
            let oldest: [string, { handle: number; shown: number }] | null = null;
            for (const entry of faces) if (!oldest || entry[1].shown < oldest[1].shown) oldest = entry;
            if (oldest) {
              faces.delete(oldest[0]);
              asked.delete(oldest[0]);
              ops.freeTexture?.(oldest[1].handle);
            }
          }
          const key = `x.face.${nextFace++}`;
          registerTexture(key, handle);
          faces.set(url, { key, handle, shown: ++clock });
          setAvatars(avatars() + 1);
        },
        () => undefined,
      );
    }
    return "";
  };

  return {
    client,
    kind,
    setKind(next) {
      setKindSignal(next);
      const state = states()[next];
      if (!state || state.status === "error") load(next);
    },
    state: () => states()[kind()] ?? EMPTY,
    reload: () => load(kind()),
    more,
    thread: (id) => threads() >= 0 ? threadMap.get(id) : undefined,
    threads,
    openThread,
    moreReplies,
    avatar,
    avatars,
  };
}
