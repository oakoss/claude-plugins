# Changelog

All notable changes to the `pr-kit` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-28

Initial release. A pull-request workflow toolkit that complements `review-cycle` with PR-stage helpers. Every action that touches the remote or rewrites history stages and hands off, or asks first — nothing pushes or commits unreviewed.

### Added

- **`/pr-kit:get-pr-comments`** — fetches review and discussion comments on the active PR and returns a single prioritized action list grouped by severity and actionability. Read-only. Pairs with the fix-vs-defer policy: triage here, then address.
- **`/pr-kit:fix-merge-conflicts`** — resolves conflicts with minimal, correctness-first edits, regenerates lockfiles with package-manager tooling (never hand-edited), validates build/lint/tests, and **stages** the result. Never commits, pushes, or tags — it hands off to your review and commit gate.
- **`/pr-kit:make-pr-easy-to-review`** — improves reviewability without changing behavior: a TL;DR that matches the diff, separation of core vs generated files, and called-out risks. Commit-history rewrites and force-pushes are **gated behind explicit approval** and verified by tree identity; if the PR is too large to make reviewable with notes, it recommends splitting instead.
- **`/pr-kit:fix-ci`** — drives PR checks to green: watches the check set (`gh pr checks`), diagnoses the root failure, applies the smallest fix, then routes each fix through `/review-cycle:review` before committing and pushing. Retries flaky checks once with evidence, merges `main` for failures already fixed there rather than bloating the PR, and never bypasses hooks (`--no-verify`).
