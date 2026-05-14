# review-cycle

Automated multi-agent code review cycle for Claude Code, with hook-driven gates that prevent unreviewed commits.

## What it does

After you implement changes, `review-cycle` fans out parallel reviewers, applies fixes per embedded policies, loops until clean, runs a final de-slopify cleanup, and updates a sentinel that signals "this state has been reviewed." A Stop hook automatically prompts you to invoke the cycle when uncommitted changes haven't been reviewed yet. A commit gate hook prevents `git commit` on unreviewed changes — Claude cannot bypass it.

## Architecture

```
Implement changes
       ↓
Stop hook fires when you finish a turn
       ↓
  Sentinel matches current diff?
       │
       ├── Yes → allow turn to end
       │
       └── No → block with "invoke /review-cycle:review"
              ↓
        /review-cycle:review runs
              ↓
        ┌─────┴─────┐
        ↓           ↓
   Codex review    pr-review-toolkit
   (multi-agent)   (parallel subagents)
        └─────┬─────┘
              ↓
        Aggregate findings
              ↓
        Apply fixes per CLAUDE.md policy
              ↓
        Loop (up to 4 iterations)
              ↓
        De-slopify cleanup (prose only)
              ↓
        Atomic sentinel write
              ↓
        Summary → stop (no commit)
              ↓
You review the diff and commit yourself
```

## Skills

### `/review-cycle:init`

One-time setup helper. Run after installing the plugin to:

- Verify Codex CLI is installed and `multi_agent = true` is set in `~/.codex/config.toml`
- Optionally append the comment and fix-vs-defer policies to your global or project `CLAUDE.md`
- Update project `.gitignore` to exclude `.claude/.review-mark` (auto-managed state)

Idempotent — safe to run multiple times. Replaces the manual setup steps below.

### `/review-cycle:review`

The action loop. Fans out reviewers, applies fixes, loops until clean (max 4 iterations by default), final de-slopify pass, updates sentinel.

Arguments:

- `--max-iter N` — override iteration cap (default 4)
- `--base <ref>` — scope review to `git diff <ref>..HEAD` instead of `git diff HEAD`

### `/review-cycle:inspect`

Read-only inspection. Same reviewers, no fixes, no loop, no sentinel update. Use for mid-implementation sanity checks or pre-commit final review.

Arguments:

- `--base <ref>` — same as above

### `/review-cycle:cleanup`

Spawns the bundled `cleanup` subagent on the current diff. Applies the comment policy (clean and minimal) and de-slopify methodology in a single pass. Edits files directly; returns a summary. Does NOT update the review sentinel — use `/review-cycle:accept` after if you want to satisfy the commit gate.

### `/review-cycle:accept`

Marks the current uncommitted state as reviewed by updating the review sentinel. Use when you've manually reviewed the substance of your changes and want to commit without running the full cycle. Per-state escape hatch (lighter than the project-wide `disabled: true` opt-out).

### `/review-cycle:de-slopify`

