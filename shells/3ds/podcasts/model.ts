// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/podcasts/model.ts — what the Podcasts applet shows: the tab
// (Library or Search), the library from the companion's store, the search
// words and their results, and the show that is open with its episodes.
//
// The library is one document in the store service (`podcasts`): the
// subscriptions and where each episode stopped. It is read once when the
// model is made and written after every change, once the read has settled,
// so a change made while the read is in flight never writes an empty
// library over the saved one: the read's answer is merged under what is in
// memory, then the write goes out.

import { createSignal, type Accessor } from "solid-js";
import { PodcastError, POSITIONS_KEPT, type Episode, type Feed, type Library, type PodcastClient, type Show } from "./api.ts";
import { notLinked, theComputer } from "../ui/companion.ts";

export type Tab = "library" | "search";

export interface ListState {
  status: "idle" | "loading" | "ready" | "error";
  items: readonly Show[];
  error: { title: string; detail: string } | null;
}

export interface ShowState {
  status: "loading" | "ready" | "error";
  feed: Feed | null;
  error: { title: string; detail: string } | null;
}

export interface PodcastModel {
  tab: Accessor<Tab>;
  setTab(tab: Tab): void;
  library: Accessor<Library>;
  libraryStatus: Accessor<"loading" | "ready" | "error">;
  libraryError: Accessor<{ title: string; detail: string } | null>;
  loadLibrary(): void;
  subscribed(feedUrl: string): boolean;
  toggleSubscription(show: Show): void;
  /** Where the episode stopped last, in seconds; 0 when never played. */
  position(audioUrl: string): number;
  savePosition(audioUrl: string, seconds: number): void;
  query: Accessor<string>;
  setQuery(query: string): void;
  /** Open the keyboard for the search words (set by the app). */
  editQuery(): void;
  search: Accessor<ListState>;
  reloadSearch(): void;
  /** The show whose page is open. */
  show: Accessor<Show | null>;
  showState: Accessor<ShowState>;
  openShow(show: Show): void;
  reloadShow(): void;
}

const IDLE: ListState = { status: "idle", items: [], error: null };
const LOADING: ListState = { status: "loading", items: [], error: null };
const EMPTY_LIBRARY: Library = { subscriptions: [], positions: {} };

/** The message a reader sees for a failed request. */
export function errorText(error: unknown): { title: string; detail: string } {
  const code = error instanceof PodcastError ? error.code : "";
  if (code === "unavailable") return notLinked("Podcasts");
  if (code === "timeout") return { title: "The request timed out", detail: `${theComputer()} or the podcast's server did not answer in time.` };
  const message = error instanceof Error ? error.message : String(error);
  return { title: "Could not load", detail: message || "The request failed." };
}

/** `show` in the list once, by feed URL. */
const without = (list: readonly Show[], feedUrl: string) => list.filter((show) => show.feedUrl !== feedUrl);

