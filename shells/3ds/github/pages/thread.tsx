// SPDX-License-Identifier: GPL-3.0-or-later
// applets/github/pages/thread.tsx — an issue or a pull request: its body and
// comments, and what can be done to it.
import { createMemo } from "solid-js";
import { ICONS, listPage, markdownRows } from "../../kit/app.tsx";
import type { Row, Rows } from "../../kit/rows.ts";
import type { LayerContext, PageSpec } from "../../ui/nav.tsx";
import { age, type J } from "../api.ts";
import { pageId, pagedRows, queryRows, stateIcon, write, type Env } from "../shared.ts";
import { fileRows } from "./repo.tsx";

function reactions(rows: Rows, item: J, key: string): Row[] {
  const faces: [string, string][] = [["+1", "+1"], ["-1", "-1"], ["laugh", "laugh"], ["hooray", "hooray"], ["confused", "confused"], ["heart", "heart"], ["rocket", "rocket"], ["eyes", "eyes"]];
  const shown = faces.filter(([name]) => (item.reactions?.[name] ?? 0) > 0).map(([name, label]) => ({ id: `${key}.${name}`, label: `${label} ${item.reactions[name]}`, tone: "stat" as const }));
  return shown.length ? rows.strip(shown, `${key}.reactions`) : [];
}

function commentRows(rows: Rows, comment: J, key: string): Row[] {
  return [
    rows.cell({ key, avatar: comment.user?.avatar_url ?? "", avatarSize: 24, title: comment.user?.login ?? "ghost", titleLines: 1, trailing: age(comment.created_at) }),
    ...markdownRows(rows, comment.body ?? "", `${key}.body`),
    ...reactions(rows, comment, key),
  ];
}

/** Say, and do nothing, when there is no account to write with. */
const signedIn = (env: Env) => {
  if (env.gh.signedIn()) return true;
  env.app.stack.push("signin");
  return false;
};

