// SPDX-License-Identifier: GPL-3.0-or-later
// pocket-applet: draws its own pixels because the sign-in page shows a QR code.
// applets/github/pages/people.tsx — search, a user, gists and signing in.
import { createSignal, For, type Accessor } from "solid-js";
import { Text, View } from "@pocketjs/framework/components";
import { ICONS, linesPage, listPage, type SourceLine } from "../../kit/app.tsx";
import { S, T } from "../../kit/theme.ts";
import { encodeQr } from "../../kit/qr.ts";
import { keep } from "../../ui/keep.ts";
import type { LayerContext, PageSpec } from "../../ui/nav.tsx";
import { NAV_H } from "../../ui/bar.tsx";
import { SCREEN_H, SCREEN_W } from "../../ui/screen.ts";
import { age, count, type J } from "../api.ts";
import { issueCell, pageId, pagedRows, queryRows, repoCell, userCell, write, type Env } from "../shared.ts";

const KINDS = [["Repos", "repositories"], ["Issues", "issues"], ["Users", "users"]] as const;

export function searchPage(env: Env, layer: LayerContext): PageSpec {
  const { app, gh } = env;
  const state = keep("search", () => ({ words: createSignal(""), kind: createSignal(0) }));
  const [words, setWords] = state.words;
  const [kind, setKind] = state.kind;
  const ask = () => app.compose({ title: "Search", placeholder: "Repositories, issues, people", action: "Search", singleLine: true, initial: words(), send: async (text) => { setWords(text); } });
  const list = () => {
    const q = words();
    const k = KINDS[kind()]![1];
    return q ? app.queries.paged<J>(`search.${k}.${q}`, (next) => gh.page(`/search/${k}?q=${encodeURIComponent(q)}`, next, "items")) : null;
  };
  return listPage(app, layer, {
    title: "Search",
    loading: () => list()?.loading() ?? false,
    onEnd: () => list()?.more(),
    right: () => ({ id: "search.ask", label: "Type", kind: "plain", run: ask }),
    rows: (rows) => {
      const found = list();
      return [
        rows.cell({ key: "field", icon: ICONS.search.muted, title: words() || "Search GitHub", chevron: false, titleLines: 1, run: ask }),
        ...rows.strip(KINDS.map(([label], index) => ({ id: `kind.${index}`, label, tone: kind() === index ? "chipOn" as const : "chip" as const, run: () => setKind(index) })), "kinds"),
        ...(found
          ? pagedRows(rows, "found", found, (item) => (kind() === 0 ? repoCell(env, item, `r.${item.id}`) : kind() === 1 ? issueCell(env, item, `i.${item.id}`) : userCell(env, item, `u.${item.id}`)), { title: `Nothing found for "${words()}"` })
          : rows.message({ key: "hint", title: "Find anything on GitHub", detail: "Tap the field and type." })),
      ];
    },
  });
}

export function userPage(env: Env, layer: LayerContext, login: string): PageSpec {
  const { app, gh } = env;
  const user = app.queries.query<J>(`user.${login}`, () => gh.get(`/users/${login}`));
  const repos = app.queries.paged<J>(`user.${login}.repos`, (next) => gh.page(`/users/${login}/repos?sort=pushed`, next));
  const following = app.queries.query<boolean>(`following.${login}`, () => (gh.signedIn() ? gh.check(`/user/following/${login}`) : Promise.resolve(false)));
  const self = () => gh.me()?.login === login;
  return listPage(app, layer, {
    title: login,
    backLabel: login,
    loading: user.loading,
    onEnd: repos.more,
    rows: (rows) => queryRows(rows, "user", user, (u) => {
      const on = following.data() === true;
      return [
        rows.cell({ key: "head", avatar: u.avatar_url, avatarSize: 56, big: true, title: u.name || u.login, eyebrow: u.name ? u.login : undefined, detail: u.bio || undefined, detailLines: 5 }),
        ...rows.strip([
          { id: "stat.followers", label: `${count(u.followers)} followers`, icon: ICONS.person.muted, tone: "stat" },
          { id: "stat.following", label: `${count(u.following)} following`, tone: "stat" },
          { id: "stat.repos", label: `${count(u.public_repos)} repos`, icon: ICONS.repo.muted, tone: "stat" },
        ], "stats"),
        ...rows.strip([
          ...(self() ? [] : [{ id: "act.follow", label: on ? "Following" : "Follow", tone: on ? "button" as const : "primary" as const, run: () => {
            if (!gh.signedIn()) return app.stack.push("signin");
            write(env, gh.send(on ? "DELETE" : "PUT", `/user/following/${login}`), on ? "Unfollowed" : "Following", following.reload);
          } }]),
          { id: "act.gists", label: `${count(u.public_gists)} gists`, icon: ICONS.gist.muted, tone: "button", run: () => app.stack.push(pageId("gists", login)) },
        ], "actions"),
        rows.section("Repositories"),
        ...pagedRows(rows, "repos", repos, (item) => repoCell(env, item, `r.${item.id}`), { title: "No public repositories" }),
      ];
    }),
  });
}

