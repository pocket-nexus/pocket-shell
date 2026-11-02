// SPDX-License-Identifier: GPL-3.0-or-later
// applets/github/pages/repo.tsx — a repository and everything under it: its code,
// commits, issues and pull requests, releases, actions, branches and people.
import { createMemo, createSignal } from "solid-js";
import { after } from "@pocketjs/framework/clock";
import { ICONS, linesPage, listPage, markdownRows, type SourceLine } from "../../kit/app.tsx";
import type { Paged } from "../../kit/query.ts";
import type { LayerContext, PageSpec } from "../../ui/nav.tsx";
import { keep } from "../../ui/keep.ts";
import { age, bytes, count, type J } from "../api.ts";
import { issueCell, pageId, pagedRows, queryRows, userCell, write, type Env } from "../shared.ts";

/** Biggest file the viewer opens: more would not be read on this screen. */
const FILE_MAX = 256 * 1024;

export function repoPage(env: Env, layer: LayerContext, full: string): PageSpec {
  const { app, gh } = env;
  const repo = app.queries.query<J>(`repo.${full}`, () => gh.get(`/repos/${full}`));
  const readme = app.queries.query<string>(`readme.${full}`, () => gh.raw(`/repos/${full}/readme`).catch(() => ""));
  const starred = app.queries.query<boolean>(`starred.${full}`, () => (gh.signedIn() ? gh.check(`/user/starred/${full}`) : Promise.resolve(false)));
  const push = (...parts: (string | number)[]) => app.stack.push(pageId(...parts));
  return listPage(app, layer, {
    title: () => full.split("/")[1] ?? full,
    backLabel: full.split("/")[1],
    loading: repo.loading,
    rows: (rows) => queryRows(rows, "repo", repo, (r) => {
      const toggle = () => {
        if (!gh.signedIn()) return app.stack.push("signin");
        const on = starred.data() === true;
        write(env, gh.send(on ? "DELETE" : "PUT", `/user/starred/${full}`), on ? "Unstarred" : "Starred", () => {
          starred.reload();
          repo.reload();
        });
      };
      return [
        rows.cell({ key: "head", avatar: r.owner?.avatar_url ?? "", avatarSize: 40, eyebrow: r.owner?.login, title: r.name, big: true, detail: r.description || undefined, detailLines: 4, run: () => push("user", r.owner.login), chevron: false }),
        ...rows.strip([
          { id: "stat.stars", label: `${count(r.stargazers_count)} star${r.stargazers_count === 1 ? "" : "s"}`, icon: ICONS.star.muted, tone: "stat" },
          { id: "stat.forks", label: `${count(r.forks_count)} fork${r.forks_count === 1 ? "" : "s"}`, icon: ICONS.fork.muted, tone: "stat" },
          ...(r.language ? [{ id: "stat.lang", label: r.language, icon: ICONS.code.muted, tone: "stat" as const }] : []),
          ...(r.private ? [{ id: "stat.private", label: "Private", icon: ICONS.lock.muted, tone: "stat" as const }] : []),
        ], "stats"),
        ...rows.strip([
          { id: "act.star", label: starred.data() ? "Starred" : "Star", icon: starred.data() ? ICONS["star-fill"].yellow : ICONS.star.text, tone: "button", run: toggle },
          { id: "act.newissue", label: "New Issue", icon: ICONS.plus.text, tone: "button", run: () => app.compose({ title: "New Issue", placeholder: "Title", action: "Next", singleLine: true, send: async (title) => {
            // once this sheet has closed, the next asks for the body
            after(0.05, () => app.compose({ title, placeholder: "Describe it", action: "Create", send: (body) => gh.send("POST", `/repos/${full}/issues`, { title, body }).then((made: J) => {
              app.queries.invalidate(`issues.${full}`);
              push("issue", full, made.number);
            }) }));
          } }) },
        ], "actions"),
        rows.section("Browse"),
        rows.cell({ key: "code", icon: ICONS.code.muted, title: "Code", trailing: r.default_branch, run: () => push("tree", full, r.default_branch, "") }),
        rows.cell({ key: "commits", icon: ICONS.commit.muted, title: "Commits", run: () => push("commits", full, r.default_branch) }),
        rows.cell({ key: "issues", icon: ICONS["issue-open"].muted, title: "Issues", trailing: r.open_issues_count ? count(r.open_issues_count) : "", run: () => push("issues", full) }),
        rows.cell({ key: "pulls", icon: ICONS["pr-open"].muted, title: "Pull Requests", run: () => push("pulls", full) }),
        rows.cell({ key: "actions", icon: ICONS.play.muted, title: "Actions", run: () => push("runs", full) }),
        rows.cell({ key: "releases", icon: ICONS.tag.muted, title: "Releases", run: () => push("releases", full) }),
        rows.cell({ key: "branches", icon: ICONS.branch.muted, title: "Branches and Tags", run: () => push("refs", full) }),
        rows.cell({ key: "people", icon: ICONS.person.muted, title: "Contributors", run: () => push("people", full) }),
        ...(readme.data() ? [rows.section("README"), ...markdownRows(rows, readme.data()!, "readme")] : []),
      ];
    }),
  });
}

