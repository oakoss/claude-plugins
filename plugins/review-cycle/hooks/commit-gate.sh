#!/usr/bin/env bash
# review-cycle: PreToolUse hook (Bash matcher)
#
# Blocks `git commit` if uncommitted changes haven't been reviewed.
# Pass-through for any non-commit Bash command. Fail-open when jq or grep
# are unavailable; the chained-mark pass-through itself fails closed — any
# tool failure inside it falls through to the sentinel check.

source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/gate.sh"

INPUT=$(cat 2>/dev/null || true)

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Word-boundary match avoids false positives like path strings containing
# 'git commit'. `git commit-tree` etc. are intentionally caught. Global
# options between `git` and `commit` are recognized in every real shape —
# `-C <path>`, `-c k='v with spaces'`, `--flag`, `--git-dir <path>` with a
# separate argument, quoted whole or mid-token — as are subshell/backtick
# openers before `git`, so none of those forms slip past the gate. An
# option's value is a sequence of quoted-or-bare chunks; a separate value
# token must not start with `-` so one option can never swallow the next.
GIT_OPT_ARG="([^[:space:];&|\"']|\"[^\"]*\"|'[^']*')+"
GIT_OPT_VAL="(\"[^\"]*\"|'[^']*'|[^-[:space:];&|\"'])([^[:space:];&|\"']|\"[^\"]*\"|'[^']*')*"
GIT_COMMIT_RE="(^|[;&|[:space:](\`])git([[:space:]]+-${GIT_OPT_ARG}([[:space:]]+${GIT_OPT_VAL})?)*[[:space:]]+commit\b"
if ! echo "$COMMAND" | grep -qE "$GIT_COMMIT_RE"; then
  exit 0
fi

# A chained `review-sentinel mark && git commit` writes the sentinel before
# the commit runs, but this hook fires before the whole chain executes, so
# checking the current (pre-mark) state would deny the flow /accept
# prescribes, forcing mark and commit into separate Bash calls.
#
# The pass-through is deliberately strict. The command must contain exactly
# one `git commit`, and a bare `mark` invocation must sit at a command
# position — start of string or right after `;` `&` `|` `(` — with the
# binary name at a path boundary, immediately `&&`-joined to a plain
# `git commit`. Bare mark only: `--root`, like a `-C` on the commit, could
# make mark and commit target different repos, so both option forms fall
# back to the sentinel check. `&&` guarantees the commit only runs if the
# mark succeeded; `;`, `||`, and bare newlines give no such guarantee and
# stay denied, as does any command between mark and commit (it could
# re-drift the tree after the mark). A `||` anywhere before the commit is
# rejected outright: `true || mark && commit` skips the mark yet still
# commits. The safe `false || mark` shape is denied too — fail-closed;
# drop the `||`.
#
# Two joined views of the command: RAW keeps every byte for the commit
# count, so a quoted `#` (e.g. -m "fix #12") can never hide a later commit;
# FLAT strips comments for the prefix match, where stripping only narrows
# what can match (fail-closed). In both, backslash and `&&` line-ends
# continue (bash semantics) and remaining newlines act as `;`. The
# single-commit requirement keeps quoted or heredoc text containing the
# phrase from standing in for the real commit: lookalike text only
# satisfies the match when no real commit rides along.
RAW=$(printf '%s\n' "$COMMAND" \
  | awk '{
      if (sub(/\\$/, "") || $0 ~ /&&[[:space:]]*$/) printf "%s ", $0
      else printf "%s;", $0
    }')
FLAT=$(printf '%s\n' "$COMMAND" \
  | awk '{
      sub(/^[[:space:]]*#.*$/, "")
      sub(/[[:space:]]#.*$/, "")
      if (sub(/\\$/, "") || $0 ~ /&&[[:space:]]*$/) printf "%s ", $0
      else printf "%s;", $0
    }')
COMMIT_COUNT=$(printf '%s' "$RAW" | LC_ALL=C grep -oE "$GIT_COMMIT_RE" \
  | wc -l | tr -d '[:space:]')
PRE_COMMIT=$(printf '%s' "$FLAT" \
  | sed -E 's/(^|[;&|[:space:]])git[[:space:]]+commit([^[:alnum:]_].*)?$/\1/')
if [ "$COMMIT_COUNT" = "1" ] \
  && ! printf '%s' "$PRE_COMMIT" | grep -qF '||' \
  && printf '%s' "$PRE_COMMIT" | grep -qE \
  "(^|[;&|(])[[:space:]]*(\"([^\"]*/)?review-sentinel\"|'([^']*/)?review-sentinel'|([^[:space:];&|\"']*/)?review-sentinel)[[:space:]]+mark[[:space:]]*&&[[:space:]]*\$"; then
  exit 0
fi

INPUT_CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Candidates parsed out of the command text may be relative — to the
# payload cwd, or for a -C following a leading cd, to the cd target.
abs_candidate() {
  case "$1" in
    ''|/*) printf '%s' "$1" ;;
    *) if [ -n "$2" ]; then printf '%s/%s' "$2" "$1"; else printf '%s' "$1"; fi ;;
  esac
}

# Claude often runs `cd <path> && git commit`. Extract the leading cd
# argument as a candidate for project-root resolution.
CD_CANDIDATE=$(echo "$COMMAND" | sed -nE 's/^[[:space:]]*cd[[:space:]]+("([^"]+)"|'\''([^'\'']+)'\''|([^[:space:]&;|]+)).*/\2\3\4/p' | head -1)
CD_CANDIDATE="${CD_CANDIDATE/#\~/$HOME}"
CD_CANDIDATE=$(abs_candidate "$CD_CANDIDATE" "$INPUT_CWD")

# `git -C <path> commit` names its repo inline, and it outranks a leading
# `cd`: `-C` decides where the commit actually lands. Trust an inline -C
# only when the command holds a single commit match — with more than one,
# prose (echoed text, heredoc doc lines) and the real invocation are
# indistinguishable here, so fall back to cd/cwd rather than let text pick
# the repo. Within the match the LAST -C wins, matching git's own
# semantics for repeated -C flags.
GIT_SEG=""
[ "$COMMIT_COUNT" = "1" ] \
  && GIT_SEG=$(printf '%s' "$RAW" | LC_ALL=C grep -oE "$GIT_COMMIT_RE" | head -1)
GIT_C_CANDIDATE=$(printf '%s' "$GIT_SEG" \
  | grep -oE -- "-C[[:space:]]+(\"[^\"]*\"|'[^']*'|[^[:space:];&|]+)" | tail -1 \
  | sed -E "s/^-C[[:space:]]+//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/")
GIT_C_CANDIDATE="${GIT_C_CANDIDATE/#\~/$HOME}"
GIT_C_CANDIDATE=$(abs_candidate "$GIT_C_CANDIDATE" "${CD_CANDIDATE:-$INPUT_CWD}")

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
