# Changelog

All notable changes to the `review-cycle` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-05-10

### Added

- `/review-cycle:init` skill — one-time setup helper. Verifies Codex CLI and `multi_agent` config, optionally appends the comment + fix-vs-defer policies to `~/.claude/CLAUDE.md` and/or `./CLAUDE.md`, and updates project `.gitignore` to exclude the per-project sentinel files (`.claude/.review-mark`, `.claude/.no-review-gate`). Idempotent — safe to run multiple times. Replaces the manual setup steps previously documented in the README.

## [0.3.0] - 2026-05-10

### Added

- Bundled the `de-slopify` skill at `skills/de-slopify/` (full skill including `references/` subdir). Invokable as `/review-cycle:de-slopify` for ad-hoc prose cleanup, or invoked automatically by the cycle's Phase 6.
- Source remains at [oakoss/agent-skills](https://github.com/oakoss/agent-skills); the bundled copy is a snapshot synced on each plugin release. Cross-agent skills.sh distribution stays at agent-skills; the plugin's copy makes review-cycle self-contained for Claude Code users.

### Changed

- Comment policy in the embedded skill bodies and `reference/policies.md` softened from "default to NO comments, only add when WHY is non-obvious" to "comments are fine; keep them clean and minimal." Same set of bad patterns flagged, but the default action shifts from "remove" to "trim/rewrite" for accurate-but-verbose cases. Aligns with how Opus 4.7 should actually write comments, not just how to suppress them.
- Cycle Phase 6 now invokes the bundled `/review-cycle:de-slopify` directly rather than relying on a user-level `de-slopify` installation.

### Notes

- If you have a user-level `de-slopify` skill installed at `~/.claude/skills/de-slopify/`, you can remove it after upgrading to this version — the plugin's namespaced copy supersedes it. Or keep both; they don't conflict.

## [0.2.0] - 2026-05-10

### Changed

- Codex review is now invoked directly via the `codex review --uncommitted` CLI rather than through the `/codex:review` slash command. The Codex Claude plugin is no longer a dependency — only the Codex CLI binary needs to be installed and authenticated. This simplifies the dependency graph and avoids edge cases around invoking skills with `disable-model-invocation: true` from inside other skills.
- Codex preflight check changed from `/codex:status` slash command to direct `codex --version` invocation.

### Notes

- This is the first step in the dependency-reduction roadmap. Subsequent versions will embed de-slopify (0.3.0) and migrate pr-review-toolkit subagents into this plugin (0.4.0).

## [0.1.2] - 2026-05-10

### Fixed

- Stop hook output no longer includes `hookSpecificOutput`, which is not a valid field for Stop hooks per Claude Code's runtime schema (only `PreToolUse`, `UserPromptSubmit`, `PostToolUse`, and `PostToolBatch` accept `hookSpecificOutput`). Directive content moved into the top-level `reason` field, with a short label in `systemMessage`. Previously the hook produced JSON that failed schema validation at runtime with "Hook JSON output validation failed".

## [0.1.1] - 2026-05-10

### Changed

- Renamed the main action skill from `cycle` to `review` to align with the Anthropic convention used by `pr-review-toolkit:review-pr` and improve discoverability in the `/` autocomplete. Invocation changed from `/review-cycle:cycle` to `/review-cycle:review`. All hook directives, documentation, and policy references updated accordingly.

## [0.1.0] - 2026-05-10

### Added

- Initial release.
- `/review-cycle:cycle` skill — full automated review loop with parallel Codex + pr-review-toolkit fan-out, fix-vs-defer policy, up to 4 iterations, and final de-slopify cleanup.
- `/review-cycle:inspect` skill — read-only inspection pass for sanity checks or pre-commit review.
- SessionStart hook to seed the per-project review sentinel idempotently on fresh session starts.
- Stop hook to gate turn-end on uncommitted-and-unreviewed changes.
- PreToolUse (Bash) hook to block `git commit` when the sentinel doesn't match the current state.
- Per-project opt-out via `.claude/.no-review-gate` and global kill-switch via `~/.claude/.disable-review-gate`.
- Embedded comment and fix-vs-defer policies inside the skills, with standalone copies in `reference/policies.md` for optional CLAUDE.md installation.
