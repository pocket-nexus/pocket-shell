// SPDX-License-Identifier: GPL-3.0-or-later
// applets/github/pages/home.tsx — the first page, under five tabs: Inbox, Pulls,
// Issues, Repos and Me.
import { createSignal } from "solid-js";
import { ICONS, listPage, type Tab } from "../../kit/app.tsx";
import { keep } from "../../ui/keep.ts";
import type { LayerContext, PageSpec } from "../../ui/nav.tsx";
import type { Row } from "../../kit/rows.ts";
import { age, type J } from "../api.ts";
import { issueCell, pageId, pagedRows, repoCell, write, type Env } from "../shared.ts";

const TABS: Tab[] = [
  { id: "inbox", label: "Inbox", icon: ICONS.bell.muted, on: ICONS.bell.accent },
  { id: "pulls", label: "Pulls", icon: ICONS["pr-open"].muted, on: ICONS["pr-open"].green },
  { id: "issues", label: "Issues", icon: ICONS["issue-open"].muted, on: ICONS["issue-open"].green },
  { id: "repos", label: "Repos", icon: ICONS.repo.muted, on: ICONS.repo.accent },
  { id: "me", label: "Me", icon: ICONS.person.muted, on: ICONS.person.accent },
];

const PULLS = [["Created", "author"], ["Review", "review-requested"], ["Assigned", "assignee"]] as const;
const ISSUES = [["Assigned", "assignee"], ["Created", "author"], ["Mentioned", "mentions"]] as const;

const TITLES: Record<string, string> = { inbox: "Inbox", pulls: "Pull Requests", issues: "Issues", repos: "Repositories", me: "Me" };

/** Where a notification leads. */
function open(env: Env, note: J): void {
  const repo = note.repository.full_name;
  const number = /\/(\d+)$/.exec(note.subject.url ?? "")?.[1];
  const sha = /commits\/([0-9a-f]+)$/.exec(note.subject.url ?? "")?.[1];
  const { stack } = env.app;
  if (note.subject.type === "PullRequest" && number) stack.push(pageId("pr", repo, number));
  else if (note.subject.type === "Issue" && number) stack.push(pageId("issue", repo, number));
  else if (note.subject.type === "Commit" && sha) stack.push(pageId("commit", repo, sha));
  else if (note.subject.type === "Release") stack.push(pageId("releases", repo));
  else stack.push(pageId("repo", repo));
  if (note.unread) write(env, env.gh.send("PATCH", `/notifications/threads/${note.id}`), "Marked read");
}

