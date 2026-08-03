#!/usr/bin/env bash
# review-cycle: PreToolUse hook (Bash matcher)
#
# Blocks `git commit` if uncommitted changes haven't been reviewed.
# Pass-through for any non-commit Bash command. Fail-open when jq or grep
# are unavailable or the parse lib is missing or unloadable; the
# chained-mark pass-through itself fails closed — any tool failure inside
# it falls through to the sentinel check.
#
# All lexical analysis of the command text (what counts as a git commit
# invocation, what makes a chained `review-sentinel mark && git commit`
# sanctioned, cd/-C extraction) lives in lib/command-parse.sh — the policy
# and its rationale are documented there, once, next to the code that
# implements them.

source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/gate.sh" 2>/dev/null || exit 0
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/command-parse.sh" 2>/dev/null || exit 0

INPUT=$(cat 2>/dev/null || true)

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
INPUT_CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

parse_has_commit "$COMMAND" || exit 0

# A chained `review-sentinel mark && git commit` writes the sentinel before
# the commit runs, but this hook fires before the whole chain executes, so
# checking the current (pre-mark) state would deny the flow /accept
# prescribes. Pass through the sanctioned shape; see parse_mark_chain_ok
# for what qualifies and why.
if parse_mark_chain_ok "$COMMAND"; then
  exit 0
fi

# Root resolution candidates, most specific first: an inline `git -C`
# decides where the commit actually lands, a leading `cd` is next, the
# payload cwd last.
CD_CANDIDATE=$(parse_extract_cd "$COMMAND")
CD_CANDIDATE="${CD_CANDIDATE/#\~/$HOME}"
CD_CANDIDATE=$(parse_abs "$CD_CANDIDATE" "$INPUT_CWD")

GIT_C_CANDIDATE=$(parse_extract_git_c "$COMMAND")
GIT_C_CANDIDATE="${GIT_C_CANDIDATE/#\~/$HOME}"
GIT_C_CANDIDATE=$(parse_abs "$GIT_C_CANDIDATE" "${CD_CANDIDATE:-$INPUT_CWD}")

PROJECT_ROOT=$(gate_should_run "$GIT_C_CANDIDATE" "$CD_CANDIDATE" "$INPUT_CWD") || exit 0

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
