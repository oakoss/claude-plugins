---
name: review
description: Run the full automated code review cycle on uncommitted changes. Fans out Codex and pr-review-toolkit reviewers in parallel, applies fixes inline per the embedded policies, loops up to 4 iterations until clean, then runs de-slopify cleanup on prose. Updates the review sentinel on completion. Does NOT commit.
argument-hint: "[--max-iter N] [--base <ref>]"
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Write, MultiEdit, Glob, Grep, Agent, AskUserQuestion, Skill
---

# Review cycle

Automated multi-agent review cycle on uncommitted changes. Invoke manually with `/review-cycle:review` or via the Stop hook when uncommitted-and-unreviewed changes exist.

## Embedded policies

The following two policies apply throughout this cycle. Standalone copies live in `${CLAUDE_PLUGIN_ROOT}/reference/policies.md` if you want them active outside this cycle (paste into `~/.claude/CLAUDE.md` for global scope or `./CLAUDE.md` for project scope).

### Comment policy

Comments are useful when they add value. Keep them clean and minimal.

A good comment:

- Is accurate (matches the code; remove if stale)
- Earns its place (explains WHY or non-obvious context, not WHAT)
- Is concise (one or two lines unless documenting a complex invariant)

Avoid:

- Restating what the code does
- Section markers like `// ===== HELPERS =====`
- Hedge words, apologies, "obviously", "basically", "just"
- "Note:" / "Important:" prefixes when surrounding text already conveys importance
- TODOs without ticket references
- Cross-references that belong in the PR description ("added for X", "used by Y")
- Multi-line comments on trivial code
- AI-flavored phrasings ("Here we...", "Let's...", "This...")

When in doubt: keep the comment, but make it tighter.

### Fix-vs-defer policy

Default to fixing inline. Defer to a follow-up only if:

- The fix is substantially more work than writing the follow-up itself
- The fix requires architectural changes spanning files outside this PR scope
- The fix requires a new dependency or schema migration not in this PR
- The fix would invalidate unrelated tests

If you can describe the fix in one sentence, just do the fix.

## Argument parsing

`$ARGUMENTS` may contain:

- `--max-iter N` — override max iteration count (default 4)
- `--base <ref>` — scope review to `git diff <ref>..HEAD` instead of `git diff HEAD`

Parse before starting the cycle. If absent, use defaults.

## Cycle phases

### Phase 1: Preflight

Resolve the project root and verify the working state:

```bash
git rev-parse --is-inside-work-tree
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

If not in a git repo, print a clear error and stop.

Check for changes:

```bash
git status --porcelain --untracked-files=all
```

If empty, report "nothing to review" and stop.

Verify Codex CLI is available:

```bash
codex --version
```

If the command fails or codex is unauthenticated, surface the error and stop — do not silently skip it.

### Phase 2: Fan-out (parallel)

In a single conversation turn, invoke ALL of the following:

1. **Codex review (background)** — direct CLI invocation, not the `/codex:review` slash command:

   ```
   Bash({
     command: "cd \"$PROJECT_ROOT\" && codex review --uncommitted",
     description: "Codex review",
     run_in_background: true
   })
   ```

   - Uses the `codex` CLI directly; no dependency on the codex Claude plugin
   - The user has `multi_agent = true` enabled in `~/.codex/config.toml`, so Codex spawns parallel review agents internally during a single review call
   - Returns immediately with a bash shell ID; output streams to the task output file
   - Save the shell ID; you'll read its output later when notified of completion

2. **pr-review-toolkit (parallel mode)**: `/pr-review-toolkit:review-pr all parallel`
   - The toolkit handles its own conditional dispatch based on what's in the diff
   - Spawns Claude subagents for code, tests, errors, types, and comments as applicable
   - Returns when all subagents complete

De-slopify is the FINAL cleanup pass at the end of the cycle, not part of the fan-out.

Wait for both reviewers to finish before proceeding.

### Phase 3: Aggregate findings

Collect findings from both reviewers:

- Codex output is structured: `verdict`, `summary`, `findings[]` each with `severity` (critical/high/medium/low), `file`, `line_start`, `line_end`, `confidence`, `recommendation`
- pr-review-toolkit output is markdown organized as Critical / Important / Suggestions / Strengths

Attribute each finding to its source. Group by file when presenting. Do not aggressively dedupe — if two reviewers flag the same line, merge them into one bullet with both sources listed.

### Phase 4: Apply fixes per policy

For each finding, apply the fix-vs-defer policy:

- Default to fixing inline
- Defer only if a criterion above is met
- Critical and high severity findings should almost always be fixed inline; deferring a critical finding requires a strong, defensible justification

When fixing, follow the comment policy — do not add comments that restate the code or describe the fix itself.

Track fixed items and deferred items separately for the final summary. Do not auto-create beads or trekker tickets for deferred findings — just list them in the summary; the user decides.

### Phase 5: Loop check

After applying fixes:

- If ANY inline fixes were applied AND iteration count < max-iter → GOTO Phase 2 (re-run reviewers against the new state)
- If NO inline fixes were applied (everything was clean or correctly deferred) → exit loop
- If iteration count == max-iter → exit loop with summary of remaining findings

### Phase 6: Final de-slopify cleanup

Invoke the bundled de-slopify skill on prose surfaces in modified files:

```
Skill(review-cycle:de-slopify)
```

Scope:

- Comments in modified code
- Modified `.md` files
- Any commit message drafts (if generated)

Do NOT apply de-slopify to algorithm logic, type definitions, or test assertions — those should stay exactly as written.

This catches AI-flavored phrasings, formulaic patterns, and other slop that may have been introduced during fix iterations. The bundled skill is at `plugins/review-cycle/skills/de-slopify/` — no external dependency on a user-level `de-slopify`.

### Phase 7: Update sentinel

Write the review sentinel atomically:

```bash
mkdir -p "$PROJECT_ROOT/.claude"
SENTINEL="$PROJECT_ROOT/.claude/.review-mark"

if command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD="sha256sum"
else
  SHA_CMD="shasum -a 256"
fi

HASH=$(cd "$PROJECT_ROOT" && git status --porcelain --untracked-files=all | $SHA_CMD | cut -d' ' -f1)
TMP="${SENTINEL}.tmp.$$"
echo "$HASH" > "$TMP" && mv "$TMP" "$SENTINEL"
```

The sentinel updating is what allows the Stop hook and commit-gate to let the user commit.

### Phase 8: Final summary

Print a structured summary:

```
Review cycle complete.

Iterations: N / max
Findings fixed inline: X
  - file:line — issue (source)
  - ...

Findings deferred: Y
  - file:line — issue (source)
    reason: <criterion from fix-vs-defer policy>
  - ...

Final state: clean / N findings remain
```

### Phase 9: Stop

Do NOT run `git commit`. The user is the final reviewer before commit. The commit-gate hook will block a commit attempt anyway, but you should not attempt one regardless.

The Stop hook will see the sentinel now matches the current state and allow the turn to end naturally.

## Things to NOT do

- Do NOT run `git commit`. The user owns the commit decision.
- Do NOT silently skip Codex if it fails. Surface the error.
- Do NOT auto-create beads or trekker tickets for deferred findings.
- Do NOT touch the opt-out marker (`.claude/.no-review-gate`) programmatically. The user controls it.
- Do NOT modify the sentinel except at Phase 7, after a complete successful cycle.
- Do NOT add comments to code while fixing. The comment policy applies to fix code, not just original code.