export function threadPage(env: Env, layer: LayerContext, kind: "issue" | "pr", full: string, number: string): PageSpec {
  const { app, gh } = env;
  const key = `${kind}.${full}.${number}`;
  const item = app.queries.query<J>(key, () => gh.get(`/repos/${full}/${kind === "pr" ? "pulls" : "issues"}/${number}`));
  const comments = app.queries.paged<J>(`${key}.comments`, (next) => gh.page(`/repos/${full}/issues/${number}/comments`, next));
  const sha = () => item.data()?.head?.sha as string | undefined;
  const checks = createMemo(() => {
    const head = sha();
    return kind === "pr" && head ? app.queries.query<J>(`checks.${full}.${head}`, () => gh.get(`/repos/${full}/commits/${head}/check-runs`)) : null;
  });
  const again = () => {
    item.reload();
    comments.reload();
    app.queries.invalidate(`issues.${full}`);
    app.queries.invalidate(`pulls.${full}`);
  };
  const comment = () => {
    if (!signedIn(env)) return;
    app.compose({ title: "Comment", placeholder: "Write a comment", action: "Comment", send: (body) => gh.send("POST", `/repos/${full}/issues/${number}/comments`, { body }).then(() => comments.reload()) });
  };
  const setState = (it: J) => {
    if (!signedIn(env)) return;
    const closing = it.state === "open";
    const noun = kind === "pr" ? "pull request" : "issue";
    app.confirm({
      title: closing ? `Close this ${noun}?` : `Reopen this ${noun}?`,
      message: `#${number} in ${full}.`,
      action: closing ? "Close" : "Reopen",
      danger: closing,
      run: () => write(env, gh.send("PATCH", `/repos/${full}/${kind === "pr" ? "pulls" : "issues"}/${number}`, { state: closing ? "closed" : "open" }), closing ? "Closed" : "Reopened", again),
    });
  };
  return listPage(app, layer, {
    title: () => `#${number}`,
    backLabel: `#${number}`,
    loading: item.loading,
    onEnd: comments.more,
    rows: (rows) => queryRows(rows, "thread", item, (it) => {
      const stateLabel = it.merged ? "Merged" : it.state === "closed" ? "Closed" : it.draft ? "Draft" : "Open";
      const out: Row[] = [
        rows.cell({
          key: "head",
          icon: stateIcon(it),
          eyebrow: `${full} #${number}`,
          title: it.title,
          big: true,
          titleLines: 6,
          detail: `${stateLabel}   ${it.user?.login ?? "ghost"} ${age(it.created_at)} ago`,
          pills: (it.labels ?? []).slice(0, 4).map((label: J) => ({ text: label.name, color: label.color })),
        }),
      ];
      if (kind === "pr") {
        out.push(rows.cell({ key: "branches", icon: ICONS.branch.muted, title: `${it.head?.label ?? ""}`, titleLines: 1, detail: `into ${it.base?.ref ?? ""}   +${it.additions ?? 0}  -${it.deletions ?? 0}   ${it.changed_files ?? 0} file${it.changed_files === 1 ? "" : "s"}` }));
        const runs: J[] = checks()?.data()?.check_runs ?? [];
        if (runs.length) {
          const bad = runs.filter((r) => r.conclusion && !["success", "skipped", "neutral"].includes(r.conclusion)).length;
          const live = runs.filter((r) => r.status !== "completed").length;
          out.push(rows.cell({ key: "checks", icon: bad ? ICONS["x-circle"].red : live ? ICONS["dot-run"].yellow : ICONS["check-circle"].green, title: bad ? `${bad} of ${runs.length} checks failed` : live ? `${live} of ${runs.length} checks running` : `${runs.length} checks passed`, run: () => app.stack.push(pageId("runs", full)) }));
        }
      }
      const actions = [
        { id: "act.comment", label: "Comment", icon: ICONS.comment.muted, tone: "button" as const, run: comment },
        ...(it.merged ? [] : [{ id: "act.state", label: it.state === "open" ? "Close" : "Reopen", tone: "button" as const, run: () => setState(it) }]),
        ...(kind === "pr" && it.state === "open" ? [{ id: "act.review", label: "Review", tone: "button" as const, run: () => signedIn(env) && app.stack.push(pageId("review", full, number)) }] : []),
        ...(kind === "pr" && it.state === "open" && !it.draft ? [{ id: "act.merge", label: "Merge", tone: "primary" as const, run: () => signedIn(env) && app.stack.push(pageId("merge", full, number)) }] : []),
      ];
      out.push(...rows.strip(actions, "actions"));
      if (kind === "pr") {
        out.push(rows.cell({ key: "files", icon: ICONS.file.muted, title: "Files Changed", trailing: String(it.changed_files ?? ""), run: () => app.stack.push(pageId("prfiles", full, number)) }));
        out.push(rows.cell({ key: "commits", icon: ICONS.commit.muted, title: "Commits", trailing: String(it.commits ?? ""), run: () => app.stack.push(pageId("prcommits", full, number)) }));
      }
      if (it.body) out.push(rows.section("Description"), ...markdownRows(rows, it.body, "body"));
      out.push(...reactions(rows, it, "head"));
      out.push(rows.section(`Comments${it.comments ? ` (${it.comments})` : ""}`, "comments"));
      if (!comments.items().length && !comments.loading()) out.push(...rows.text("No comments yet.", "small", "nocomments"));
      for (const c of comments.items()) out.push(...commentRows(rows, c, `c.${c.id}`));
      return out;
    }),
  });
}

export function prFilesPage(env: Env, layer: LayerContext, full: string, number: string): PageSpec {
  const { app, gh } = env;
  const list = app.queries.paged<J>(`prfiles.${full}.${number}`, (next) => gh.page(`/repos/${full}/pulls/${number}/files`, next));
  const scope = `pr.${full}.${number}`;
  return listPage(app, layer, {
    title: "Files Changed",
    backLabel: "Files",
    loading: list.loading,
    onEnd: list.more,
    rows: (rows) => (list.error() && !list.items().length ? pagedRows(rows, "prfiles", list, () => rows.space(0, ""), { title: "" }) : fileRows(env, rows, list.items(), scope)),
  });
}

export function prCommitsPage(env: Env, layer: LayerContext, full: string, number: string): PageSpec {
  const { app, gh } = env;
  const list = app.queries.paged<J>(`prcommits.${full}.${number}`, (next) => gh.page(`/repos/${full}/pulls/${number}/commits`, next));
  return listPage(app, layer, {
    title: "Commits",
    loading: list.loading,
    onEnd: list.more,
    rows: (rows) => pagedRows(rows, "prcommits", list, (c) => rows.cell({
      key: c.sha,
      avatar: c.author?.avatar_url ?? "",
      title: (c.commit.message as string).split("\n")[0]!,
      detail: `${c.author?.login ?? c.commit.author?.name ?? "unknown"}   ${c.sha.slice(0, 7)}`,
      trailing: age(c.commit.author?.date),
      run: () => app.stack.push(pageId("commit", full, c.sha)),
    }), { title: "No commits" }),
  });
}

