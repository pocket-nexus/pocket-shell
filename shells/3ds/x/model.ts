// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/x/model.ts — the X timelines, the threads the reader opened and
// the avatars on screen, as signals over the API client, and the reader's
// likes, reposts and replies.
//
// A timeline loads PAGE posts at a time from the Mac, each page after the
// cursor of the last. A thread is the post, the posts it answers and its
// replies. An avatar is a texture registered under its own key once its IMG
// entry arrives; at most AVATARS stay uploaded, the least recently shown
// freed first, and a row draws its initials until its face is in.
//
// A like or a repost shows at once: the model keeps the post's new state and
// count as an override over what X sent, asks the Mac, and takes it back if
// X refuses (with a notice).

import { createSignal, type Accessor } from "solid-js";
import { after } from "@pocketjs/framework/clock";
import { getOps } from "@pocketjs/framework/host";
import { registerTexture } from "@pocketjs/framework/renderer";
import { createXClient, errorText, type Action, type Kind, type Post, type XClient } from "./api.ts";

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
  /** `post` with the reader's likes, reposts and replies applied. */
  view(post: Post): Post;
  /** Bumped when an override changes. */
  marks: Accessor<number>;
  toggle(post: Post, what: "like" | "repost"): void;
  /** Reply to `post`; resolves to an error message, or "" when sent. */
  reply(post: Post, text: string): Promise<string>;
  /** A short message for the reader (an action X refused), "" when none. */
  notice: Accessor<string>;
}

interface Mark {
  liked: boolean;
  likes: number;
  reposted: boolean;
  reposts: number;
  replies: number;
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

  // -- the reader's actions --------------------------------------------------------
  const [marks, setMarks] = createSignal(0);
  const [notice, setNotice] = createSignal("");
  const overrides = new Map<string, Mark>();
  const views = new Map<string, { post: Post; mark: Mark; view: Post }>();
  const markOf = (post: Post): Mark =>
    overrides.get(post.id) ?? { liked: !!post.liked, likes: post.likes, reposted: !!post.reposted, reposts: post.reposts, replies: post.replies };
  const setMark = (id: string, mark: Mark) => {
    overrides.set(id, mark);
    setMarks(marks() + 1);
  };
  let noticeRun = 0;
  const say = (text: string) => {
    const run = ++noticeRun;
    setNotice(text);
    after(3, () => run === noticeRun && setNotice(""));
  };
  const view = (post: Post): Post => {
    const mark = overrides.get(post.id);
    if (!mark) return post;
    const cached = views.get(post.id);
    if (cached && cached.post === post && cached.mark === mark) return cached.view;
    const next = { ...post, ...mark };
    if (views.size > 400) views.clear();
    views.set(post.id, { post, mark, view: next });
    return next;
  };
  const toggle = (post: Post, what: "like" | "repost") => {
    const before = markOf(post);
    const on = what === "like" ? !before.liked : !before.reposted;
    const after: Mark =
      what === "like"
        ? { ...before, liked: on, likes: Math.max(0, before.likes + (on ? 1 : -1)) }
        : { ...before, reposted: on, reposts: Math.max(0, before.reposts + (on ? 1 : -1)) };
    setMark(post.id, after);
    const action: Action = what === "like" ? (on ? "like" : "unlike") : on ? "repost" : "unrepost";
    client.act(action, post.id).catch((error: unknown) => {
      // Put back what the post showed, unless the reader changed it again.
      if (overrides.get(post.id) === after) setMark(post.id, before);
      say(`Could not ${action}: ${errorText(error).detail}`);
    });
  };
  const reply = (post: Post, text: string): Promise<string> =>
    client.reply(post.id, text).then(
      () => {
        const mark = markOf(post);
        setMark(post.id, { ...mark, replies: mark.replies + 1 });
        say("Reply sent");
        return "";
      },
      (error: unknown) => errorText(error).detail,
    );

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
    view,
    marks,
    toggle,
    reply,
    notice,
  };
}
