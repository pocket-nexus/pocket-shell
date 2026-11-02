// SPDX-License-Identifier: GPL-3.0-or-later
// applets/kit/page.ts — what most pages need: page ids with parameters, rows for
// a query's loading, empty and failed states, a write that says how it went, and
// short forms of times and counts.
import type { App } from "./app.tsx";
import { now } from "./platform.tsx";
import type { Paged, Query } from "./query.ts";
import type { Row, Rows } from "./rows.ts";

/** A page id with parameters: `stack.push(pageId("user", login))`. Each part is encoded. */
export const pageId = (...parts: (string | number)[]) => parts.map((part) => encodeURIComponent(String(part))).join(":");
/** The parts of a page id: `const [kind, login] = pageParts(id)`. */
export const pageParts = (id: string) => id.split(":").map(decodeURIComponent);

export function failed(rows: Rows, key: string, error: string, retry: () => void): Row[] {
  return rows.message({ key, title: "Could not load this", detail: error, action: { label: "Try Again", run: retry } });
}

/** A paged list's rows with its loading, empty and failed states. */
export function pagedRows<T>(rows: Rows, key: string, list: Paged<T>, row: (item: T) => Row, empty: { title: string; detail?: string }): Row[] {
  if (list.error() && list.items().length === 0) return failed(rows, key, list.error(), list.reload);
  if (list.loading() && list.items().length === 0) return rows.text("Loading...", "small", `${key}.loading`);
  if (list.items().length === 0) return rows.message({ key, ...empty });
  const out = list.items().map(row);
  if (list.loadingMore()) out.push(...rows.text("Loading more...", "small", `${key}.more`));
  return out;
}

/** A query's rows once it has answered, its failure with a retry, and nothing
 *  until then: a page with no rows shows the spinner. */
export function queryRows<T>(rows: Rows, key: string, query: Query<T>, body: (value: T) => Row[]): Row[] {
  const value = query.data();
  if (value !== null) return body(value);
  if (query.error()) return failed(rows, key, query.error(), query.reload);
  return [];
}

/** Run a write; say what happened. */
export function write(app: App, job: Promise<unknown>, done: string, then?: () => void): void {
  job.then(
    () => {
      app.say(done);
      then?.();
    },
    (failure: unknown) => app.say(failure instanceof Error ? failure.message : String(failure), true),
  );
}

/** How long ago, in one short word: "now", "5m", "3h", "2d", "4mo", "1y". */
export function age(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((now() - Date.parse(iso)) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

/** 1200 as "1.2k". */
export const count = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n));
/** "1 star", "2 stars". */
export const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;
