// SPDX-License-Identifier: GPL-3.0-or-later
// bun scripts/release/identity.ts [--create-tag] — Release 3DS's first job.
// A push to main is a release when it raises the root package.json's version
// (the merge of a `bun run release` pull request); the merge commit gets the
// tag v<version>. A manual run names the version of an existing tag and
// releases that tag's commit again. It writes release, version, tag, commit,
// prerelease and notes to $GITHUB_OUTPUT.

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  changesMarkdown, commitsBetween, fromCommit, fromTree, git, gitOptional, isPrerelease, parseVersion,
  previousTag, sharedVersion,
} from "./version.ts";

export interface Identity {
  release: true;
  version: string;
  tag: string;
  commit: string;
  prerelease: boolean;
  notes: string;
}

export function releaseIdentity(
  cwd: string, event: string, ref: string, input?: string, createTag = false, before?: string,
): Identity | { release: false } {
  if (git(cwd, "status", "--porcelain")) throw new Error("A release needs a clean committed source tree");
  const fromMerge = event === "push" && ref === "refs/heads/main";
  let version: string;
  let commit: string;
  if (fromMerge) {
    if (!before || !/^[a-f0-9]{40}$/.test(before) || /^0+$/.test(before)) throw new Error("A push to main needs the commit before it");
    git(cwd, "merge-base", "--is-ancestor", before, "HEAD");
    version = sharedVersion(fromTree(cwd));
    const previous = parseVersion((JSON.parse(fromCommit(cwd, before)("package.json")) as { version: string }).version);
    if (version === previous) return { release: false };
    if (Bun.semver.order(version, previous) <= 0) throw new Error(`A release must raise the version (${previous} → ${version})`);
    commit = git(cwd, "rev-parse", "HEAD");
  } else if (event === "workflow_dispatch") {
    version = parseVersion(input ?? "");
    commit = gitOptional(cwd, "rev-parse", "--verify", "--quiet", `refs/tags/v${version}^{commit}`);
    if (!commit) throw new Error(`v${version} must exist to be released again`);
    const named = sharedVersion(fromCommit(cwd, commit));
    if (named !== version) throw new Error(`v${version} names version ${named}`);
  } else {
    throw new Error(`Release 3DS runs on a push to main or by hand, not on ${event} of ${ref}`);
  }

  const tag = `v${version}`;
  const tagged = gitOptional(cwd, "rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`);
  if (tagged && tagged !== commit) throw new Error(`${tag} already points to ${tagged}`);
  if (!tagged && createTag) {
    git(cwd, "tag", tag, commit);
    // A tag pushed with GITHUB_TOKEN starts no other workflow run; this one
    // goes on to build the commit.
    git(cwd, "push", "origin", `refs/tags/${tag}`);
  }
  const since = previousTag(cwd, `${commit}^`);
  return {
    release: true, version, tag, commit, prerelease: isPrerelease(version),
    notes: changesMarkdown(commitsBetween(cwd, since, commit), since),
  };
}

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    if (args.some((arg) => arg !== "--create-tag")) throw new Error("Usage: bun scripts/release/identity.ts [--create-tag]");
    const { GITHUB_EVENT_NAME, GITHUB_REF, RELEASE_INPUT, RELEASE_BEFORE, GITHUB_OUTPUT } = process.env;
    const identity = releaseIdentity(resolve(import.meta.dir, "../.."), GITHUB_EVENT_NAME ?? "", GITHUB_REF ?? "", RELEASE_INPUT, args.includes("--create-tag"), RELEASE_BEFORE);
    if (GITHUB_OUTPUT) {
      let output = `release=${identity.release}\n`;
      if (identity.release) {
        const end = `NOTES_${crypto.randomUUID()}`;
        output += `version=${identity.version}\ntag=${identity.tag}\ncommit=${identity.commit}\nprerelease=${identity.prerelease}\nnotes<<${end}\n${identity.notes}\n${end}\n`;
      }
      appendFileSync(GITHUB_OUTPUT, output);
    }
    console.log(identity.release ? `Release ${identity.tag} from ${identity.commit}` : "The version did not change; nothing to release");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
