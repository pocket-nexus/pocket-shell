// SPDX-License-Identifier: GPL-3.0-or-later
// Written by icons.gen.ts. The paths are whole literals because the compiler
// bakes the images a bundle names.
export const ICONS = {
  "issue-open": { green: "art/kit/issue-open-green.svg", muted: "art/kit/issue-open-muted.svg" },
  "issue-closed": { purple: "art/kit/issue-closed-purple.svg", muted: "art/kit/issue-closed-muted.svg" },
  "issue-skip": { muted: "art/kit/issue-skip-muted.svg" },
  "pr-open": { green: "art/kit/pr-open-green.svg", muted: "art/kit/pr-open-muted.svg" },
  "pr-merged": { purple: "art/kit/pr-merged-purple.svg" },
  "pr-closed": { red: "art/kit/pr-closed-red.svg" },
  "pr-draft": { muted: "art/kit/pr-draft-muted.svg" },
  "repo": { muted: "art/kit/repo-muted.svg", accent: "art/kit/repo-accent.svg" },
  "star": { muted: "art/kit/star-muted.svg", text: "art/kit/star-text.svg" },
  "star-fill": { yellow: "art/kit/star-fill-yellow.svg" },
  "fork": { muted: "art/kit/fork-muted.svg" },
  "commit": { muted: "art/kit/commit-muted.svg", green: "art/kit/commit-green.svg" },
  "branch": { muted: "art/kit/branch-muted.svg", accent: "art/kit/branch-accent.svg" },
  "tag": { muted: "art/kit/tag-muted.svg", green: "art/kit/tag-green.svg" },
  "check": { green: "art/kit/check-green.svg", text: "art/kit/check-text.svg" },
  "check-circle": { green: "art/kit/check-circle-green.svg" },
  "x-circle": { red: "art/kit/x-circle-red.svg" },
  "dot-run": { yellow: "art/kit/dot-run-yellow.svg" },
  "clock": { muted: "art/kit/clock-muted.svg" },
  "bell": { muted: "art/kit/bell-muted.svg", accent: "art/kit/bell-accent.svg" },
  "search": { muted: "art/kit/search-muted.svg", accent: "art/kit/search-accent.svg", text: "art/kit/search-text.svg" },
  "file": { muted: "art/kit/file-muted.svg" },
  "folder": { accent: "art/kit/folder-accent.svg" },
  "play": { muted: "art/kit/play-muted.svg", accent: "art/kit/play-accent.svg" },
  "gear": { muted: "art/kit/gear-muted.svg" },
  "comment": { muted: "art/kit/comment-muted.svg" },
  "person": { muted: "art/kit/person-muted.svg", accent: "art/kit/person-accent.svg" },
  "code": { muted: "art/kit/code-muted.svg" },
  "lock": { muted: "art/kit/lock-muted.svg" },
  "eye": { muted: "art/kit/eye-muted.svg", text: "art/kit/eye-text.svg" },
  "plus": { accent: "art/kit/plus-accent.svg", text: "art/kit/plus-text.svg" },
  "chevron": { faint: "art/kit/chevron-faint.svg" },
  "back": { accent: "art/kit/back-accent.svg" },
  "mail": { muted: "art/kit/mail-muted.svg" },
  "gist": { muted: "art/kit/gist-muted.svg", accent: "art/kit/gist-accent.svg" },
} as const;

export type IconName = keyof typeof ICONS;
/** An icon in one of the colours it comes in: `ICONS["pr-open"].green`. */
export type IconSrc = { [K in IconName]: (typeof ICONS)[K][keyof (typeof ICONS)[K]] }[IconName];