export function gistsPage(env: Env, layer: LayerContext, login: string): PageSpec {
  const { app, gh } = env;
  const list = app.queries.paged<J>(`gists.${login}`, (next) => gh.page(`/users/${login}/gists`, next));
  return listPage(app, layer, {
    title: "Gists",
    loading: list.loading,
    onEnd: list.more,
    rows: (rows) => pagedRows(rows, "gists", list, (g) => {
      const names = Object.keys(g.files);
      return rows.cell({ key: g.id, icon: ICONS.gist.muted, title: g.description || names[0] || g.id, detail: `${names.length} file${names.length === 1 ? "" : "s"}${g.comments ? `   ${g.comments} comments` : ""}`, trailing: age(g.updated_at), run: () => app.stack.push(pageId("gist", g.id)) });
    }, { title: "No gists" }),
  });
}

export function gistPage(env: Env, layer: LayerContext, id: string): PageSpec {
  const { app, gh } = env;
  const gist = app.queries.query<J>(`gist.${id}`, () => gh.get(`/gists/${id}`));
  return listPage(app, layer, {
    title: "Gist",
    loading: gist.loading,
    rows: (rows) => queryRows(rows, "gist", gist, (g) => [
      rows.cell({ key: "head", avatar: g.owner?.avatar_url ?? "", eyebrow: g.owner?.login, title: g.description || "Gist", titleLines: 4, trailing: age(g.updated_at) }),
      ...Object.values(g.files as Record<string, J>).map((file) => rows.cell({ key: file.filename, icon: ICONS.file.muted, title: file.filename, titleLines: 1, detail: file.language || undefined, run: () => app.stack.push(pageId("gistfile", id, file.filename)) })),
    ]),
  });
}

export function gistFilePage(env: Env, layer: LayerContext, id: string, name: string): PageSpec {
  const { app, gh } = env;
  const gist = app.queries.query<J>(`gist.${id}`, () => gh.get(`/gists/${id}`));
  const lines: Accessor<SourceLine[]> = () => {
    const content = gist.data()?.files?.[name]?.content as string | undefined;
    return content === undefined ? [{ gutter: "", text: "Loading...", tone: "plain" }] : content.split("\n").map((text, index) => ({ gutter: String(index + 1), text, tone: "plain" as const }));
  };
  return linesPage(app, layer, { title: name, lines });
}

// shown, not fetched
const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,notifications,workflow,gist,read:user,read:org&description=Omarchy%20Pocket";

/** A QR code as one view per dark run. */
function Qr(props: { url: string; x: number; y: number; side: number }) {
  const code = encodeQr(Uint8Array.from(props.url, (c) => c.charCodeAt(0) & 0xff));
  const quiet = 2;
  const cell = Math.max(2, Math.floor(props.side / (code.size + quiet * 2)));
  const side = cell * (code.size + quiet * 2);
  const runs: { x: number; y: number; w: number }[] = [];
  code.modules.forEach((row, y) => {
    let start = -1;
    row.forEach((dark, x) => {
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        runs.push({ x: start, y, w: x - start });
        start = -1;
      }
    });
    if (start >= 0) runs.push({ x: start, y, w: row.length - start });
  });
  return (
    <View class="absolute" style={{ insetL: props.x + (props.side - side) / 2, insetT: props.y, width: side, height: side, bgColor: "#ffffff", radius: 6 }}>
      <For each={runs}>{(run) => <View class="absolute" style={{ insetL: (run.x + quiet) * cell, insetT: (run.y + quiet) * cell, width: run.w * cell, height: cell, bgColor: "#000000" }} />}</For>
    </View>
  );
}

export function signInPage(env: Env, _layer: LayerContext): PageSpec {
  const { app, gh } = env;
  const enter = () => app.compose({ title: "Personal Access Token", placeholder: "ghp_...", action: "Sign In", singleLine: true, secret: true, send: (token) => gh.signIn(token).then(() => {
    app.stack.pop();
    app.say("Signed in");
  }) });
  const side = Math.min(180, SCREEN_H - NAV_H - 130);
  const buttonY = NAV_H + 16 + side + 62;
  return {
    title: () => "Sign In",
    tint: "flat",
    activateLabel: () => "",
    fixed: () => (
      <>
        <Qr url={TOKEN_URL} x={(SCREEN_W - side) / 2} y={NAV_H + 16} side={side} />
        <Text class="absolute text-sm font-bold text-center" style={{ insetL: 0, insetT: NAV_H + 24 + side, width: SCREEN_W, textColor: T.text }}>Scan this to make a token on your phone</Text>
        <Text class="absolute text-xs text-center" style={{ insetL: 0, insetT: NAV_H + 42 + side, width: SCREEN_W, textColor: T.muted }}>Then type it here. It stays on this device.</Text>
        <View class="absolute rounded-[6]" style={{ insetL: (SCREEN_W - 160) / 2, insetT: buttonY, width: 160, height: S.buttonH, bgColor: app.press.is("signin.enter") ? "#2ea043" : T.greenFill }} />
        <Text class="absolute text-xs font-bold text-center" style={{ insetL: (SCREEN_W - 160) / 2, insetT: buttonY + 8, width: 160, textColor: "#ffffff" }}>Enter Token</Text>
      </>
    ),
    fixedTargets: () => [{ id: "signin.enter", x: (SCREEN_W - 160) / 2, y: buttonY, w: 160, h: S.buttonH, run: enter }],
  };
}

