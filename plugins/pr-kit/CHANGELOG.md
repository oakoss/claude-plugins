# Changelog

All notable changes to the `pr-kit` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

Generated by oakum 0.3.1.