export function createPodcastModel(client: PodcastClient, options: { editQuery: () => void }): PodcastModel {
  const [tab, setTabSignal] = createSignal<Tab>("library");
  const [library, setLibrary] = createSignal<Library>(EMPTY_LIBRARY);
  const [libraryStatus, setLibraryStatus] = createSignal<"loading" | "ready" | "error">("loading");
  const [libraryError, setLibraryError] = createSignal<{ title: string; detail: string } | null>(null);
  const [query, setQuerySignal] = createSignal("");
  const [search, setSearch] = createSignal<ListState>(IDLE);
  const [show, setShow] = createSignal<Show | null>(null);
  const [showState, setShowState] = createSignal<ShowState>({ status: "loading", feed: null, error: null });
  const feeds = new Map<string, Feed>();
  let searchGeneration = 0;
  let showGeneration = 0;
  let loadGeneration = 0;
  /** Settles when the first read of the library has answered or failed. */
  let settled: Promise<void> = Promise.resolve();
  let saving: Promise<void> = Promise.resolve();

  const save = () => {
    // One write after another, each with the library as it is then.
    saving = saving.then(() => settled).then(() => client.save(library())).catch(() => undefined);
  };

  const loadLibrary = () => {
    const generation = ++loadGeneration;
    setLibraryStatus("loading");
    setLibraryError(null);
    settled = client.library().then(
      (loaded) => {
        if (generation !== loadGeneration) return;
        // What was changed meanwhile stays on top of what was saved.
        const current = library();
        const subscriptions = [...(loaded?.subscriptions ?? []).filter((saved) => !current.subscriptions.some((show) => show.feedUrl === saved.feedUrl)), ...current.subscriptions];
        setLibrary({ subscriptions, positions: { ...(loaded?.positions ?? {}), ...current.positions } });
        setLibraryStatus("ready");
      },
      (error: unknown) => {
        if (generation !== loadGeneration) return;
        setLibraryStatus("error");
        setLibraryError(errorText(error));
      },
    );
  };

  const runSearch = () => {
    const generation = ++searchGeneration;
    const words = query().trim();
    if (!words) return setSearch(IDLE);
    setSearch(LOADING);
    client.search(words).then(
      (items) => {
        if (generation === searchGeneration) setSearch({ status: "ready", items, error: null });
      },
      (error: unknown) => {
        if (generation === searchGeneration) setSearch({ status: "error", items: [], error: errorText(error) });
      },
    );
  };

  const loadShow = (opened: Show, fresh: boolean) => {
    const generation = ++showGeneration;
    const cached = fresh ? undefined : feeds.get(opened.feedUrl);
    if (cached) return setShowState({ status: "ready", feed: cached, error: null });
    setShowState({ status: "loading", feed: null, error: null });
    client.episodes(opened.feedUrl).then(
      (feed) => {
        if (feeds.size > 20) feeds.clear();
        feeds.set(opened.feedUrl, feed);
        if (generation === showGeneration) setShowState({ status: "ready", feed, error: null });
      },
      (error: unknown) => {
        if (generation === showGeneration) setShowState({ status: "error", feed: null, error: errorText(error) });
      },
    );
  };

  loadLibrary();

  return {
    tab,
    setTab(next) {
      setTabSignal(next);
      if (next === "search" && !query()) options.editQuery();
    },
    library,
    libraryStatus,
    libraryError,
    loadLibrary,
    subscribed: (feedUrl) => library().subscriptions.some((show) => show.feedUrl === feedUrl),
    toggleSubscription(subject) {
      const current = library();
      const kept = without(current.subscriptions, subject.feedUrl);
      // The feed's own title and picture when its page has been read.
      const feed = feeds.get(subject.feedUrl);
      const entry: Show = { ...subject, title: feed?.title || subject.title, author: feed?.author || subject.author, artwork: feed?.artwork || subject.artwork };
      setLibrary({ ...current, subscriptions: kept.length === current.subscriptions.length ? [...kept, entry] : kept });
      save();
    },
    position: (audioUrl) => library().positions[audioUrl] ?? 0,
    savePosition(audioUrl, seconds) {
      const current = library();
      const positions: Record<string, number> = { ...current.positions };
      delete positions[audioUrl];
      if (seconds > 0) positions[audioUrl] = Math.floor(seconds);
      const keys = Object.keys(positions);
      for (const key of keys.slice(0, Math.max(0, keys.length - POSITIONS_KEPT))) delete positions[key];
      setLibrary({ ...current, positions });
      save();
    },
    query,
    setQuery(next) {
      setQuerySignal(next);
      runSearch();
    },
    editQuery: () => options.editQuery(),
    search,
    reloadSearch: runSearch,
    show,
    showState,
    openShow(opened) {
      setShow(opened);
      loadShow(opened, false);
    },
    reloadShow() {
      const opened = show();
      if (opened) loadShow(opened, true);
    },
  };
}

/** The episode's show as the player names it. */
export interface Playing {
  show: Show;
  episode: Episode;
}