export function treePage(env: Env, layer: LayerContext, full: string, ref: string, path: string): PageSpec {
  const { app, gh } = env;
  const list = app.queries.query<J[]>(`tree.${full}.${ref}.${path}`, () => gh.get(`/repos/${full}/contents/${path}?ref=${encodeURIComponent(ref)}`));
  return listPage(app, layer, {
    title: () => (path ? path.split("/").pop()! : ref),
    backLabel: path ? path.split("/").pop() : ref,
    loading: list.loading,
    rows: (rows) => queryRows(rows, "tree", list, (entries) => {
      const sorted = [...entries].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      return sorted.map((entry) => rows.cell({
        key: entry.path,
        icon: entry.type === "dir" ? ICONS.folder.accent : ICONS.file.muted,
        title: entry.name,
        titleLines: 1,
        trailing: entry.type === "file" ? bytes(entry.size) : "",
        run: () => {
          if (entry.type === "dir") app.stack.push(pageId("tree", full, ref, entry.path));
          else if (entry.size > FILE_MAX) app.say(`${entry.name} is ${bytes(entry.size)}: too big to open here`, true);
          else app.stack.push(pageId("file", full, ref, entry.path));
        },
      }));
    }),
  });
}

export function filePage(env: Env, layer: LayerContext, full: string, ref: string, path: string): PageSpec {
  const { app, gh } = env;
  const file = app.queries.query<string>(`file.${full}.${ref}.${path}`, () => gh.raw(`/repos/${full}/contents/${path}?ref=${encodeURIComponent(ref)}`));
  const lines = createMemo<SourceLine[]>(() => {
    const text = file.data();
    if (file.error()) return [{ gutter: "", text: file.error(), tone: "del" }];
    if (text === null) return [{ gutter: "", text: "Loading...", tone: "plain" }];
    if (text.includes("\u0000")) return [{ gutter: "", text: "This is a binary file.", tone: "plain" }];
    return text.replace(/\n$/, "").split("\n").map((line, index) => ({ gutter: String(index + 1), text: line, tone: "plain" as const }));
  });
  return linesPage(app, layer, { title: () => path.split("/").pop() ?? path, lines });
}

export function commitsPage(env: Env, layer: LayerContext, full: string, ref: string): PageSpec {
  const { app, gh } = env;
  const list = app.queries.paged<J>(`commits.${full}.${ref}`, (next) => gh.page(`/repos/${full}/commits?sha=${encodeURIComponent(ref)}`, next));
  return listPage(app, layer, {
    title: "Commits",
    loading: list.loading,
    onEnd: list.more,
    rows: (rows) => pagedRows(rows, "commits", list, (c) => rows.cell({
      key: c.sha,
      avatar: c.author?.avatar_url ?? "",
      title: (c.commit.message as string).split("\n")[0]!,
      detail: `${c.author?.login ?? c.commit.author?.name ?? "unknown"}   ${c.sha.slice(0, 7)}`,
      trailing: age(c.commit.author?.date),
      run: () => app.stack.push(pageId("commit", full, c.sha)),
    }), { title: "No commits" }),
  });
}

