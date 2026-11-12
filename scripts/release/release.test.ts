// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { releaseIdentity } from "./identity.ts";
import { parseArgs, prepareRelease } from "./prepare.ts";
import {
  bumpVersion, changesMarkdown, fromTree, git, inferBump, parseVersion, selectVersion, sharedVersion,
  VERSION_FILES, withVersion, type Commit,
} from "./version.ts";

const ROOT = resolve(import.meta.dir, "../..");
const commit = (subject: string, body = ""): Commit => ({ sha: "0123456789abcdef0123456789abcdef01234567", subject, body });

test("versions are SemVer without build metadata; a v prefix is dropped", () => {
  expect(parseVersion("0.2.0")).toBe("0.2.0");
  expect(parseVersion("v0.2.0")).toBe("0.2.0");
  expect(parseVersion("0.3.0-rc.1")).toBe("0.3.0-rc.1");
  for (const value of ["", "1.2", "1.2.3.4", "01.2.3", "1.02.3", "1.2.3+build", "1.2.3/other", " 1.2.3", "vv1.2.3"]) {
    expect(() => parseVersion(value)).toThrow();
  }
});

test("a bump raises one component and resets the lower ones; a pre-release needs an exact version", () => {
  expect(bumpVersion("0.2.9", "patch")).toBe("0.2.10");
  expect(bumpVersion("0.2.9", "minor")).toBe("0.3.0");
  expect(bumpVersion("0.2.9", "major")).toBe("1.0.0");
  expect(() => bumpVersion("0.3.0-rc.1", "patch")).toThrow();
});

test("auto reads Conventional Commits; below 1.0.0 a breaking change raises the minor", () => {
  expect(inferBump([commit("fix(3ds): a"), commit("build(3ds): b")])).toBe("patch");
  expect(inferBump([commit("fix(3ds): a"), commit("feat(desktop): b")])).toBe("minor");
  expect(inferBump([commit("feat(3ds)!: a")])).toBe("major");
  expect(inferBump([commit("refactor: a", "BREAKING CHANGE: b")])).toBe("major");
  expect(selectVersion("0.1.0", "auto", "major")).toBe("0.2.0");
  expect(selectVersion("1.4.2", "auto", "major")).toBe("2.0.0");
  expect(selectVersion("0.1.0", "auto", "patch")).toBe("0.1.1");
  expect(selectVersion("0.1.0", "minor", "patch")).toBe("0.2.0");
  expect(selectVersion("0.2.0", "0.3.0-rc.1", "patch")).toBe("0.3.0-rc.1");
  expect(selectVersion("0.3.0-rc.1", "0.3.0", "patch")).toBe("0.3.0");
  for (const requested of ["0.1.0", "0.0.9", "0.1.0-rc.1"]) expect(() => selectVersion("0.1.0", requested, "patch")).toThrow();
});

test("a version is written in place and every version file agrees", () => {
  const text = '{\n  "id": "x",\n  "version": "0.1.0",\n  "app": { "min": [320, 240], "version": "9.9.9" }\n}\n';
  expect(withVersion(text, "0.2.0")).toBe(text.replace('"version": "0.1.0"', '"version": "0.2.0"'));
  expect(() => withVersion('{ "app": { "version": "1.0.0" } }', "0.2.0")).toThrow();
  expect(sharedVersion(fromTree(ROOT))).toBe(parseVersion(JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version));
  const files: Record<string, string> = Object.fromEntries(VERSION_FILES.map((path) => [path, '{ "version": "0.2.0" }']));
  files["shells/touch/pocket.app.json"] = '{ "version": "0.1.0" }';
  expect(() => sharedVersion((path) => files[path]!)).toThrow(/shells\/touch\/pocket\.app\.json: 0\.1\.0/);
});

test("the release command takes one bump or version", () => {
  expect(parseArgs([])).toEqual({ requested: "auto", dryRun: false });
  expect(parseArgs(["minor", "--dry-run"])).toEqual({ requested: "minor", dryRun: true });
  expect(parseArgs(["v0.3.0"])).toEqual({ requested: "0.3.0", dryRun: false });
  for (const args of [["0.3"], ["patch", "minor"], ["--draft"]]) expect(() => parseArgs(args)).toThrow();
});

