# Changelog

All notable changes to the `review-cycle` plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1] - 2026-05-12

Security and robustness fixes for issues found by running `/review-cycle:review` against the 0.6.0 release before broader adoption. **Users on 0.6.0 should upgrade immediately** — 0.6.0 contained a gate bypass.

### Security

- **Staged-content bypass closed.** The hash now captures both `git diff --cached <anchor>` (anchor → index) and `git diff` (index → working tree) per file, sorted by path. The 0.6.0 implementation used only `git diff <anchor>` (anchor → working tree), so a user could stage unreviewed content, restore the working tree to the reviewed state, and then commit — slipping unreviewed bytes past the gate. Per-path iteration also keeps the hash byte-stable across staging-state changes, so moving reviewed content between staged and unstaged does not drift.

### Fixed

- **`match` subcommand exit codes distinguish error from no-match.** Now exits 2 on real errors (missing sha tool, not in work tree, pipeline failure) and 1 only on actual no-match. The 0.6.0 implementation collapsed all failures to exit 1, breaking `session-init`'s ability to detect a misconfigured environment.
- **Silent failure in legacy-hash migration.** `session-init` now emits a stderr warning when the 0.5.x→0.6.0 migration cannot compute the legacy hash (e.g., missing sha256sum/shasum). Previously the failure was swallowed and the user was left permanently gated with no breadcrumb.
- **Anchor type validation.** Sentinel anchors are now checked via `git cat-file -t` and must resolve to a commit or tree object. The previous `cat-file -e` accepted any object (including blobs and tags), which would have produced a meaningless hash.
- **Pipefail and PIPESTATUS checks** on the hash compute pipeline. A mid-pipeline `git diff` crash now surfaces as a compute error instead of silently producing a valid-looking but wrong hash.

## [0.6.0] - 2026-05-12

> ⚠️ **Withdrawn**: this release contained a gate bypass via staged content. Upgrade to 0.6.1.

### Fixed

- **Multi-commit drift after a single review.** Previously every `git commit` advanced HEAD and shrank the diff the sentinel hashed against, so the gate flagged drift even when no unreviewed content had been introduced. Reviewing a batch and then splitting it into N commits required N reviews. The sentinel now pins (anchor SHA, diff-from-anchor hash) instead of (diff-from-HEAD hash), so committing already-reviewed content does not invalidate the sentinel — the cumulative anchor→working-tree diff stays the same regardless of how many of the reviewed hunks have been committed.

### Changed

- **Sentinel format is now two lines:** `anchor:<40-hex>` (HEAD SHA at mark time, or the empty-tree SHA `4b825dc6…` for unborn HEAD) and `sha256:<64-hex>` (hash of `git diff <anchor>` plus untracked file contents). Migration from 0.5.x is automatic via `session-init` on next startup, with lossless upgrade when the working tree still matches the previously-reviewed state.
- **New `match` subcommand on `bin/review-sentinel`.** Used by `session-init` to decide whether to advance the anchor; differs from `check` in that it does not treat a clean tree as a pass. `check` and `match` together replace the prior pattern of comparing `current-hash` output against the raw sentinel file.
- **`current-hash` output is now two lines** (`anchor:` then `sha256:`) to match the on-disk format. Anyone scripting against the old single-line output will need to update.

### Migrated

- **Single 0.5.x → 0.6.0 migration block** in `session-init.sh` replaces the previous 0.5.0 → 0.5.1 block. Detects any pre-0.6.0 sentinel (bare hex or `sha256:`-prefixed), computes the legacy hash against current state, and re-seeds in the new format only when they match (lossless upgrade). When they don't match, the old sentinel is preserved so the gate fires on the unreviewed drift.

### Behavior unchanged

- The four hooks (`session-init`, `stop-gate`, `commit-gate`, `posttool-slop`) keep their existing semantics. Only `session-init` changed; the others just call `review-sentinel check`.
- Clean-tree fast-path is preserved: `check` still exits 0 on a working tree with no changes regardless of stored sentinel content.

## [0.5.2] - 2026-05-12

### Changed

- **`review`, `cleanup`, and `inspect` are now model-invocable.** The commit-gate hook is the actual boundary against unreviewed commits, so blocking model invocation on these skills only created an incoherent flow: the Stop hook would tell Claude to invoke `/review-cycle:review`, and Claude couldn't. `accept` (gate bypass) and `init` (meta-setup) remain user-only.

## [0.5.1] - 2026-05-11

### Changed

