---
name: review
description: Run the full automated code review cycle on uncommitted changes. Fans out Codex and pr-review-toolkit reviewers in parallel, applies fixes inline per the embedded policies, loops up to 4 iterations until clean, then runs de-slopify cleanup on prose. Updates the review sentinel on completion. Does NOT commit.
argument-hint: "[--max-iter N] [--base <ref>]"
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

2. **Bundled review subagents (parallel)** — spawn each applicable agent via the `Agent` tool with `run_in_background: true` in the same single message as the codex invocation. Conditional dispatch based on diff scope (decided in Phase 1):

   - `review-cycle:code-reviewer` — always
   - `review-cycle:pr-test-analyzer` — if diff touches `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`, or similar test paths
   - `review-cycle:silent-failure-hunter` — if diff touches error-handling code (try/catch, `Result<`, `.catch(`, error returns)
   - `review-cycle:type-design-analyzer` — if diff adds or modifies type declarations (interfaces, structs, classes, type aliases)

   Each spawn pattern:

   ```
   Agent({
     subagent_type: "review-cycle:code-reviewer",
     description: "Code review of uncommitted changes",
     run_in_background: true,
     prompt: "Review uncommitted changes in <PROJECT_ROOT>. Output findings as file:line — severity — issue — suggested fix."
   })
   ```

   All applicable agents fire in parallel. Auto-notification on completion — do not poll.

Cleanup (Phase 6) handles de-slopify and comment policy at end of cycle, not part of the fan-out.

Wait for the codex bash output AND every spawned subagent to complete before proceeding.

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

### Phase 6: Cleanup

Spawn the cleanup subagent to apply the comment policy and de-slopify methodology in a single pass:

```
Agent({
  subagent_type: "review-cycle:cleanup",
  description: "Final cleanup pass — comments + de-slopify",
  prompt: "Run cleanup on the current diff (post-fix state). Apply comment policy to modified code comments and de-slopify to prose surfaces. Do not touch algorithm logic, type definitions, or test assertions."
})
```

The cleanup agent has de-slopify preloaded via its `skills` frontmatter, so it handles both lenses in one invocation. It edits files directly and returns a summary of changes.

Scope of cleanup (the agent enforces this):

- Comments in modified code
- Modified `.md` files
- Any commit message drafts (if generated)

Excluded from cleanup:

- Algorithm logic
- Type definitions
- Test assertions

### Phase 7: Update sentinel

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" mark
```

This is what allows the Stop hook and commit-gate to let the user commit. If the CLI exits nonzero (not in a git repo, sha256 tool missing), surface the error in the final summary — do not silently succeed.

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
