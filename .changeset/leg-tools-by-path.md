---
review-cycle: patch
---

Reviewer legs now run no command that installs first. In a JavaScript project they run the project's tools by path (`node_modules/.bin/<tool>`) in their private copies, not through the package manager: in a copy without `node_modules`, `pnpm <script>` and `pnpm exec` install first and run the project's install hooks there, which on pnpm 12 ran lefthook's postinstall in a leg's copy. `/review-cycle:review-pr` legs copy `node_modules` from the main checkout, since the pull request's worktree has none, so when the pull request changes a JavaScript lockfile or a `package.json`'s dependencies, the briefs and the report's new `Dependencies:` line say that results depending on them are inferred.
