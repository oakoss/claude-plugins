# pr-kit

A pull-request workflow toolkit for Claude Code.

## What it does

`pr-kit` covers the work that happens _around_ a pull request: reading reviewer feedback, resolving merge conflicts, making a diff easy to review, and driving CI to green. It is the post-push companion to [`review-cycle`](../review-cycle):

- **`review-cycle`** — local, pre-commit quality gate on your uncommitted changes.
- **`pr-kit`** — PR-stage helpers, after the branch is pushed.

Every skill that would touch the remote or rewrite history is **gate-aware**: nothing commits, pushes, or force-pushes unreviewed. If you also run `review-cycle`, fixes route through `/review-cycle:review` before they are committed.

`ship` pushes and opens the pull request because asking it to ship is the request for both; with review-cycle installed, "ship it" is what lets its gate allow them. `fix-ci` is the other exception, and deliberately so: getting CI green requires pushing, so invoking it authorizes committing and pushing each round. With review-cycle installed, its gate needs your yes before the first push, so fix-ci asks once. Every fix still goes through review first, and the loop stops after three rounds, or two on the same check. `make-pr-easy-to-review` rewrites history only after an explicit yes.

All skills are invoked as bare slash commands and take natural-language arguments — no flags.

## Skills

### `/pr-kit:get-pr-comments`

Resolves the active PR, fetches review and discussion comments, and returns one prioritized action list grouped by severity and actionability, plus any open questions. Read-only — it changes nothing. Feed its output into the fix-vs-defer policy to decide what to address inline.

### `/pr-kit:fix-merge-conflicts`

Resolves conflicts with minimal, correctness-first edits — preferring both sides when safe, otherwise the variant that compiles and preserves public behavior. Lockfiles are regenerated with the package manager, never hand-edited. Runs build/lint/relevant tests, then **stages** the resolved files and summarizes the decisions. Never commits, pushes, or tags.

### `/pr-kit:make-pr-easy-to-review`

Makes a PR easy to review without changing behavior: a TL;DR that matches the actual diff, core files separated from generated/mechanical ones, and risks/migration/rollout called out. Commit-history cleanup and force-push are **gated behind explicit approval**, planned first, and verified by comparing the tree before and after so a "cleanup" can never silently change code. If the PR is too large to make reviewable with notes, it recommends splitting instead.

### `/pr-kit:fix-ci`

Drives PR checks to green. Watches the check set with `gh pr checks` (the source of truth — it covers all attached checks, not just GitHub Actions), diagnoses the root failure, and applies the smallest safe fix. Each fix routes through `/review-cycle:review` before it is committed and pushed, so CI fixes are reviewed like any other change. Retries a flaky check once with evidence, and if a failure is unrelated to the PR and already green on the base branch, merges the base in rather than bloating the diff. Stops after three rounds, or two on the same check. Never bypasses hooks.

### `/pr-kit:ship`

Takes the current branch to a pull request. Say "ship it" to publish, or "push it" once one is open. It reviews and commits leftover work, merges in the default branch when behind, runs the project's full checks and stops on a failure, pushes, closes the beads the branch finishes and pushes the task graph, then writes the title and body. A refused push stops it before any bead is closed. The body follows the repository's own `PULL_REQUEST_TEMPLATE.md` when there is one, else [`reference/pr-body.md`](reference/pr-body.md): a short lead, one line per change, the checks that ran and what they printed, and known issues. On an open pull request it rewrites the body for the whole branch, since that body becomes the squash commit. It opens drafts, arms auto-merge, and adds agent attribution only when asked, and stops on a repository that is not yours.

On a layer of a [github/gh-stack](https://github.com/github/gh-stack) stack, it merges nothing into the layer, offers `gh stack rebase --no-trunk` when a layer is missing commits from the one below, runs the checks on the top layer, then pushes every layer and opens each missing pull request with `gh stack submit`. It asks first when that would open pull requests for layers above yours, leaves new layers as drafts when any layer is a draft or you asked for drafts, and writes each new pull request's title, body, closed beads and known issues from that layer's own commits.

## Requirements

- **GitHub CLI (`gh`)**, authenticated — four of the five skills resolve the active PR and read checks/comments through `gh`. `fix-merge-conflicts` is purely local and needs no `gh`.
- **`review-cycle`** is recommended but not required. When present, `fix-ci` routes fixes through `/review-cycle:review`; without it, `fix-ci` shows you each diff and waits for your OK before pushing.

## Relationship to other tools

Inspired by the PR-workflow skills in Cursor's `cursor-team-kit`, rewritten to be gate-aware and to fit the no-unreviewed-commit model that `review-cycle` enforces.
