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

### `/review-cycle:review`

The action loop. Fans out reviewers, applies fixes, loops until clean (max 4 iterations by default), final de-slopify pass, updates sentinel.

Arguments:

- `--max-iter N` — override iteration cap (default 4)
- `--base <ref>` — scope review to `git diff <ref>..HEAD` instead of `git diff HEAD`

### `/review-cycle:inspect`

Read-only inspection. Same reviewers, no fixes, no loop, no sentinel update. Use for mid-implementation sanity checks or pre-commit final review.

Arguments:

- `--base <ref>` — same as above

### `/review-cycle:de-slopify`

Bundled de-slopify skill — removes AI writing artifacts from prose surfaces (comments, README files, commit messages, docs). Authored separately at [oakoss/agent-skills](https://github.com/oakoss/agent-skills) and bundled here so the plugin works without external skill dependencies.

The cycle invokes this automatically in its final cleanup phase. You can also invoke it directly for ad-hoc prose cleanup.

## Hooks (active when plugin is enabled)

### SessionStart

Seeds the per-project sentinel once at session startup. Treats pre-existing WIP as "already reviewed" so you don't get nagged about changes you made before installing this plugin. Re-seeds only on fresh startups (not `/clear`, not `/resume`, not auto-compaction). Idempotent — won't overwrite an existing sentinel.

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

### Opt out per project

If a project shouldn't be gated (scratch repos, throwaway experiments):

```bash
touch .claude/.no-review-gate
```

All three hooks check for this file and exit cleanly if present.

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
.claude/.no-review-gate
```

## State files

```
${PROJECT}/.claude/.review-mark          sha256 of last-reviewed git state
${PROJECT}/.claude/.no-review-gate       per-project opt-out (user-touched)
~/.claude/.disable-review-gate           global kill-switch (user-touched)
```

## Troubleshooting

**Hooks don't fire after install.**
Run `/reload-plugins`. If still nothing, check `claude --debug` for hook registration errors. Verify hook scripts are executable (`ls -l plugins/review-cycle/hooks/`).

**Infinite loop / Claude can't stop.**
Touch the global kill-switch immediately: `touch ~/.claude/.disable-review-gate`. Then file an issue with hook output. The sentinel-based gate should prevent this, but the kill-switch is the safety net.

**Stop hook fires on every turn even after running the cycle.**
The cycle didn't successfully write the sentinel. Check `${PROJECT}/.claude/.review-mark` exists and contains a 64-char hex hash. Re-run `/review-cycle:review` — it should write the sentinel as its final step.

**Codex is missing or not authenticated.**
The cycle surfaces this and stops. Install with `npm install -g @openai/codex`, then `codex login`. Verify `multi_agent = true` in `~/.codex/config.toml`.

**False trigger on a project I don't want gated.**
`touch .claude/.no-review-gate` in that project root.

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