/** The files of a commit or a pull request, each opening its diff. */
export function fileRows(env: Env, rows: typeof env.app.rows, files: J[], scope: string) {
  return files.map((file, index) => rows.cell({
    key: `${scope}.${file.filename}`,
    icon: file.status === "added" ? ICONS.plus.accent : ICONS.file.muted,
    title: file.filename,
    detail: `+${file.additions}  -${file.deletions}${file.status === "renamed" ? "   renamed" : ""}`,
    run: () => {
      diffs.set(scope, files);
      env.app.stack.push(pageId("diff", scope, index));
    },
  }));
}

const diffs = new Map<string, J[]>();

/** A unified patch as coloured lines, with the new file's numbers. */
export function patchLines(patch: string): SourceLine[] {
  const out: SourceLine[] = [];
  let line = 0;
  for (const text of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
    if (hunk) {
      line = Number(hunk[1]);
      out.push({ gutter: "", text, tone: "hunk" });
    } else if (text.startsWith("+")) out.push({ gutter: String(line++), text, tone: "add" });
    else if (text.startsWith("-")) out.push({ gutter: "", text, tone: "del" });
    else out.push({ gutter: String(line++), text, tone: "plain" });
  }
  return out;
}

export function diffPage(env: Env, layer: LayerContext, scope: string, index: number): PageSpec {
  const file = () => diffs.get(scope)?.[index];
  const lines = createMemo<SourceLine[]>(() => {
    const f = file();
    if (!f) return [{ gutter: "", text: "This diff is gone: go back and open it again.", tone: "plain" }];
    return f.patch ? patchLines(f.patch) : [{ gutter: "", text: "GitHub shows no diff for this file: it is binary or too large.", tone: "plain" }];
  });
  return linesPage(env.app, layer, { title: () => file()?.filename.split("/").pop() ?? "Diff", lines });
}

export function commitPage(env: Env, layer: LayerContext, full: string, sha: string): PageSpec {
  const { app, gh } = env;
  const commit = app.queries.query<J>(`commit.${full}.${sha}`, () => gh.get(`/repos/${full}/commits/${sha}`));
  return listPage(app, layer, {
    title: () => sha.slice(0, 7),
    backLabel: sha.slice(0, 7),
    loading: commit.loading,
    rows: (rows) => queryRows(rows, "commit", commit, (c) => {
      const [subject, ...rest] = (c.commit.message as string).split("\n");
      const body = rest.join("\n").trim();
      return [
        rows.cell({ key: "head", avatar: c.author?.avatar_url ?? "", eyebrow: c.author?.login ?? c.commit.author?.name, title: subject!, titleLines: 6, trailing: age(c.commit.author?.date) }),
        ...(body ? rows.text(body, "small", "body") : []),
        ...rows.strip([
          { id: "stat.add", label: `+${c.stats?.additions ?? 0}`, tone: "stat" },
          { id: "stat.del", label: `-${c.stats?.deletions ?? 0}`, tone: "stat" },
          { id: "stat.files", label: `${c.files?.length ?? 0} file${c.files?.length === 1 ? "" : "s"}`, icon: ICONS.file.muted, tone: "stat" },
        ], "stats"),
        rows.section("Files"),
        ...fileRows(env, rows, c.files ?? [], `commit.${full}.${sha}`),
      ];
    }),
  });
}

