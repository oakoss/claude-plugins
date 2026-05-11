#!/usr/bin/env bash
# review-cycle: PreToolUse hook (Bash matcher)
#
# Blocks `git commit` if uncommitted changes haven't been reviewed.
# Pass-through for any non-commit Bash command. Fail-open on any error.

source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/gate.sh"

INPUT=$(cat 2>/dev/null || true)

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Word-boundary match avoids false positives like path strings containing
# 'git commit'. `git commit-tree` etc. are intentionally caught.
if ! echo "$COMMAND" | grep -qE '(^|[;&|]|[[:space:]])git[[:space:]]+commit\b'; then
  exit 0
fi

# Claude often runs `cd <path> && git commit`. Extract the leading cd
# argument as a candidate for project-root resolution.
CD_CANDIDATE=$(echo "$COMMAND" | sed -nE 's/^[[:space:]]*cd[[:space:]]+("([^"]+)"|'\''([^'\'']+)'\''|([^[:space:]&;|]+)).*/\2\3\4/p' | head -1)
CD_CANDIDATE="${CD_CANDIDATE/#\~/$HOME}"

INPUT_CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

PROJECT_ROOT=$(gate_should_run "$CD_CANDIDATE" "$INPUT_CWD") || exit 0

"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$PROJECT_ROOT" check
RC=$?
[ "$RC" -eq 0 ] && exit 0  # clean tree or sentinel matches
[ "$RC" -eq 2 ] && exit 0  # error: fail-open

# RC=1 → drift. Deny the commit.
# PreToolUse uses hookSpecificOutput.permissionDecision, NOT the deprecated
# top-level decision/reason fields.
jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "Cannot commit unreviewed changes. Run /review-cycle:review first, or touch .claude/.no-review-gate in the project root to bypass for this project."
  }
}' 2>/dev/null || printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Cannot commit unreviewed changes. Run /review-cycle:review first."}}\n'

exit 0