export function homePage(env: Env, layer: LayerContext): PageSpec {
  const { app, gh } = env;
  const state = keep("home", () => ({ tab: createSignal("inbox"), inbox: createSignal("unread"), pulls: createSignal(0), issues: createSignal(0), repos: createSignal("yours") }));
  const [tab, setTab] = state.tab;
  const [inbox, setInbox] = state.inbox;
  const [pulls, setPulls] = state.pulls;
  const [issues, setIssues] = state.issues;
  const [repos, setRepos] = state.repos;

  const signIn = (rows: typeof app.rows, what: string): Row[] =>
    rows.message({ key: "signin", title: `Sign in to see ${what}`, detail: "Public repositories and search work without an account.", action: { label: "Sign In", run: () => app.stack.push("signin") } });

  const search = (kind: "pr" | "issue", role: string) =>
    app.queries.paged<J>(`home.${kind}.${role}`, (next) => gh.page(`/search/issues?q=${encodeURIComponent(`is:open is:${kind} ${role}:@me archived:false`)}&sort=updated`, next, "items"));
  const notes = () => app.queries.paged<J>(`home.inbox.${inbox()}`, (next) => gh.page(`/notifications${inbox() === "all" ? "?all=true" : ""}`, next));
  const repoList = () =>
    repos() === "starred"
      ? app.queries.paged<J>("home.repos.starred", (next) => gh.page("/user/starred", next))
      : repos() === "orgs"
        ? app.queries.paged<J>("home.repos.orgs", (next) => gh.page("/user/orgs", next))
        : app.queries.paged<J>("home.repos.yours", (next) => gh.page("/user/repos?sort=pushed&affiliation=owner,collaborator,organization_member", next));
  const current = () => {
    if (!gh.signedIn()) return null;
    switch (tab()) {
      case "inbox":
        return notes();
      case "pulls":
        return search("pr", PULLS[pulls()]![1]);
      case "issues":
        return search("issue", ISSUES[issues()]![1]);
      case "repos":
        return repoList();
      default:
        return null;
    }
  };
  const chooseTab = (id: string) => {
    if (id === tab()) return;
    setTab(id);
    layer.scrollBy(-1e7);
  };

  return listPage(app, layer, {
    title: () => TITLES[tab()] ?? "GitHub",
    backLabel: "Back",
    tabs: { items: TABS, current: tab, select: chooseTab },
    right: () => ({ id: "home.search", label: "Search", kind: "plain", run: () => app.stack.push("search") }),
    loading: () => gh.signedIn() && (current()?.loading() ?? false),
    onEnd: () => current()?.more(),
    rows: (rows) => {
      switch (tab()) {
        case "inbox": {
          if (!gh.signedIn()) return signIn(rows, "your notifications");
          const list = notes();
          return [
            ...rows.strip([
              { id: "inbox.unread", label: "Unread", tone: inbox() === "unread" ? "chipOn" : "chip", run: () => setInbox("unread") },
              { id: "inbox.all", label: "All", tone: inbox() === "all" ? "chipOn" : "chip", run: () => setInbox("all") },
            ], "inbox.filter"),
            ...pagedRows(rows, "inbox", list, (note) => {
              const icon = note.subject.type === "PullRequest" ? ICONS["pr-open"].muted : note.subject.type === "Issue" ? ICONS["issue-open"].muted : note.subject.type === "Release" ? ICONS.tag.muted : note.subject.type === "Commit" ? ICONS.commit.muted : ICONS.bell.muted;
              return rows.cell({ key: `note.${note.id}`, icon, eyebrow: note.repository.full_name, title: note.subject.title, trailing: age(note.updated_at), detail: note.reason.replace(/_/g, " "), unread: note.unread, run: () => open(env, note) });
            }, { title: inbox() === "unread" ? "All caught up" : "No notifications", detail: inbox() === "unread" ? "Nothing new is waiting for you." : undefined }),
          ];
        }
        case "pulls": {
          if (!gh.signedIn()) return signIn(rows, "your pull requests");
          return [
            ...rows.strip(PULLS.map(([label], index) => ({ id: `pulls.${index}`, label, tone: pulls() === index ? "chipOn" as const : "chip" as const, run: () => setPulls(index) })), "pulls.filter"),
            ...pagedRows(rows, "pulls", search("pr", PULLS[pulls()]![1]), (item) => issueCell(env, item, `pull.${item.id}`), { title: "No open pull requests here" }),
          ];
        }
        case "issues": {
          if (!gh.signedIn()) return signIn(rows, "your issues");
          return [
            ...rows.strip(ISSUES.map(([label], index) => ({ id: `issues.${index}`, label, tone: issues() === index ? "chipOn" as const : "chip" as const, run: () => setIssues(index) })), "issues.filter"),
            ...pagedRows(rows, "issues", search("issue", ISSUES[issues()]![1]), (item) => issueCell(env, item, `issue.${item.id}`), { title: "No open issues here" }),
          ];
        }
        case "repos": {
          if (!gh.signedIn()) return signIn(rows, "your repositories");
          return [
            ...rows.strip([["Yours", "yours"], ["Starred", "starred"], ["Orgs", "orgs"]].map(([label, id]) => ({ id: `repos.${id}`, label: label!, tone: repos() === id ? "chipOn" as const : "chip" as const, run: () => setRepos(id!) })), "repos.filter"),
            ...pagedRows(rows, "repos", repoList(), (item) => repos() === "orgs"
              ? rows.cell({ key: `org.${item.id}`, avatar: item.avatar_url, title: item.login, detail: item.description || undefined, run: () => app.stack.push(pageId("user", item.login)) })
              : repoCell(env, item, `repo.${item.id}`), { title: "Nothing here yet" }),
          ];
        }
        default: {
          if (!gh.signedIn()) return signIn(rows, "your account");
          const me = gh.me();
          const rate = gh.rate();
          return [
            rows.cell({ key: "me", avatar: me?.avatar_url ?? "", avatarSize: 56, big: true, title: me?.name || me?.login || "...", detail: me?.bio || (me?.name ? me?.login : undefined), run: me ? () => app.stack.push(pageId("user", me.login)) : undefined }),
            rows.section("You"),
            rows.cell({ key: "me.gists", icon: ICONS.gist.muted, title: "Gists", run: () => me && app.stack.push(pageId("gists", me.login)) }),
            rows.cell({ key: "me.search", icon: ICONS.search.muted, title: "Search GitHub", run: () => app.stack.push("search") }),
            rows.section("Account"),
            rows.cell({ key: "me.rate", icon: ICONS.clock.muted, title: "Rate limit", trailing: rate ? `${rate.remaining} of ${rate.limit} left` : "" }),
            rows.cell({ key: "me.out", icon: ICONS.lock.muted, title: "Sign Out", chevron: false, run: () => app.confirm({ title: "Sign out of GitHub?", message: "The token leaves this device.", action: "Sign Out", danger: true, run: () => write(env, gh.signOut(), "Signed out") }) }),
          ];
        }
      }
    },
  });
}

