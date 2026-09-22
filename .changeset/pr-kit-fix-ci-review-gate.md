---
pr-kit: patch
---

`/pr-kit:fix-ci` no longer tells agents about review-cycle's sentinel or `/review-cycle:accept`, which review-cycle has removed. It now describes the new commit gate: a commit is admitted only if a reviewer saw exactly what it records and you asked for it, so the skill says not to edit between the review and the commit, and to ask you once, before the first commit, whether to commit and push the fixes.