export function reviewPage(env: Env, layer: LayerContext, full: string, number: string): PageSpec {
  const { app, gh } = env;
  const reviews = app.queries.query<J[]>(`reviews.${full}.${number}`, () => gh.get(`/repos/${full}/pulls/${number}/reviews`));
  const review = (event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", label: string, needsBody: boolean) => {
    const send = (body: string) => gh.send("POST", `/repos/${full}/pulls/${number}/reviews`, { event, body }).then(() => {
      reviews.reload();
      app.say(`${label} sent`);
    });
    if (needsBody) app.compose({ title: label, placeholder: "Say why", action: "Send", send });
    else app.confirm({ title: `${label} #${number}?`, message: `In ${full}.`, action: label, run: () => send("").catch((failure: Error) => app.say(failure.message, true)) });
  };
  return listPage(app, layer, {
    title: "Review",
    rows: (rows) => [
      rows.cell({ key: "approve", icon: ICONS["check-circle"].green, title: "Approve", run: () => review("APPROVE", "Approve", false) }),
      rows.cell({ key: "comment", icon: ICONS.comment.muted, title: "Comment", detail: "A review without approving", run: () => review("COMMENT", "Comment", true) }),
      rows.cell({ key: "changes", icon: ICONS["x-circle"].red, title: "Request Changes", run: () => review("REQUEST_CHANGES", "Request Changes", true) }),
      rows.section("Reviews so far"),
      ...queryRows(rows, "reviews", reviews, (list) => list.length
        ? list.map((r) => rows.cell({ key: `r.${r.id}`, avatar: r.user?.avatar_url ?? "", avatarSize: 24, title: r.user?.login ?? "ghost", titleLines: 1, detail: `${(r.state as string).toLowerCase().replace(/_/g, " ")}${r.body ? `: ${r.body}` : ""}`, trailing: age(r.submitted_at) }))
        : rows.text("No reviews yet.", "small", "none")),
    ],
  });
}

export function mergePage(env: Env, layer: LayerContext, full: string, number: string): PageSpec {
  const { app, gh } = env;
  const pr = app.queries.query<J>(`pr.${full}.${number}`, () => gh.get(`/repos/${full}/pulls/${number}`));
  const merge = (method: "merge" | "squash" | "rebase", label: string, it: J) => app.confirm({
    title: `${label}?`,
    message: `${it.head?.ref} into ${it.base?.ref} in ${full}.`,
    action: label,
    run: () => write(env, gh.send("PUT", `/repos/${full}/pulls/${number}/merge`, { merge_method: method }), "Merged", () => {
      app.queries.invalidate(`pr.${full}.${number}`);
      app.queries.invalidate(`pulls.${full}`);
      app.stack.pop();
    }),
  });
  return listPage(app, layer, {
    title: "Merge",
    loading: pr.loading,
    rows: (rows) => queryRows(rows, "merge", pr, (it) => {
      const blocked = it.mergeable === false || it.mergeable_state === "dirty";
      return [
        rows.cell({ key: "state", icon: blocked ? ICONS["x-circle"].red : ICONS["check-circle"].green, title: blocked ? "This branch has conflicts" : it.mergeable === null ? "GitHub is still checking this branch" : "Ready to merge", detail: `${it.head?.ref} into ${it.base?.ref}` }),
        ...(blocked ? [] : [
          rows.cell({ key: "merge", icon: ICONS["pr-merged"].purple, title: "Create a Merge Commit", detail: "Keeps every commit", run: () => merge("merge", "Merge", it) }),
          rows.cell({ key: "squash", icon: ICONS.commit.muted, title: "Squash and Merge", detail: "One commit on the base branch", run: () => merge("squash", "Squash and Merge", it) }),
          rows.cell({ key: "rebase", icon: ICONS.branch.muted, title: "Rebase and Merge", detail: "Replays the commits on the base branch", run: () => merge("rebase", "Rebase and Merge", it) }),
        ]),
      ];
    }),
  });
}