test("changes are grouped and linked", () => {
  const notes = changesMarkdown([commit("feat(3ds): a"), commit("fix(touch)!: b"), commit("docs: c")], "v0.1.0");
  expect(notes).toContain("## Changes since v0.1.0");
  expect(notes).toMatch(/### Features\n\n- feat\(3ds\): a \(\[01234567\]\(https:\/\/github\.com\/pocket-nexus\/pocket-shell\/commit\/0123456789abcdef/);
  expect(notes).toContain("### Fixes\n\n- fix(touch)!: b");
  expect(notes).toContain("### Other changes\n\n- docs: c");
  expect(changesMarkdown([], "v0.1.0")).toBe("No source changes since v0.1.0.");
});

// A repository with every version file, a calendar tag and a bare origin.
const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repository(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pocket-shell-release-"));
  scratch.push(dir);
  const origin = join(dir, "origin.git");
  const work = join(dir, "work");
  git(dir, "init", "--quiet", "--bare", origin);
  git(dir, "init", "--quiet", "-b", "main", work);
  git(work, "config", "user.name", "Release Test");
  git(work, "config", "user.email", "release@example.invalid");
  git(work, "config", "commit.gpgsign", "false");
  git(work, "config", "tag.gpgsign", "false");
  git(work, "remote", "add", "origin", origin);
  for (const path of VERSION_FILES) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), `{\n  "name": "${path}",\n  "version": "${version}",\n  "list": [1, 2]\n}\n`);
  }
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "feat(3ds): the first launcher");
  git(work, "tag", "v2026.11.12");
  git(work, "commit", "--quiet", "--allow-empty", "-m", "feat(3ds)!: Pocket Link 2");
  git(work, "commit", "--quiet", "--allow-empty", "-m", "fix(3ds): a fix");
  git(work, "push", "--quiet", "origin", "main", "--tags");
  return work;
}

const head = (work: string) => git(work, "rev-parse", "HEAD");

test("prepare raises every version file from the commits since the last tag", () => {
  const work = repository("0.1.0");
  const plan = prepareRelease(work, "auto");
  expect(plan).toMatchObject({ current: "0.1.0", version: "0.2.0", inferred: "major", since: "v2026.11.12" });
  expect(plan.commits.map((c) => c.subject)).toEqual(["feat(3ds)!: Pocket Link 2", "fix(3ds): a fix"]);
  expect(sharedVersion(fromTree(work))).toBe("0.2.0");
  expect(readFileSync(join(work, "shells/3ds/shell/pocket.app.json"), "utf8")).toContain('"list": [1, 2]');
  git(work, "checkout", "--quiet", "--", ".");
  git(work, "tag", "v0.1.1");
  expect(() => prepareRelease(work, "patch")).toThrow(/v0\.1\.1 already exists/);
});

test("a merged release pull request tags its merge commit; other pushes release nothing", () => {
  const work = repository("0.1.0");
  const before = head(work);
  prepareRelease(work, "minor");
  git(work, "commit", "--quiet", "-am", "chore(release): v0.2.0");
  const merged = head(work);
  const identity = releaseIdentity(work, "push", "refs/heads/main", undefined, true, before);
  expect(identity).toMatchObject({ release: true, version: "0.2.0", tag: "v0.2.0", commit: merged, prerelease: false });
  if (!identity.release) throw new Error("expected a release");
  expect(identity.notes).toContain("## Changes since v2026.11.12");
  expect(identity.notes).not.toContain("chore(release)");
  expect(git(work, "ls-remote", "--tags", "origin", "v0.2.0")).toStartWith(merged);
  // A rerun finds its own tag.
  expect(releaseIdentity(work, "push", "refs/heads/main", undefined, true, before)).toMatchObject({ release: true, commit: merged });

  git(work, "commit", "--quiet", "--allow-empty", "-m", "fix(3ds): later");
  expect(releaseIdentity(work, "push", "refs/heads/main", undefined, true, merged)).toEqual({ release: false });
  const after = head(work);
  for (const path of VERSION_FILES) writeFileSync(join(work, path), readFileSync(join(work, path), "utf8").replace("0.2.0", "0.1.5"));
  git(work, "commit", "--quiet", "-am", "chore(release): v0.1.5");
  expect(() => releaseIdentity(work, "push", "refs/heads/main", undefined, false, after)).toThrow(/must raise/);
});

test("a manual run releases an existing tag again and nothing else", () => {
  const work = repository("0.1.0");
  const before = head(work);
  prepareRelease(work, "0.2.0-rc.1");
  git(work, "commit", "--quiet", "-am", "chore(release): v0.2.0-rc.1");
  const tagged = head(work);
  releaseIdentity(work, "push", "refs/heads/main", undefined, true, before);
  git(work, "commit", "--quiet", "--allow-empty", "-m", "fix(3ds): after the tag");
  expect(releaseIdentity(work, "workflow_dispatch", "refs/heads/main", "v0.2.0-rc.1")).toMatchObject({
    release: true, version: "0.2.0-rc.1", commit: tagged, prerelease: true,
  });
  expect(() => releaseIdentity(work, "workflow_dispatch", "refs/heads/main", "0.3.0")).toThrow(/must exist/);
  expect(() => releaseIdentity(work, "pull_request", "refs/pull/1/merge")).toThrow();
});
