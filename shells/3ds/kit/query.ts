// SPDX-License-Identifier: GPL-3.0-or-later
// applets/kit/query.ts — data for a page: loading, its error and a reload, kept
// by key so it survives leaving the page and a remount (a window resize).
import { createSignal, type Accessor } from "solid-js";

export interface Query<T> {
  data: Accessor<T | null>;
  error: Accessor<string>;
  loading: Accessor<boolean>;
  reload(): void;
}

export interface Paged<T> {
  items: Accessor<T[]>;
  error: Accessor<string>;
  /** The first page is on its way. */
  loading: Accessor<boolean>;
  /** A later page is on its way. */
  loadingMore: Accessor<boolean>;
  /** There are more: call `more()` as the reader nears the end. */
  hasMore: Accessor<boolean>;
  more(): void;
  reload(): void;
}

const message = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

export interface Queries {
  query<T>(key: string, load: () => Promise<T>): Query<T>;
  paged<T>(key: string, load: (next: string | null) => Promise<{ items: T[]; next: string | null }>): Paged<T>;
  /** Forget what `key` starts with, reloading those still on screen. */
  invalidate(prefix: string): void;
}

/** Answers kept for going back to, oldest forgotten first. A page still open
 *  holds its own; one forgotten loads again when it is next asked for. */
export function createQueries(keep = 64): Queries {
  const queries = new Map<string, { reload(): void }>();
  const remember = (key: string, query: { reload(): void }) => {
    queries.set(key, query);
    if (queries.size > keep) queries.delete(queries.keys().next().value as string);
  };
  return {
    query<T>(key: string, load: () => Promise<T>): Query<T> {
      const known = queries.get(key) as Query<T> | undefined;
      if (known) return known;
      const [data, setData] = createSignal<T | null>(null);
      const [error, setError] = createSignal("");
      const [loading, setLoading] = createSignal(true);
      const reload = () => {
        setLoading(true);
        setError("");
        load().then(
          (value) => {
            setData(() => value);
            setLoading(false);
          },
          (failure: unknown) => {
            setError(message(failure));
            setLoading(false);
          },
        );
      };
      const made: Query<T> = { data, error, loading, reload };
      remember(key, made);
      reload();
      return made;
    },
    paged<T>(key: string, load: (next: string | null) => Promise<{ items: T[]; next: string | null }>): Paged<T> {
      const known = queries.get(key) as Paged<T> | undefined;
      if (known) return known;
      const [items, setItems] = createSignal<T[]>([]);
      const [error, setError] = createSignal("");
      const [loading, setLoading] = createSignal(true);
      const [loadingMore, setLoadingMore] = createSignal(false);
      const [next, setNext] = createSignal<string | null>(null);
      let run = 0;
      const reload = () => {
        const mine = ++run;
        setLoading(true);
        setError("");
        load(null).then(
          (page) => {
            if (mine !== run) return;
            setItems(page.items);
            setNext(page.next);
            setLoading(false);
          },
          (failure: unknown) => {
            if (mine !== run) return;
            setError(message(failure));
            setLoading(false);
          },
        );
      };
      const made: Paged<T> = {
        items,
        error,
        loading,
        loadingMore,
        hasMore: () => next() !== null,
        more() {
          const after = next();
          if (!after || loadingMore() || loading()) return;
          const mine = run;
          setLoadingMore(true);
          load(after).then(
            (page) => {
              setLoadingMore(false);
              if (mine !== run) return;
              setItems([...items(), ...page.items]);
              setNext(page.next);
            },
            (failure: unknown) => {
              setLoadingMore(false);
              setNext(null);
              setError(message(failure));
            },
          );
        },
        reload,
      };
      remember(key, made);
      reload();
      return made;
    },
    invalidate(prefix) {
      for (const [key, value] of queries) if (key.startsWith(prefix)) value.reload();
    },
  };
}
