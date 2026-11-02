// SPDX-License-Identifier: GPL-3.0-or-later
// applets/github/shared.ts — what the pages have in common: the app's parts, page
// ids, rows for an issue, a repository, a user, and failure and empty states.
import type { App } from "../kit/app.tsx";
import { ICONS } from "../kit/app.tsx";
import { age, count, pageId, write as writeWith } from "../kit/page.ts";
import type { Row } from "../kit/rows.ts";
import type { GitHub, J } from "./api.ts";

export { failed, pagedRows, pageId, pageParts, queryRows } from "../kit/page.ts";

export interface Env {
  app: App;
  gh: GitHub;
}

/** An issue's or a pull request's state as its icon. */
export function stateIcon(item: J) {
  const pull = item.pull_request !== undefined || item.merged !== undefined || item.head !== undefined;
  if (!pull) return item.state === "closed" ? (item.state_reason === "not_planned" ? ICONS["issue-skip"].muted : ICONS["issue-closed"].purple) : ICONS["issue-open"].green;
  if (item.merged_at || item.merged || item.pull_request?.merged_at) return ICONS["pr-merged"].purple;
  if (item.state === "closed") return ICONS["pr-closed"].red;
  return item.draft ? ICONS["pr-draft"].muted : ICONS["pr-open"].green;
}

export const repoOfUrl = (url: string) => /repos\/([^/]+\/[^/]+)/.exec(url)?.[1] ?? "";

/** An issue or a pull request in a list. */
export function issueCell(env: Env, item: J, key: string, showRepo = true): Row {
  const repo = repoOfUrl(item.repository_url ?? item.url ?? "");
  const pull = item.pull_request !== undefined || item.head !== undefined;
  return env.app.rows.cell({
    key,
    icon: stateIcon(item),
    eyebrow: showRepo ? `${repo} #${item.number}` : `#${item.number} by ${item.user?.login ?? "ghost"}`,
    title: item.title,
    trailing: age(item.updated_at),
    pills: (item.labels ?? []).slice(0, 4).map((label: J) => ({ text: label.name, color: label.color })),
    detail: item.comments ? `${item.comments} comment${item.comments === 1 ? "" : "s"}` : undefined,
    run: () => env.app.stack.push(pageId(pull ? "pr" : "issue", repo, item.number)),
  });
}

/** A repository in a list. */
export function repoCell(env: Env, repo: J, key: string): Row {
  const facts = [repo.language, `${count(repo.stargazers_count ?? 0)} star${repo.stargazers_count === 1 ? "" : "s"}`, repo.private ? "private" : repo.fork ? "fork" : ""].filter(Boolean).join("   ");
  return env.app.rows.cell({
    key,
    icon: repo.private ? ICONS.lock.muted : ICONS.repo.muted,
    title: repo.full_name,
    titleLines: 1,
    detail: repo.description ? `${repo.description}\n${facts}` : facts,
    detailLines: 3,
    trailing: age(repo.pushed_at ?? repo.updated_at),
    run: () => env.app.stack.push(pageId("repo", repo.full_name)),
  });
}

export function userCell(env: Env, user: J, key: string): Row {
  return env.app.rows.cell({
    key,
    avatar: user.avatar_url,
    title: user.login,
    detail: user.contributions ? `${count(user.contributions)} contributions` : undefined,
    run: () => env.app.stack.push(pageId("user", user.login)),
  });
}

/** Run a write; say what happened. */
export const write = (env: Env, job: Promise<unknown>, done: string, then?: () => void) => writeWith(env.app, job, done, then);
