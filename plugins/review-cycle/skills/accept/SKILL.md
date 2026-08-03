---
name: accept
description: Mark the current uncommitted state as reviewed by updating the review sentinel. Use when you've manually reviewed the substance of your changes and want to commit without running the full /review-cycle:review cycle. Per-state escape hatch, lighter than the project-wide .claude/.no-review-gate opt-out marker.
disable-model-invocation: true
allowed-tools: Bash
---

# Accept current state as reviewed

Updates the review sentinel so the Stop hook and commit-gate will pass for this exact state. The sentinel is `${PROJECT_ROOT}/.claude/.review-mark`, atomically written.

Use cases:

- You've manually reviewed your changes and don't want to run the full cycle
- You ran `/review-cycle:de-slopify` and want to commit without running reviewers
- You've made small changes you don't want gated, but don't want to disable the gate project-wide

## Execution

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" mark
```

Report the exit code to the user:

- Exit 0: sentinel updated. The commit gate will pass for this exact state. Any further edits will re-trigger the gate.
- Exit 1: not inside a git repository.
- Exit 2: sha256 tool not available.

## Edge cases

- **Not in a git repo**: CLI exits 1. Report to user; do not modify anything.
- **Working tree clean (no changes)**: sentinel records the empty-state hash. The commit gate passes trivially. Safe.
- **Sentinel already matches**: writing the same hash is idempotent.

## What this skill does NOT do

- Does NOT run any reviewers. For a full review before accepting, use `/review-cycle:review` (which auto-updates the sentinel at Phase 8).
- Does NOT modify any code. Sentinel-only.
- Does NOT bypass the per-project opt-out marker. If `.claude/.no-review-gate` exists, hooks ignore the sentinel anyway.

## Composition

```
/review-cycle:de-slopify   → tidy up prose
/review-cycle:accept       → mark as reviewed
git commit                 → gate passes, commit succeeds
```

Mark and commit may also be chained in one Bash call, in exactly this shape — a bare `mark` (no `--root`) joined to `git commit` by `&&` with nothing in between:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" mark && git commit -m "..."
```

Looser chains are denied by the gate: `;`, `||`, or a bare newline as the separator, any command between mark and commit, git options on the chained commit (`git -C <path> commit`, `git -c k=v commit`), or more than one `git commit` in the same Bash call. When in doubt, run mark and commit as separate Bash calls.

vs the full cycle:

```
/review-cycle:review    → fan out reviewers, apply fixes, cleanup, update sentinel
git commit              → gate passes, commit succeeds
```
