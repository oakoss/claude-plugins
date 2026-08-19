#!/usr/bin/env bash
# review-cycle: Stop hook
#
# Blocks Claude from finishing a turn if uncommitted-and-unreviewed changes
# exist. Tells Claude to invoke /review-cycle:review. Fail-open on any error.
#
# Two release valves keep the block from degrading into ceremony:
#
#   - A fresh .claude/.review-in-progress marker (written by the review
#     cycle at fan-out) lets the turn end while background reviewers run,
#     so their completion notifications can re-wake the agent instead of
#     the agent burning wall-clock on sleep loops. A stale marker (crashed
#     cycle, older than the TTL) is removed and ignored.
#   - The gate blocks once per drift state. The state hash it blocked on
#     is recorded; a later stop on the identical state soft-passes with a
#     warning instead of re-blocking, so a user-directed "review later"
#     cannot hard-loop. The commit gate still blocks unreviewed commits —
#     this only relaxes WHEN review happens, never WHETHER.

source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/gate.sh"

INPUT=$(cat 2>/dev/null || true)

# Belt-and-suspenders reentrancy. The sentinel-based gate below is primary.
if echo "$INPUT" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

PROJECT_ROOT=$(gate_should_run) || exit 0

STOP_RECORD="$PROJECT_ROOT/.claude/.review-stop-block"

# Either cycle marker lets a turn end: /review's, and /review-pr's, which
# reviews a PR head in a throwaway worktree. Only the former licenses `mark`
# (see marker_for in bin/review-sentinel) — the Stop gate does not care which
# tree is under review, but the sentinel does.
for MARKER in .review-in-progress .review-pr-in-progress; do
  [ -f "$PROJECT_ROOT/.claude/$MARKER" ] || continue
  gate_marker_is_stale "$PROJECT_ROOT/.claude/$MARKER" || exit 0
  # Stale or unreadable marker: a crashed cycle must not hold the gate open.
  # A failed removal is deliberately ignored — this hook's stderr surfaces
  # nowhere, and the check above re-reaps on the next stop regardless.
  /bin/rm -f "$PROJECT_ROOT/.claude/$MARKER" 2>/dev/null
done

"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$PROJECT_ROOT" check
RC=$?
if [ "$RC" -eq 0 ]; then
  # Clean or reviewed: the recorded blocked-state is resolved, so the next
  # drift gets a fresh block.
  /bin/rm -f "$STOP_RECORD" 2>/dev/null
  exit 0
fi
[ "$RC" -eq 2 ] && exit 0  # error: fail-open

# RC=1 → drift.
CURRENT=$("${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$PROJECT_ROOT" current-hash 2>/dev/null)
# An empty CURRENT (near-impossible: check just computed the same hash) must
# not degrade block-once into the hard loop the reason text promises can't
# happen — a fallback token keeps the second stop soft-passing.
[ -n "$CURRENT" ] || CURRENT="unknown-state"
if [ -f "$STOP_RECORD" ] && [ "$(cat "$STOP_RECORD" 2>/dev/null)" = "$CURRENT" ]; then
  jq -n '{systemMessage:"review-cycle: unreviewed changes (already prompted for this state; commit gate still active)"}' 2>/dev/null \
    || printf '{"systemMessage":"review-cycle: unreviewed changes (already prompted for this state; commit gate still active)"}\n'
  exit 0
fi

# Record the state being blocked so the same state is not re-blocked. The
# one path that still re-blocks every stop is an unwritable .claude dir.
mkdir -p "$PROJECT_ROOT/.claude" 2>/dev/null
printf '%s\n' "$CURRENT" > "$STOP_RECORD" 2>/dev/null || true

# Stop hook output schema does NOT support hookSpecificOutput — directive
# content goes in the top-level `reason` field.
jq -n '{
  decision: "block",
  reason: "BLOCKED: There are uncommitted changes that have not been reviewed. Invoke /review-cycle:review now (or /review-cycle:accept if the user already reviewed these changes themselves). Only if the user explicitly asked to defer review may you stop again without reviewing — this gate blocks once per state, and the commit gate still prevents unreviewed commits. Do not commit; the user is the final reviewer.",
  systemMessage: "review-cycle: changes unreviewed"
}' 2>/dev/null || printf '{"decision":"block","reason":"Uncommitted changes have not been reviewed. Run /review-cycle:review.","systemMessage":"review-cycle: changes unreviewed"}\n'

exit 0
