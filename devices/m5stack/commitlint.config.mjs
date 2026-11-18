// Conventional Commits: type(scope): summary. See AGENTS.md.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 72],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
