# Changelog

All notable changes to the `review-cycle` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-05-11

### Added

- **PostToolUse comment-slop detector** (`hooks/posttool-slop.sh`). Fires after `Write`, `Edit`, or `MultiEdit` and scans the modified file for high-confidence comment-slop patterns. When detected, returns `hookSpecificOutput.additionalContext` so Claude addresses them on the next turn. Does NOT block — the write already happened; this is informational reinforcement of the comment policy in real time.

  Patterns flagged:
  - Section markers (`// ===== HELPERS =====`)
  - Restate-the-code verbs at start of comment (`// fetches the user`)
  - AI-flavored phrasings (`// Here we ...`, `// Let's ...`, `// This function does ...`)
  - Hedge prefixes (`// Note:`, `// Important:`, `// NB:`)
  - TODO/FIXME without ticket reference (skipped if `#123`, `ABC-123`, or URL follows)
  - Hedge words in comments (`obviously`, `basically`, `simply`, `just`, `actually`)

  Limits: skips binary/lock/build-artifact paths and files over 1MB. Respects the global kill-switch and per-project opt-out marker like the other hooks. Catches the comment patterns Opus 4.7 most often introduces mid-implementation — supplements the cycle's end-of-cycle cleanup with real-time intervention.

## [0.4.2] - 2026-05-10

### Fixed

- commit-gate now correctly resolves the project root when the Bash command is `cd <path> && git commit ...`. Previously, the hook ran `git rev-parse --show-toplevel` from the session cwd (not the cd target), so if the user ran from `$HOME` and cd'd into a project inline, `PROJECT_ROOT` resolved empty and the hook exited 0 fail-open instead of blocking. Now the hook parses a leading `cd <path>` from the command, expands `~`, falls back to the hook input's `cwd` field, then to `CLAUDE_PROJECT_DIR`, then to the shell cwd. Confirmed end-to-end: `git commit` from a different cwd now correctly produces the documented deny.
- Verified that bypassPermissions mode does NOT override hook deny decisions (was an earlier incorrect hypothesis — proven false by a hard-deny test).

## [0.4.1] - 2026-05-10

### Fixed

- commit-gate hook now produces output matching the documented PreToolUse schema. The hook was using the deprecated top-level `decision: "block"` / `reason` fields, which PreToolUse no longer honors (silently treated as "no decision," letting `git commit` through). Switched to `hookSpecificOutput.permissionDecision: "deny"` per the current docs. The hook now actually blocks unreviewed commits — confirmed in isolation with a realistic JSON input. Same class of bug as the Stop hook schema fix in 0.1.2.

## [0.4.0] - 2026-05-10

### Added

- Embedded 4 subagents from Anthropic's pr-review-toolkit at `agents/`:
  - `code-reviewer.md`
  - `silent-failure-hunter.md`
  - `type-design-analyzer.md`
  - `pr-test-analyzer.md`

  Invoked under the plugin namespace as `review-cycle:<agent-name>`. Copied verbatim from `anthropics/claude-plugins-public`; license preserved at `LICENSE-pr-review-toolkit`; attribution in `NOTICE`. The `code-simplifier` and `comment-analyzer` agents are intentionally not migrated (see NOTICE for reasoning).

- New `cleanup` subagent at `agents/cleanup.md`. Preloads the bundled de-slopify skill via the `skills` frontmatter and applies both the comment policy and de-slopify methodology in a single pass. Edits files directly; returns a structured summary.

- New `/review-cycle:cleanup` skill — thin wrapper around the cleanup subagent for `/`-invocable ad-hoc tidy-ups.

- New `/review-cycle:accept` skill — updates the review sentinel to mark the current state as reviewed without running the full cycle. Per-state escape hatch for "I've manually reviewed, let me commit" flows.

### Changed

- Cycle Phase 2 fan-out now spawns each pr-review-toolkit-style subagent directly via the Agent tool with `run_in_background: true`, instead of invoking `/pr-review-toolkit:review-pr all parallel`. Conditional dispatch (code-reviewer always; test/error/type analyzers based on diff scope) moves into the cycle skill's prose. No external slash-command dependency for review agents.
- Cycle Phase 6 cleanup now spawns the `cleanup` subagent instead of invoking the de-slopify skill directly. The cleanup agent owns both the comment policy and the de-slopify application in a single phase.
- Inspect Phase 2 mirrors the same direct-Agent-invocation pattern.

### Notes

- This release drops the runtime dependency on the pr-review-toolkit plugin. The Codex CLI is still required (already true since 0.2.0). The plugin is now fully self-contained for its review work.
- Roadmap remaining: v0.5.0 — PostToolUse hook for real-time comment-slop intervention (optional).

## [0.3.2] - 2026-05-10

### Changed

- Tightened the `/review-cycle:init` summary output. Replaced the bracketed two-column status format (`[✓|⚠|✗] Codex CLI: ...`) with single-glyph leading status (`✓ Codex CLI: ...`). Avoids wrapping in narrow terminals and reads more scannably.

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
