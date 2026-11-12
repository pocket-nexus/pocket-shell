// SPDX-License-Identifier: GPL-3.0-or-later
// The repository's one version. The root package.json, each shell's
// package.json and each app contract name the same SemVer; `bun run release`
// raises all of them in one pull request, and the merge that changes the root
// package.json's version is the release (.github/workflows/release-3ds.yml).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const REPO = "pocket-nexus/pocket-shell";

/** Every file whose top-level `version` is the repository's version. bun.lock
 *  repeats the shells' package versions and is regenerated after them. */
export const VERSION_FILES = [
  "package.json",
  "shells/3ds/package.json",
  "shells/3ds/shell/pocket.app.json",
  "shells/desktop/package.json",
  "shells/desktop/pocket.app.json",
  "shells/desktop/pocket.app.studio.json",
  "shells/desktop/pocket.system.json",
  "shells/touch/package.json",
  "shells/touch/pocket.app.json",
] as const;

// SemVer 2.0.0 without build metadata: the version is also the tag
// (`v` + version) and part of the release's file names. A pre-release suffix
// (0.3.0-rc.1) makes a GitHub prerelease.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/;

export const BUMPS = ["patch", "minor", "major"] as const;
export type Bump = (typeof BUMPS)[number];

/** A version or `v`-prefixed tag, returned without the `v`. */
export function parseVersion(input: string): string {
  const version = input.startsWith("v") ? input.slice(1) : input;
  if (!SEMVER.test(version)) {
    throw new Error(`Invalid version ${JSON.stringify(input)}; expected SemVer such as 0.2.0 or 0.3.0-rc.1, without build metadata`);
  }
  return version;
}

export const isPrerelease = (version: string) => version.includes("-");

export function bumpVersion(version: string, bump: Bump): string {
  if (isPrerelease(parseVersion(version))) {
    throw new Error(`${version} is a pre-release; name the next version exactly (bun run release 0.3.0)`);
  }
  const [major, minor, patch] = version.split(".").map(Number) as [number, number, number];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export interface Commit {
  sha: string;
  subject: string;
  body: string;
}

/** The bump the Conventional Commits since the last release ask for: a
 *  breaking change is major, a feature minor, anything else patch. */
export function inferBump(commits: readonly Commit[]): Bump {
  if (commits.some((c) => /^[a-z]+(?:\([^\n)]*\))?!:/.test(c.subject) || /^BREAKING[ -]CHANGE:/m.test(c.body))) return "major";
  return commits.some((c) => /^feat(?:\([^\n)]*\))?:/.test(c.subject)) ? "minor" : "patch";
}

/** The version a release request names: `auto` (the inferred bump; below
 *  1.0.0 a breaking change raises the minor), `patch`, `minor`, `major` or an
 *  exact version. It must be greater than `current`. */
export function selectVersion(current: string, requested: string, inferred: Bump): string {
  let next: string;
  if (requested === "auto") {
    next = bumpVersion(current, inferred === "major" && current.startsWith("0.") ? "minor" : inferred);
  } else if ((BUMPS as readonly string[]).includes(requested)) {
    next = bumpVersion(current, requested as Bump);
  } else {
    next = parseVersion(requested);
  }
  if (Bun.semver.order(next, current) <= 0) throw new Error(`Release version ${next} must be greater than ${current}`);
  return next;
}

/** Reads one repository file, from the working tree or from a commit. */
export type Reader = (path: string) => string;
export const fromTree = (root: string): Reader => (path) => readFileSync(resolve(root, path), "utf8");
export const fromCommit = (root: string, commit: string): Reader => (path) => git(root, "show", `${commit}:${path}`);

/** The version every file in VERSION_FILES names; a disagreement is an error. */
export function sharedVersion(read: Reader): string {
  const found = VERSION_FILES.map((path) => {
    const version = (JSON.parse(read(path)) as { version?: unknown }).version;
    if (typeof version !== "string") throw new Error(`${path} names no version`);
    return { path, version: parseVersion(version) };
  });
  const version = found[0]!.version;
  const mismatches = found.filter((file) => file.version !== version);
  if (mismatches.length) {
    throw new Error([`${VERSION_FILES[0]} names ${version}, but:`, ...mismatches.map((f) => `  ${f.path}: ${f.version}`)].join("\n"));
  }
  return version;
}

/** `text` with its top-level version set, the rest of the file as it was. */
export function withVersion(text: string, version: string): string {
  const next = text.replace(/(^[\t ]*"version"\s*:\s*)"[^"]*"/m, `$1"${version}"`);
  if ((JSON.parse(next) as { version?: unknown }).version !== version) throw new Error("No top-level version to set");
  return next;
}

export function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(`git ${args.join(" ")} failed:\n${result.stderr}`);
  return result.stdout.toString().trim();
}

export function gitOptional(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return result.success ? result.stdout.toString().trim() : "";
}

/** The newest `v<digit>…` tag reachable from `ref` (the calendar releases
 *  v2026.09.23 through v2026.11.12 included), or "" before any release. */
export const previousTag = (cwd: string, ref: string) =>
  gitOptional(cwd, "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", ref);

/** The commits after `from` (all of them when it is "") up to `to`, oldest
 *  first, without release commits. */
export function commitsBetween(cwd: string, from: string, to: string): Commit[] {
  const records = git(cwd, "log", "--reverse", "--format=%H%x00%s%x00%b%x00", from ? `${from}..${to}` : to).split("\0");
  const commits: Commit[] = [];
  for (let i = 0; i + 2 < records.length; i += 3) {
    const commit = { sha: records[i]!.trim(), subject: records[i + 1]!, body: records[i + 2]! };
    if (!/^chore\(release\):/.test(commit.subject)) commits.push(commit);
  }
  return commits;
}

/** Commits grouped as Features, Fixes and Other changes, each linked. */
export function changesMarkdown(commits: readonly Commit[], since: string): string {
  const groups = [
    ["Features", (c: Commit) => /^feat(?:\(|!?:)/.test(c.subject)],
    ["Fixes", (c: Commit) => /^fix(?:\(|!?:)/.test(c.subject)],
    ["Other changes", (c: Commit) => !/^(feat|fix)(?:\(|!?:)/.test(c.subject)],
  ] as const;
  const sections = groups.flatMap(([title, matches]) => {
    const rows = commits.filter(matches).map((c) => `- ${c.subject} ([${c.sha.slice(0, 8)}](https://github.com/${REPO}/commit/${c.sha}))`);
    return rows.length ? [`### ${title}\n\n${rows.join("\n")}`] : [];
  });
  if (!sections.length) return since ? `No source changes since ${since}.` : "No source changes.";
  return `## Changes${since ? ` since ${since}` : ""}\n\n${sections.join("\n\n")}`;
}
