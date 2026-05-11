---
name: accept
description: Mark the current uncommitted state as reviewed by updating the review sentinel. Use when you've manually reviewed the substance of your changes and want to commit without running the full /review-cycle:review cycle. Per-state escape hatch, lighter than the project-wide .claude/.no-review-gate opt-out marker.
disable-model-invocation: true
allowed-tools: Bash
---

# Accept current state as reviewed

Updates the review sentinel at `${PROJECT_ROOT}/.claude/.review-mark` to match the current uncommitted state. The Stop hook and commit-gate will then pass for this exact state.

Use cases:

- You've manually reviewed your changes and don't want to run the full cycle
- You ran `/review-cycle:cleanup` and want to commit without running reviewers
- You've made small changes you don't want gated, but don't want to disable the gate project-wide

## Execution

```bash
# Resolve project root
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "Error: not inside a git repository."
  exit 1
}

# Compute current state hash
if command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_CMD="shasum -a 256"
else
  echo "Error: no sha256sum or shasum available."
  exit 1
fi

HASH=$(cd "$PROJECT_ROOT" && git status --porcelain --untracked-files=all | $SHA_CMD | cut -d' ' -f1)

# Atomic write to sentinel
mkdir -p "$PROJECT_ROOT/.claude"
SENTINEL="$PROJECT_ROOT/.claude/.review-mark"
TMP="${SENTINEL}.tmp.$$"
echo "$HASH" > "$TMP" && mv "$TMP" "$SENTINEL"

echo "Marked current state as reviewed."
echo "Sentinel: $SENTINEL"
echo "Hash: $HASH"
echo ""
echo "The commit gate will pass for this exact state. Any further edits will re-trigger the gate."
```

## Edge cases

- **Not in a git repo**: print error, do not modify anything.
- **Working tree clean (no changes)**: still safe to run; sentinel reflects the empty-diff state. The commit gate will pass trivially.
- **Sentinel already matches**: writing the same hash is harmless. Idempotent.

## What this skill does NOT do

- Does NOT run any reviewers. If you want a full review before accepting, use `/review-cycle:review` (which auto-updates the sentinel at Phase 7).
- Does NOT modify any code. Sentinel-only.
- Does NOT bypass the per-project opt-out marker. If `.claude/.no-review-gate` exists, hooks ignore the sentinel anyway.

## Composition

```
/review-cycle:cleanup   → tidy up edits
/review-cycle:accept    → mark as reviewed
git commit              → gate passes, commit succeeds
```

vs the full cycle:

```
/review-cycle:review    → fan out reviewers, apply fixes, cleanup, update sentinel
git commit              → gate passes, commit succeeds
```