Bundled de-slopify skill — methodology for removing AI writing artifacts from prose. Authored separately at [oakoss/agent-skills](https://github.com/oakoss/agent-skills); bundled here so the plugin is self-contained. The cleanup subagent preloads this skill, so the cycle uses it automatically. Invokable directly for ad-hoc cleanup of prose outside the cycle.

## Subagents (bundled)

Migrated verbatim from Anthropic's pr-review-toolkit (Apache 2.0; see `LICENSE-pr-review-toolkit` and `NOTICE`):

- `review-cycle:code-reviewer` — general quality + CLAUDE.md compliance
- `review-cycle:silent-failure-hunter` — error handling, swallowed errors
- `review-cycle:type-design-analyzer` — type invariants, encapsulation
- `review-cycle:pr-test-analyzer` — test coverage gaps

New (this plugin):

- `review-cycle:cleanup` — comment policy + de-slopify in one pass

## Hooks (active when plugin is enabled)

### SessionStart

Seeds the per-project sentinel at session startup. Re-seeds only when the sentinel is missing (first install — treats pre-existing WIP as "already reviewed") or when the sentinel still matches the current state (idempotent refresh). If the sentinel disagrees with the current state, the previous session left unreviewed work — startup keeps the old sentinel so the Stop and commit gates can do their job. Only fires on `source: "startup"` events, not `/clear`, `/compact`, or `resume`.

Side effect: dependency bumps or IDE edits between Claude sessions (after a clean commit) will be detected as drift on the next startup. Run `/review-cycle:accept` (or `/review-cycle:review`) once to re-baseline. The alternative silently absorbed unreviewed in-progress work into the new baseline whenever Claude was quit.

### Stop

Fires when Claude finishes a turn. If there are uncommitted changes whose hash doesn't match the sentinel, blocks with a directive to invoke `/review-cycle:review`. Fail-open on any error.

### PreToolUse (Bash matcher)

Fires before any Bash command. If the command is `git commit` and the sentinel doesn't match the current state, blocks the commit. This is the deterministic enforcement layer — Claude cannot bypass it with a CLAUDE.md rule or memory.

## Required configuration

Two Codex settings:

1. **Codex CLI installed and authenticated**:

   ```bash
   npm install -g @openai/codex
   codex login
   ```

   Only the Codex CLI binary is required; the Codex Claude plugin is not a dependency.

2. **Multi-agent enabled** in `~/.codex/config.toml`:

   ```toml
   [features]
   multi_agent = true
   ```

This lets Codex spawn parallel review agents internally during a single `codex review` call, replacing the need for multiple sequential Codex invocations.

## Recommended configuration

### Add the policies to your global CLAUDE.md

The skills embed the comment and fix-vs-defer policies, so the cycle itself works without setup. But if you want the same policies active outside the cycle (when Claude is implementing code or addressing a single PR comment), copy the snippets from `reference/policies.md` into `~/.claude/CLAUDE.md`.

### Per-project config: `.claude/review-cycle.json`

A single JSON config file controls project-level behavior. All fields are optional:

```json
{
  "disabled": false,
  "ignore": [
    "dist/**",
    "generated/**",
    "tests/fixtures/large-corpora/**"
  ]
}
```

- `disabled: true` opts the project out of all gates.
- `ignore: [...]` extends the built-in exclusion list with project-specific pathspec-glob patterns. Additive; built-ins still apply.

The file is meant to be committed so a team gets the same gate behavior. `jq` is required to read it. Malformed JSON falls back to defaults (gate active, no extra ignores); the gate fails open on `disabled` and fails closed on `ignore` so a typo can't accidentally disable review.

### Migrating from `.no-review-gate`

The legacy `touch .claude/.no-review-gate` marker is still honored indefinitely as a fallback. There is no auto-migration: the old marker was typically gitignored (local-only opt-out) while `review-cycle.json` is meant to be committed (team-wide), and silently converting one to the other could publish an opt-out unintentionally.

To consolidate manually:

```bash
# write the new config explicitly (and commit it if you want team-wide)
echo '{"disabled": true}' > .claude/review-cycle.json
rm .claude/.no-review-gate
```

### Default exclusions

The gate skips paths that are state or preferences rather than reviewable code, so working in them won't force a review:

- Agent task trackers: `.beads/`, `.trekker/`
- IDE state: `.vscode/`, `.idea/`, `.zed/`, `.cursor/`, `.fleet/`
- Gate's own state: `.claude/.review-mark`, plus the legacy `.claude/.no-review-gate` marker (still recognized indefinitely as a fallback)

Exclusion is anchored at the repo root; a nested `subproject/.beads/` is still hashed. `/review-cycle:review` still works manually against excluded paths if you want a pass.

### Adding new `ignore` patterns

Editing `.claude/review-cycle.json` itself drifts the sentinel by design: the config file is force-included in the hash and cannot be excluded by any pattern (including `**`). The flow is:

1. Edit `.claude/review-cycle.json` and add the patterns you want
2. Run `/review-cycle:review` once; reviewers see the config change (and any matching source edits) and you mark
3. From now on, changes within the new patterns don't trip the gate

This prevents an unreviewed config edit from silently hiding source drift.

### Global kill-switch

Emergency disable for all hooks (use if something goes wrong):

```bash
touch ~/.claude/.disable-review-gate
```

Remove the file to re-enable.

### Gitignore the sentinel

The sentinel is per-project state, not source. Add to your project's `.gitignore`:

```
.claude/.review-mark
```

The config file (`.claude/review-cycle.json`) is meant to be committed so the team gets consistent gate behavior. Don't gitignore it.

## State files

```
${PROJECT}/.claude/.review-mark          two-line sentinel (anchor + sha256)
${PROJECT}/.claude/review-cycle.json     per-project config (disabled, ignore)
${PROJECT}/.claude/.no-review-gate       legacy opt-out marker (still honored)
~/.claude/.disable-review-gate           global kill-switch (user-touched)
```

## Troubleshooting

**Hooks don't fire after install.**
Run `/reload-plugins`. If still nothing, check `claude --debug` for hook registration errors. Verify hook scripts are executable (`ls -l plugins/review-cycle/hooks/`).

**Infinite loop / Claude can't stop.**
Touch the global kill-switch immediately: `touch ~/.claude/.disable-review-gate`. Then file an issue with hook output. The sentinel-based gate should prevent this, but the kill-switch is the safety net.

**Stop hook fires on every turn even after running the cycle.**
The cycle didn't successfully write the sentinel. Check `${PROJECT}/.claude/.review-mark` exists and contains a `sha256:<hex>` line. Re-run `/review-cycle:review` — it should write the sentinel as its final step.

**Codex is missing or not authenticated.**
The cycle surfaces this and stops. Install with `npm install -g @openai/codex`, then `codex login`. Verify `multi_agent = true` in `~/.codex/config.toml`.

**False trigger on a project I don't want gated.**
Write `{"disabled": true}` to `.claude/review-cycle.json` in that project root.

## Local development

To test changes to this plugin:

```bash
git clone https://github.com/oakoss/claude-plugins
cd claude-plugins
claude --plugin-dir ./plugins/review-cycle
```

Then `/reload-plugins` to pick up subsequent edits without restarting.

## License

MIT — see `LICENSE`.