- **Gate state is now factored into a shared CLI (`bin/review-sentinel`) and a sourced lib (`hooks/lib/gate.sh`).** The four hooks (`session-init`, `stop-gate`, `commit-gate`, `posttool-slop`) each shrink to their actual decision logic; preconditions and sentinel I/O live in one place. `/review-cycle:accept` and Phase 7 also call the CLI instead of re-implementing hash computation inline. The sentinel path (`${PROJECT_ROOT}/.claude/.review-mark`) is unchanged; existing sentinels self-heal on the next `startup` session.

- **Hash now captures content changes, not just file-level state.** Previously the sentinel hashed `git status --porcelain --untracked-files=all` only, so editing an already-modified file (without adding new files) didn't update the hash — the gate would pass when it shouldn't. The new computation concatenates porcelain status, `git diff --cached --binary`, `git diff --binary`, and the contents of untracked files. Splitting staged+unstaged (vs. `git diff HEAD`) covers repos without an initial commit; staged content in unborn repos now correctly contributes to the hash. Subsequent edits to the same file also correctly drift the sentinel.

- **`session-init` re-seeds on `startup` only when the prior state was reviewed.** Re-seeds when the sentinel is missing (first install; pre-existing WIP becomes the baseline) or when the sentinel matches the current state (idempotent refresh). If the sentinel disagrees with the current state, the previous session left unreviewed work; `session-init` keeps the old sentinel and lets Stop/commit gates do their job. `/clear`, `/compact`, and resume events are not `startup` events and don't fire this hook. Trade-off: dependency bumps or IDE edits between sessions now require a one-time `/review-cycle:accept` or `/review-cycle:review` to re-baseline, but quit-and-restart with WIP no longer silently absorbs unreviewed changes.

- **Clean working tree always passes `check`.** The sentinel CLI exits 0 on a clean tree regardless of the stored hash, eliminating the post-commit re-block loop where the user would have to run `/accept` after every commit just to clear the gate.

### Fixed

- **One-time migration from 0.5.0 sentinel format.** 0.5.0 wrote a bare 64-char hex hash; 0.5.1 writes `sha256:<hex>`. On the first 0.5.1 `startup` session that finds an old-format sentinel, `session-init` re-seeds it. This restores self-heal for the upgrade path without absorbing in-session unreviewed work on subsequent restarts.
- **`hooks/posttool-slop.sh`: comment-slop findings rendered with literal `\n` instead of newlines.** Pre-existing bug from 0.5.0 — the `FINDINGS` variable used `"\n\n"` inside double quotes (which doesn't interpret escapes) and jq propagated those as `\\n` into Claude's `additionalContext`. Switched to `$'\n'` so the rendered context is actually newline-separated and readable.
- **`hooks/posttool-slop.sh`: now bails when the modified file is outside any git repo**, matching the scope of the other three hooks. Previously it would inject context for orphan files.
- **`bin/review-sentinel`: defense-in-depth git work-tree check** in `compute_current_hash`. If a refactor ever calls it with a non-repo path, it now returns nonzero instead of silently producing the empty-tree hash and reporting "clean".
- **`bin/review-sentinel`: `read_sentinel` warns to stderr and returns nonzero** on malformed content. Callers can now distinguish missing from corrupted (`check` still treats corrupted as drift; the warning surfaces in the next hook output).
- **`bin/review-sentinel`: `write_sentinel` forwards underlying error to stderr.** Previously `2>/dev/null` swallowed permission/disk-full/path errors silently. The mkdir, write, and rename now each capture stderr and emit a specific message before returning. Temp file is cleaned up on write or rename failure.
- **`hooks/session-init.sh`: strict re-seed.** Only re-seeds when the sentinel exactly matches the current hash (idempotent refresh) or is missing (first install). Previously the conditional piggybacked on `check`'s clean-tree exit-0, which let a transient `git stash` or `git checkout` overwrite a prior-session sentinel with the empty-tree hash. The strict version preserves the prior sentinel as evidence whenever current state diverges.

### Added

- **`/review-cycle:init` now preflights `jq`, `git`, and a sha256 tool** (`sha256sum` or `shasum`). Previously a machine missing any of these would silently fail-open at every hook — the gate would appear to be doing nothing for no obvious reason. Each missing tool now surfaces a clear install hint in the init summary.

- **Bats smoke suite** at `tests/`. Covers the sentinel CLI (seed/mark/check/paths, clean-tree, drift detection, format validation, exit codes) and the gate lib (kill-switch, opt-out marker, project-root resolution chain, composite check). Run with `tests/run.sh`, which wraps bats with a post-suite cleanup to work around a known hang on macOS.

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
