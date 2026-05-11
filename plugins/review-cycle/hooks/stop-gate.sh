#!/usr/bin/env bash
# review-cycle: Stop hook
#
# Blocks Claude from finishing a turn if uncommitted-and-unreviewed changes
# exist. Tells Claude to invoke /review-cycle:review. Fail-open on any error.

# Global kill-switch
[ -f "$HOME/.claude/.disable-review-gate" ] && exit 0

INPUT=$(cat 2>/dev/null || true)

# Belt-and-suspenders reentrancy: if Claude Code sets stop_hook_active, respect
# it. The sentinel-based gate below is the primary defense.
if echo "$INPUT" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

# Resolve project root
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$PROJECT_ROOT" ]; then
  PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
fi
[ -z "$PROJECT_ROOT" ] && exit 0

# Per-project opt-out
[ -f "$PROJECT_ROOT/.claude/.no-review-gate" ] && exit 0

# Must be a git repo
git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Pick a sha256 tool
if command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_CMD="shasum -a 256"
else
  exit 0
fi

# Compute current state hash
CURRENT_HASH=$(cd "$PROJECT_ROOT" && git status --porcelain --untracked-files=all 2>/dev/null | $SHA_CMD 2>/dev/null | cut -d' ' -f1)

# Empty hash → no changes → allow stop
EMPTY_HASH=$(echo -n "" | $SHA_CMD 2>/dev/null | cut -d' ' -f1)
if [ -z "$CURRENT_HASH" ] || [ "$CURRENT_HASH" = "$EMPTY_HASH" ]; then
  exit 0
fi

# Read sentinel, validate as 64-char hex
SENTINEL="$PROJECT_ROOT/.claude/.review-mark"
LAST_HASH=""
if [ -f "$SENTINEL" ]; then
  LAST_HASH=$(cat "$SENTINEL" 2>/dev/null | tr -d '[:space:]')
  echo "$LAST_HASH" | grep -qE '^[a-f0-9]{64}$' || LAST_HASH=""
fi

# Match means changes were already reviewed → allow stop
[ "$CURRENT_HASH" = "$LAST_HASH" ] && exit 0

# Block with directive. Fallback printf preserves block decision if jq fails.
# Stop hook output schema does NOT support hookSpecificOutput — all directive
# content goes in the top-level `reason` field.
jq -n '{
  decision: "block",
  reason: "BLOCKED: There are uncommitted changes that have not been reviewed. You MUST invoke /review-cycle:review now before attempting to stop again. The cycle will fan out reviewers, apply fixes per its embedded policies, and update the review sentinel. Do not commit; the user is the final reviewer.",
  systemMessage: "review-cycle: changes unreviewed"
}' 2>/dev/null || printf '{"decision":"block","reason":"Uncommitted changes have not been reviewed. Run /review-cycle:review.","systemMessage":"review-cycle: changes unreviewed"}\n'

exit 0
