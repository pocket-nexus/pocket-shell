// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/youtube/model.ts — what the YouTube app shows: the section (a
// topic or Search), each section's list, the search words and the video
// that is open. A section keeps its list while another is shown; Y reloads.

import { createSignal, type Accessor } from "solid-js";
import { YtError, type Topic, type Video, type YtClient } from "./api.ts";
import { notLinked, theComputer } from "../ui/companion.ts";

export type Section = Topic | "search";

export interface ListState {
  status: "idle" | "loading" | "ready" | "error";
  items: readonly Video[];
  error: { title: string; detail: string } | null;
}

export interface YtModel {
  section: Accessor<string>;
  setSection(section: string): void;
  state: Accessor<ListState>;
  reload(): void;
  query: Accessor<string>;
  setQuery(query: string): void;
  /** Open the keyboard for the search words (set by the app). */
  editQuery(): void;
  current: Accessor<Video | null>;
  open(video: Video): void;
}

const IDLE: ListState = { status: "idle", items: [], error: null };
const LOADING: ListState = { status: "loading", items: [], error: null };

/** The message a viewer sees for a failed request. */
export function errorText(error: unknown): { title: string; detail: string } {
  const code = error instanceof YtError ? error.code : "";
  if (code === "unavailable") {
    return notLinked("YouTube");
  }
  if (code === "timeout") return { title: "The request timed out", detail: `${theComputer()} or YouTube did not answer in time.` };
  const message = error instanceof Error ? error.message : String(error);
  return { title: "Could not load", detail: message || "The request failed." };
}

export function createYtModel(client: YtClient, options: { editQuery: () => void }): YtModel {
  const [section, setSectionSignal] = createSignal<string>("tech");
  const [query, setQuerySignal] = createSignal("");
  const [current, setCurrent] = createSignal<Video | null>(null);
  const [states, setStates] = createSignal<ReadonlyMap<string, ListState>>(new Map());
  const generations = new Map<string, number>();

  const put = (key: string, state: ListState) => {
    const next = new Map(states());
    next.set(key, state);
    setStates(next);
  };

  const load = (key: string) => {
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    if (key === "search" && !query().trim()) return put(key, IDLE);
    put(key, LOADING);
    const request = key === "search" ? client.search(query().trim()) : client.feed(key as Topic);
    request.then(
      (items) => {
        if (generations.get(key) === generation) put(key, { status: "ready", items, error: null });
      },
      (error) => {
        if (generations.get(key) === generation) put(key, { status: "error", items: [], error: errorText(error) });
      },
    );
  };

  return {
    section,
    setSection(next) {
      setSectionSignal(next);
      if (!states().has(next)) load(next);
      if (next === "search" && !query()) options.editQuery();
    },
    state: () => states().get(section()) ?? (section() === "search" ? IDLE : LOADING),
    reload: () => load(section()),
    query,
    setQuery(next) {
      setQuerySignal(next);
      load("search");
    },
    editQuery: () => options.editQuery(),
    current,
    open: setCurrent,
  };
}
