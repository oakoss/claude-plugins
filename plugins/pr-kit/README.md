# pr-kit

A pull-request workflow toolkit for Claude Code.

## What it does

`pr-kit` covers the work that happens *around* a pull request: reading reviewer feedback, resolving merge conflicts, making a diff easy to review, and driving CI to green. It is the post-push companion to [`review-cycle`](../review-cycle):

- **`review-cycle`** — local, pre-commit quality gate on your uncommitted changes.
- **`pr-kit`** — PR-stage helpers, after the branch is pushed.

Every skill that would touch the remote or rewrite history is **gate-aware**: it stages and hands off, or asks first. Nothing commits, pushes, or force-pushes unreviewed. If you also run `review-cycle`, fixes route through `/review-cycle:review` before they are committed.

All skills are invoked as bare slash commands and take natural-language arguments — no flags.

## Skills

### `/pr-kit:get-pr-comments`

Resolves the active PR, fetches review and discussion comments, and returns one prioritized action list grouped by severity and actionability, plus any open questions. Read-only — it changes nothing. Feed its output into the fix-vs-defer policy to decide what to address inline.

### `/pr-kit:fix-merge-conflicts`

Resolves conflicts with minimal, correctness-first edits — preferring both sides when safe, otherwise the variant that compiles and preserves public behavior. Lockfiles are regenerated with the package manager, never hand-edited. Runs build/lint/relevant tests, then **stages** the resolved files and summarizes the decisions. Never commits, pushes, or tags.

### `/pr-kit:make-pr-easy-to-review`

Makes a PR easy to review without changing behavior: a TL;DR that matches the actual diff, core files separated from generated/mechanical ones, and risks/migration/rollout called out. Commit-history cleanup and force-push are **gated behind explicit approval**, planned first, and verified by comparing the tree before and after so a "cleanup" can never silently change code. If the PR is too large to make reviewable with notes, it recommends splitting instead.

### `/pr-kit:fix-ci`

Drives PR checks to green. Watches the check set with `gh pr checks` (the source of truth — it covers all attached checks, not just GitHub Actions), diagnoses the root failure, and applies the smallest safe fix. Each fix routes through `/review-cycle:review` before it is committed and pushed, so CI fixes are reviewed like any other change. Retries a flaky check once with evidence, and if a failure is unrelated to the PR and already green on `main`, merges `main` rather than bloating the diff. Never bypasses hooks.

## Requirements

- **GitHub CLI (`gh`)**, authenticated — all four skills resolve the active PR and read checks/comments through `gh`.
- **`review-cycle`** is recommended but not required. When present, `fix-ci` routes fixes through `/review-cycle:review`; without it, `fix-ci` still stages fixes for you to review before pushing.

## Relationship to other tools

Inspired by the PR-workflow skills in Cursor's `cursor-team-kit`, rewritten to be gate-aware and to fit the no-unreviewed-commit model that `review-cycle` enforces.
