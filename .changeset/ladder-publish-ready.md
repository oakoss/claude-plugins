---
review-cycle: minor
---

Package publishes are now the release step of Stop before: `npm publish` (and abbreviations such as `npm pub`), `pnpm publish` (with `-r`, `recursive` or `--filter`), `yarn npm publish`, `yarn publish`, `bun publish`, `cargo publish` and `oakum release`, wherever they stand in the command (`pnpm exec oakum release`, `~/.cargo/bin/cargo publish`). A dry run of npm, pnpm, bun or cargo (`--dry-run`, or cargo's `-n`) runs as before, unless a later `--no-dry-run` or a `false` value turns it off; Yarn's dry run counts as a release. A package script such as `pnpm release`, and anything after `npm run`, is still not read. "publish it" or "publish the package to npm" asks for a release, and a message that mentions publishing holds the step, as release words do. Package words stay with publishing: "push to npm" asks for no git push, and "publish the branch", an editor's name for a first push, asks for no release.

Marking a draft pull request ready for review is now the pull request step: `gh pr ready` (but not `gh pr ready --undo`), the GitHub MCP `update_pull_request` with `draft: false`, and the GraphQL `markPullRequestReadyForReview`. "mark it ready for review" or "ready for review" asks for it, and a mention of a pull request being ready for review holds the steps.

A refusal for a command the gate cannot read now says it "cannot tell which step it takes", since it covers publishes as well as gh, and one that does not parse asks for it to be written so it parses.