/** Open or closed issues or pull requests of a repository. */
export function issuesPage(env: Env, layer: LayerContext, full: string, kind: "issues" | "pulls"): PageSpec {
  const { app, gh } = env;
  const state = keep(`${kind}.${full}`, () => createSignal<"open" | "closed">("open"));
  const [filter, setFilter] = state;
  const list = () => app.queries.paged<J>(`${kind}.${full}.${filter()}`, (next) => gh.page(`/repos/${full}/${kind}?state=${filter()}&sort=updated`, next));
  return listPage(app, layer, {
    title: kind === "issues" ? "Issues" : "Pull Requests",
    loading: () => list().loading(),
    onEnd: () => list().more(),
    rows: (rows) => [
      ...rows.strip([
        { id: "filter.open", label: "Open", tone: filter() === "open" ? "chipOn" : "chip", run: () => setFilter("open") },
        { id: "filter.closed", label: "Closed", tone: filter() === "closed" ? "chipOn" : "chip", run: () => setFilter("closed") },
      ], "filter"),
      ...pagedRows(rows, kind, kind === "issues" ? withoutPulls(list()) : list(), (item) => issueCell(env, kind === "pulls" ? { ...item, repository_url: `repos/${full}`, head: item.head } : item, `${kind}.${item.id}`, false), { title: `No ${filter()} ${kind === "issues" ? "issues" : "pull requests"}` }),
    ],
  });
}

/** GitHub's issue list has pull requests in it too: leave them out. */
function withoutPulls(list: Paged<J>): Paged<J> {
  return { ...list, items: () => list.items().filter((item) => item.pull_request === undefined) };
}

export function releasesPage(env: Env, layer: LayerContext, full: string): PageSpec {
  const { app, gh } = env;
  const list = app.queries.paged<J>(`releases.${full}`, (next) => gh.page(`/repos/${full}/releases`, next));
  return listPage(app, layer, {
    title: "Releases",
    loading: list.loading,
    onEnd: list.more,
    rows: (rows) => pagedRows(rows, "releases", list, (r) => rows.cell({
      key: String(r.id),
      icon: r.prerelease ? ICONS.tag.muted : ICONS.tag.green,
      title: r.name || r.tag_name,
      detail: `${r.tag_name}   ${r.assets?.length ?? 0} assets`,
      trailing: age(r.published_at),
      run: () => app.stack.push(pageId("release", full, r.id)),
    }), { title: "No releases" }),
  });
}

export function releasePage(env: Env, layer: LayerContext, full: string, id: string): PageSpec {
  const { app, gh } = env;
  const release = app.queries.query<J>(`release.${full}.${id}`, () => gh.get(`/repos/${full}/releases/${id}`));
  return listPage(app, layer, {
    title: () => release.data()?.tag_name ?? "Release",
    loading: release.loading,
    rows: (rows) => queryRows(rows, "release", release, (r) => [
      rows.cell({ key: "head", avatar: r.author?.avatar_url ?? "", eyebrow: r.author?.login, title: r.name || r.tag_name, big: true, trailing: age(r.published_at) }),
      ...markdownRows(rows, r.body ?? "", "notes"),
      ...(r.assets?.length ? [rows.section("Assets"), ...r.assets.map((a: J) => rows.cell({ key: `asset.${a.id}`, icon: ICONS.file.muted, title: a.name, detail: `${bytes(a.size)}   ${count(a.download_count)} downloads` }))] : []),
    ]),
  });
}

const runIcon = (r: J) => (r.status !== "completed" ? ICONS["dot-run"].yellow : r.conclusion === "success" ? ICONS["check-circle"].green : r.conclusion === "skipped" || r.conclusion === "cancelled" ? ICONS["issue-skip"].muted : ICONS["x-circle"].red);

export function runsPage(env: Env, layer: LayerContext, full: string): PageSpec {
  const { app, gh } = env;
  const list = app.queries.paged<J>(`runs.${full}`, (next) => gh.page(`/repos/${full}/actions/runs`, next, "workflow_runs"));
  return listPage(app, layer, {
    title: "Actions",
    loading: list.loading,
    onEnd: list.more,
    rows: (rows) => pagedRows(rows, "runs", list, (r) => rows.cell({
      key: String(r.id),
      icon: runIcon(r),
      eyebrow: `${r.name} #${r.run_number}`,
      title: r.display_title,
      detail: `${r.head_branch}   ${r.event}`,
      trailing: age(r.updated_at),
      run: () => app.stack.push(pageId("run", full, r.id)),
    }), { title: "No workflow runs", detail: "This repository has not run any Actions." }),
  });
}

