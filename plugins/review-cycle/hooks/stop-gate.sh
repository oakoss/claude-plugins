#!/usr/bin/env bash
# review-cycle: Stop hook
#
# Blocks Claude from finishing a turn if uncommitted-and-unreviewed changes
# exist. Tells Claude to invoke /review-cycle:review. Fail-open on any error.

source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/gate.sh"

INPUT=$(cat 2>/dev/null || true)

# Belt-and-suspenders reentrancy. The sentinel-based gate below is primary.
if echo "$INPUT" | jq -e '.stop_hook_active == true' >/dev/null 2>&1; then
  exit 0
fi

PROJECT_ROOT=$(gate_should_run) || exit 0

"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$PROJECT_ROOT" check
RC=$?
[ "$RC" -eq 0 ] && exit 0  # clean tree or sentinel matches
[ "$RC" -eq 2 ] && exit 0  # error: fail-open

# RC=1 → drift. Block.
# Stop hook output schema does NOT support hookSpecificOutput — directive
# content goes in the top-level `reason` field.
jq -n '{
  decision: "block",
  reason: "BLOCKED: There are uncommitted changes that have not been reviewed. You MUST invoke /review-cycle:review now before attempting to stop again. The cycle will fan out reviewers, apply fixes per its embedded policies, and update the review sentinel. Do not commit; the user is the final reviewer.",
  systemMessage: "review-cycle: changes unreviewed"
}' 2>/dev/null || printf '{"decision":"block","reason":"Uncommitted changes have not been reviewed. Run /review-cycle:review.","systemMessage":"review-cycle: changes unreviewed"}\n'

exit 0
