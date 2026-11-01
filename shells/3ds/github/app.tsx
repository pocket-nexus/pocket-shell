// SPDX-License-Identifier: GPL-3.0-or-later
// applets/github/app.tsx — GitHub on Omarchy Pocket, built from the design system
// in applets/kit: this file routes page ids to their builders.
import { createApp } from "../kit/app.tsx";
import { keep } from "../ui/keep.ts";
import { createGitHub } from "./api.ts";
import { homePage } from "./pages/home.tsx";
import { gistFilePage, gistPage, gistsPage, searchPage, signInPage, userPage } from "./pages/people.tsx";
import { commitPage, commitsPage, diffPage, filePage, issuesPage, peoplePage, refsPage, releasePage, releasesPage, repoPage, runPage, runsPage, treePage } from "./pages/repo.tsx";
import { mergePage, prCommitsPage, prFilesPage, reviewPage, threadPage } from "./pages/thread.tsx";
import { pageParts, type Env } from "./shared.ts";

export default createApp({
  name: "github",
  root: "home",
  page(id, app, layer) {
    const env: Env = { app, gh: keep("gh", createGitHub) };
    const [kind, a = "", b = "", c = ""] = pageParts(id);
    switch (kind) {
      case "repo": return repoPage(env, layer, a);
      case "tree": return treePage(env, layer, a, b, c);
      case "file": return filePage(env, layer, a, b, c);
      case "commits": return commitsPage(env, layer, a, b);
      case "commit": return commitPage(env, layer, a, b);
      case "diff": return diffPage(env, layer, a, Number(b));
      case "issues": return issuesPage(env, layer, a, "issues");
      case "pulls": return issuesPage(env, layer, a, "pulls");
      case "issue": return threadPage(env, layer, "issue", a, b);
      case "pr": return threadPage(env, layer, "pr", a, b);
      case "prfiles": return prFilesPage(env, layer, a, b);
      case "prcommits": return prCommitsPage(env, layer, a, b);
      case "review": return reviewPage(env, layer, a, b);
      case "merge": return mergePage(env, layer, a, b);
      case "releases": return releasesPage(env, layer, a);
      case "release": return releasePage(env, layer, a, b);
      case "runs": return runsPage(env, layer, a);
      case "run": return runPage(env, layer, a, b);
      case "refs": return refsPage(env, layer, a);
      case "people": return peoplePage(env, layer, a);
      case "user": return userPage(env, layer, a);
      case "gists": return gistsPage(env, layer, a);
      case "gist": return gistPage(env, layer, a);
      case "gistfile": return gistFilePage(env, layer, a, b);
      case "search": return searchPage(env, layer);
      case "signin": return signInPage(env, layer);
      default: return homePage(env, layer);
    }
  },
});