export function runPage(env: Env, layer: LayerContext, full: string, id: string): PageSpec {
  const { app, gh } = env;
  const run = app.queries.query<J>(`run.${full}.${id}`, () => gh.get(`/repos/${full}/actions/runs/${id}`));
  const jobs = app.queries.query<J>(`jobs.${full}.${id}`, () => gh.get(`/repos/${full}/actions/runs/${id}/jobs`));
  const again = () => {
    run.reload();
    jobs.reload();
  };
  return listPage(app, layer, {
    title: () => `Run ${run.data()?.run_number ?? ""}`,
    loading: run.loading,
    rows: (rows) => queryRows(rows, "run", run, (r) => {
      const live = r.status !== "completed";
      return [
        rows.cell({ key: "head", icon: runIcon(r), eyebrow: r.name, title: r.display_title, titleLines: 4, detail: `${r.head_branch}   ${r.event}   ${r.actor?.login ?? ""}`, trailing: age(r.updated_at) }),
        ...rows.strip([live
          ? { id: "run.cancel", label: "Cancel Run", tone: "danger", run: () => app.confirm({ title: "Cancel this run?", message: `${r.name} #${r.run_number} on ${r.head_branch}.`, action: "Cancel Run", danger: true, run: () => write(env, gh.send("POST", `/repos/${full}/actions/runs/${id}/cancel`), "Cancelling", again) }) }
          : { id: "run.rerun", label: "Re-run", icon: ICONS.play.accent, tone: "button", run: () => app.confirm({ title: "Run this again?", message: `${r.name} #${r.run_number} on ${r.head_branch}.`, action: "Re-run", run: () => write(env, gh.send("POST", `/repos/${full}/actions/runs/${id}/rerun`), "Started again", again) }) }], "actions"),
        ...(jobs.data()?.jobs ?? []).flatMap((job: J) => [
          rows.section(job.name, `job.${job.id}`),
          ...(job.steps ?? []).map((step: J) => rows.cell({ key: `step.${job.id}.${step.number}`, icon: runIcon(step), title: step.name, titleLines: 1, trailing: step.conclusion ?? step.status })),
        ]),
      ];
    }),
  });
}

export function refsPage(env: Env, layer: LayerContext, full: string): PageSpec {
  const { app, gh } = env;
  const branches = app.queries.paged<J>(`branches.${full}`, (next) => gh.page(`/repos/${full}/branches`, next));
  const tags = app.queries.paged<J>(`tags.${full}`, (next) => gh.page(`/repos/${full}/tags`, next));
  return listPage(app, layer, {
    title: "Branches and Tags",
    backLabel: "Branches",
    loading: branches.loading,
    onEnd: branches.more,
    rows: (rows) => [
      rows.section("Branches"),
      ...pagedRows(rows, "branches", branches, (b) => rows.cell({ key: `b.${b.name}`, icon: ICONS.branch.muted, title: b.name, titleLines: 1, run: () => app.stack.push(pageId("tree", full, b.name, "")) }), { title: "No branches" }),
      ...(tags.items().length ? [rows.section("Tags")] : []),
      ...tags.items().map((t) => rows.cell({ key: `t.${t.name}`, icon: ICONS.tag.muted, title: t.name, titleLines: 1, run: () => app.stack.push(pageId("tree", full, t.name, "")) })),
    ],
  });
}

export function peoplePage(env: Env, layer: LayerContext, full: string): PageSpec {
  const { app, gh } = env;
  const list = app.queries.paged<J>(`people.${full}`, (next) => gh.page(`/repos/${full}/contributors`, next));
  return listPage(app, layer, {
    title: "Contributors",
    loading: list.loading,
    onEnd: list.more,
    rows: (rows) => pagedRows(rows, "people", list, (user) => userCell(env, user, `user.${user.login}`), { title: "No contributors" }),
  });
}
