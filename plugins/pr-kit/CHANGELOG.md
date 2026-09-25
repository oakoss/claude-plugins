# Changelog

All notable changes to the `pr-kit` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## 0.1.3 (2026-09-25)

### Fixed

`get-pr-comments` no longer drops review threads that are still open. It used to skip every thread GitHub marks outdated, but outdated means only that a later push changed the code the comment was left on, not that anyone resolved the thread. A thread that is outdated but unresolved now appears under **Possibly stale — verify**, located by its original line. Its thread query also pages now: it declares the `$endCursor` variable that `gh api --paginate` needs, so a PR with more than 100 threads is read in full, and a thread with more than 50 comments is read to the end with a follow-up query. (cpl-0ye)

`fix-merge-conflicts` checks the whole tree for leftover conflict markers. The old `git diff --cached --check` looked only at staged files, so it missed the file you forgot to stage, and it failed on trailing whitespace in a correctly resolved file. The skill now lists unmerged paths and runs `git grep` for marker lines over the whole repository, in both the working tree and the staged content, including diff3 base markers and a `conflict-marker-size` above 7. It names the conflicts that leave no markers (binary files, symlinks, and paths one side deleted or both sides renamed), which `git add` would otherwise resolve silently to whatever the working tree holds, and has you keep a side or drop the path explicitly and report it. It also says that a rebase swaps the sides. During `git rebase`, "ours" is the upstream and "theirs" is your own commit, so the skill has you check `git status` for `rebase in progress` before you pick a side. (cpl-r73)

pr-kit now has prose-anchor tests in `plugins/pr-kit/tests/` that pin these fixes and the contracts from the previous audit: the tree guard in `make-pr-easy-to-review`, the round cap in `fix-ci`, that no skill tells the model to invoke a skill with model invocation disabled, that every gh field a skill fills in is one it fetched, and that the README's `gh` requirement matches the skills that call `gh`. (cpl-k3s)

## 0.1.2 (2026-09-23)

### Fixed

`/pr-kit:fix-ci` no longer tells agents about review-cycle's sentinel or `/review-cycle:accept`, which review-cycle has removed. It now describes the new commit gate: a commit is admitted only if a reviewer saw exactly what it records and you asked for it, so the skill says not to edit between the review and the commit, and to ask you once, before the first commit, whether to commit and push the fixes.

## 0.1.1 (2026-09-17)

### Fixed

fix-ci no longer points at `/review-cycle:accept`, which is `disable-model-invocation: true` and exists for a human who reviewed the change themselves — instructing it both dead-ended the step and, if routed around, let the skill self-certify a fix it then pushed. The loop gains a hard cap of three rounds, or two on the same check: the previous same-check heuristic never fired when a fix for one check broke another, so an oscillation could write unbounded commits to a live PR. The merge-the-base guardrail now names its commands and uses the PR baseRefName instead of assuming main, and routes a conflict to /pr-kit:fix-merge-conflicts. The README no longer claims fix-ci stages and hands off; it commits and pushes each round by design, and now says so.

make-pr-easy-to-review now verifies a history rewrite before force-pushing. The tree captured before the rewrite is stored in a git ref rather than a shell variable, which does not survive between tool calls — so the byte-identical check had nothing to compare and the "do not push" rule never fired. The comparison no longer pits two command substitutions against each other either: that form passes when BOTH are empty, and command substitution discards git's exit code, so a git that is absent, shimmed, broken, or run outside a repository produced exit 0 with no output — byte-identical to a genuine pass. It now uses `--verify`, chains with `&&`, and prints `TREES MATCH <sha>`; the instruction is to push only on seeing that token, because a silent exit 0 is a failure rather than a pass. Measured: dead git exits 1, no git on PATH exits 127, outside a repository exits 128. Verification is now one command that works for same-repo and fork PRs alike, replacing a fallback with two failure modes on the fork PRs its surrounding section was written for: `fatal: ambiguous argument` when the head branch name is absent from the base repo, and — worse, because it is quiet — exit 0 with a phantom diff when the base repo happens to carry an unrelated branch of that name. The fork URL is built from headRepository.nameWithOwner rather than headRepositoryOwner, which is an object and produced a malformed URL. The push now states its lease explicitly, against the head recorded before the rewrite: the bare --force-with-lease reads a remote-tracking ref a freshly added fork remote does not have, and is rejected as `stale info` even when nothing is wrong. Measured — the explicit form succeeds with no tracking ref and still refuses when someone else pushed during the rewrite, leaving their commit intact. A `stale info` rejection now means stop and tell the user, never fetch and retry, which would refresh the lease to include their work and then overwrite it.

make-pr-easy-to-review no longer leaves three quieter ways for a history rewrite to reach a force-push unverified. The capture steps chain with `&&` and use `--verify`, so a failed fetch stops the run instead of recording the tree of a tracking ref nobody refreshed. The fork remote is named per PR and its URL confirmed before pushing: `git remote add` exits 3 when the name is taken, and the push then goes to whatever repository the leftover name refers to while the PR under work goes untouched. The exit 3 is measured; whether the lease also passes depends on that repository's branch happening to sit at the recorded sha, so the failure is a misdirected push rather than a guaranteed one. And the capture refs are cleared on abort as well as on success, with the invariant stated that they are written once per run from the fetched ref and never from HEAD, because re-capturing from HEAD after a blocked attempt certifies the rewrite against itself.

## [0.1.0] - 2026-05-28

Initial release. A pull-request workflow toolkit that complements `review-cycle` with PR-stage helpers. Every action that touches the remote or rewrites history stages and hands off, or asks first — nothing pushes or commits unreviewed.

### Added

- **`/pr-kit:get-pr-comments`** — fetches review and discussion comments on the active PR and returns a single prioritized action list grouped by severity and actionability. Read-only. Pairs with the fix-vs-defer policy: triage here, then address.
- **`/pr-kit:fix-merge-conflicts`** — resolves conflicts with minimal, correctness-first edits, regenerates lockfiles with package-manager tooling (never hand-edited), validates build/lint/tests, and **stages** the result. Never commits, pushes, or tags — it hands off to your review and commit gate.
- **`/pr-kit:make-pr-easy-to-review`** — improves reviewability without changing behavior: a TL;DR that matches the diff, separation of core vs generated files, and called-out risks. Commit-history rewrites and force-pushes are **gated behind explicit approval** and verified by tree identity; if the PR is too large to make reviewable with notes, it recommends splitting instead.
- **`/pr-kit:fix-ci`** — drives PR checks to green: watches the check set (`gh pr checks`), diagnoses the root failure, applies the smallest fix, then routes each fix through `/review-cycle:review` before committing and pushing. Retries flaky checks once with evidence, merges `main` for failures already fixed there rather than bloating the PR, and never bypasses hooks (`--no-verify`).

Generated by oakum 0.4.0.
