---
name: inspect
description: Run reviewers in parallel and report findings without applying fixes. Use for sanity checks, mid-implementation inspection, or to see what reviewers think before committing to a full cycle. Does NOT modify code, does NOT update the review sentinel, does NOT loop.
argument-hint: "[--base <ref>]"
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Agent, AskUserQuestion
---

# Review inspect

Read-only review pass. Runs the same reviewers as `/review-cycle:review` but does not apply fixes, does not loop, and does not update the review sentinel.

Use this when you want to see findings without committing to a fix cycle — for example, a mid-implementation sanity check, a pre-commit final inspection, or when you want to triage findings manually rather than letting the cycle decide.

## Argument parsing

`$ARGUMENTS` may contain:

- `--base <ref>` — scope review to `git diff <ref>..HEAD` instead of `git diff HEAD`

## Phases

### Phase 1: Preflight

Verify in a git repo:

```bash
git rev-parse --is-inside-work-tree
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

Verify uncommitted changes exist:

```bash
git status --porcelain --untracked-files=all
```

If empty, report "nothing to review" and stop.

Verify Codex CLI is available by running `codex --version`. If it fails, surface the error and continue with pr-review-toolkit only — note in the summary that Codex was skipped.

### Phase 2: Fan-out (parallel)

In a single conversation turn, invoke:

1. **Codex review (background)** — direct CLI invocation:

   ```
   Bash({
     command: "cd \"$PROJECT_ROOT\" && codex review --uncommitted",
     description: "Codex review",
     run_in_background: true
   })
   ```

   No dependency on the codex Claude plugin; uses the `codex` CLI directly. Multi-agent parallelism comes from `multi_agent = true` in `~/.codex/config.toml`.

2. **pr-review-toolkit (parallel mode)**: `/pr-review-toolkit:review-pr all parallel`

Wait for both to complete.

### Phase 3: Aggregate

Collect findings from both reviewers. Attribute sources. Group by file.

### Phase 4: Report

Print findings as a structured summary:

```
Review inspect complete.

Critical (N):
  - file:line — issue (source)
  - ...

Important (N):
  - file:line — issue (source)
  - ...

Suggestions (N):
  - file:line — issue (source)
  - ...

Strengths:
  - what's well-done in these changes
```

Then a "Next steps" block:

```
Next steps:
  - Address findings automatically: /review-cycle:review
  - Triage manually: edit files directly
  - Bypass the gate for this project: touch .claude/.no-review-gate
```

### Phase 5: Stop

Do NOT apply any fixes. Do NOT update the sentinel. Do NOT create tickets. Do NOT commit.

The Stop hook will still gate on unreviewed changes — `/review-cycle:inspect` does not satisfy the gate (because no review-cycle has run, no sentinel was updated). To clear the gate, either run `/review-cycle:review` or use the per-project opt-out marker.
