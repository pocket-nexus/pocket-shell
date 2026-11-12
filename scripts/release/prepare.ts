// SPDX-License-Identifier: GPL-3.0-or-later
// bun run release [auto|patch|minor|major|VERSION] [--dry-run] — open the
// release pull request. It raises every version in VERSION_FILES and bun.lock
// on a branch from origin/main, `release/v<version>`, in a worktree of its own
// under .pocket-build/release/, so the checkout this runs in is not touched.
// Merging the pull request is the release: Release 3DS tags the merge commit,
// builds the .3dsx from it and publishes it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BUMPS, changesMarkdown, commitsBetween, fromTree, git, gitOptional, inferBump, parseVersion,
  previousTag, REPO, selectVersion, sharedVersion, VERSION_FILES, withVersion,
} from "./version.ts";

const ROOT = resolve(import.meta.dir, "../..");
const USAGE = `Usage: bun run release [auto|patch|minor|major|VERSION] [--dry-run]

auto (the default) reads the Conventional Commits since the last release tag:
a breaking change raises the major (the minor below 1.0.0), a feat the minor,
anything else the patch. VERSION names the next version exactly, a
pre-release (0.3.0-rc.1) included.

Opens a release pull request from origin/main. --dry-run prepares the change
from HEAD in a worktree under .pocket-build/release/ and opens nothing.`;

function run(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  if (!result.success) throw new Error(`${args.slice(0, 3).join(" ")} failed:\n${result.stderr}`);
  return result.stdout.toString().trim();
}

export function parseArgs(args: readonly string[]): { requested: string; dryRun: boolean } {
  let requested: string | undefined;
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("-") || requested !== undefined) throw new Error(`Unexpected argument ${arg}\n\n${USAGE}`);
    else requested = arg === "auto" || (BUMPS as readonly string[]).includes(arg) ? arg : parseVersion(arg);
  }
  return { requested: requested ?? "auto", dryRun };
}

/** Raises the versions in the worktree `cwd` and returns what changed. */
export function prepareRelease(cwd: string, requested: string) {
  const current = sharedVersion(fromTree(cwd));
  const since = previousTag(cwd, "HEAD");
  const commits = commitsBetween(cwd, since, "HEAD");
  if (!commits.length && requested === "auto") throw new Error(`No unreleased commits since ${since}; name a version to release the same source`);
  const inferred = inferBump(commits);
  const version = selectVersion(current, requested, inferred);
  if (gitOptional(cwd, "rev-parse", "--verify", "--quiet", `refs/tags/v${version}`)) throw new Error(`Tag v${version} already exists`);
  for (const path of VERSION_FILES) {
    const file = resolve(cwd, path);
    writeFileSync(file, withVersion(readFileSync(file, "utf8"), version));
  }
  return { current, version, inferred, since, commits };
}

async function main() {
  const args = Bun.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) return console.log(USAGE);
  const { requested, dryRun } = parseArgs(args);
  if (!dryRun) {
    const open = JSON.parse(run(ROOT, "gh", "pr", "list", "--repo", REPO, "--base", "main", "--state", "open", "--limit", "100", "--json", "headRefName,url")) as { headRefName: string; url: string }[];
    const existing = open.find((pr) => pr.headRefName.startsWith("release/v"));
    if (existing) return console.log(`A release pull request is open: ${existing.url}`);
  }
  // The tags name the last release; a dry run without the network uses the local ones.
  if (dryRun) gitOptional(ROOT, "fetch", "--quiet", "origin", "--tags");
  else git(ROOT, "fetch", "--quiet", "origin", "main", "--tags");

  const output = resolve(ROOT, ".pocket-build/release", `${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`);
  const worktree = resolve(output, "source");
  mkdirSync(output, { recursive: true });
  git(ROOT, "worktree", "add", "--detach", worktree, dryRun ? "HEAD" : "origin/main");
  try {
    const plan = prepareRelease(worktree, requested);
    run(worktree, "bun", "install", "--lockfile-only", "--ignore-scripts");
    if (sharedVersion(fromTree(worktree)) !== plan.version) throw new Error("The versions did not all change");
    git(worktree, "diff", "--check");
    const files = git(worktree, "diff", "--name-only").split("\n").filter(Boolean);
    const base = git(worktree, "rev-parse", "HEAD");
    const title = `chore(release): v${plan.version}`;
    const body = [
      `Release ${plan.version}. Merging this pull request into main tags the merge commit \`v${plan.version}\`; Release 3DS then builds the \`.3dsx\` from it and publishes the GitHub release${plan.version.includes("-") ? " as a prerelease" : ""}.`,
      "",
      `- Version: ${plan.current} → ${plan.version} (${requested === "auto" ? `auto: ${plan.inferred}` : requested})`,
      `- Files: ${files.map((file) => `\`${file}\``).join(", ")}`,
      `- Prepared from: ${base}`,
      "",
      changesMarkdown(plan.commits, plan.since),
      "",
    ].join("\n");
    const bodyFile = resolve(output, "PR_BODY.md");
    await Bun.write(bodyFile, body);
    console.log(`${title}\n${git(worktree, "diff", "--stat")}`);
    if (dryRun) return console.log(`\nPreview: ${worktree}\nPull request body: ${bodyFile}\nRemove with: git worktree remove --force ${worktree}`);

    const branch = `release/v${plan.version}`;
    git(worktree, "switch", "--quiet", "-c", branch);
    git(worktree, "add", "--", ...files);
    git(worktree, "commit", "--quiet", "-m", title);
    git(worktree, "push", "--quiet", "-u", "origin", branch);
    console.log(run(worktree, "gh", "pr", "create", "--repo", REPO, "--base", "main", "--head", branch, "--title", title, "--body-file", bodyFile));
    git(ROOT, "worktree", "remove", worktree);
  } catch (error) {
    console.error(`Release preparation kept at ${worktree}`);
    throw error;
  }
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
