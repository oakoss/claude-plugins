#!/usr/bin/env bash
# review-cycle: PreToolUse hook (Bash matcher)
#
# Blocks `git commit` in this project if uncommitted changes haven't been
# reviewed. Pass-through for any non-commit Bash command, and for a commit
# that lands in some other repository. Fail-open when jq or grep are
# unavailable or the parse lib is missing or unloadable; the chained
# accept-state pass-through itself fails closed — any tool failure inside it
# falls through to the sentinel check, and an awk that cannot build the
# command skeleton falls back to the raw text, which blocks rather than passes.
#
# All lexical analysis of the command text (what counts as a git commit
# invocation, what makes a chained `review-sentinel accept-state && git
# commit` sanctioned, cd/-C extraction) lives in lib/command-parse.sh — the
# policy and its rationale are documented there, once, next to the code
# that implements them.

source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/gate.sh" 2>/dev/null || exit 0
source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/command-parse.sh" 2>/dev/null || exit 0

INPUT=$(cat 2>/dev/null || true)

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
INPUT_CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

parse_has_commit "$COMMAND" || exit 0

# A chained `review-sentinel accept-state && git commit` writes the sentinel
# before the commit runs, but this hook fires before the whole chain
# executes, so checking the current (pre-write) state would deny the flow
# /accept prescribes. Pass through the sanctioned shape; see
# parse_accept_chain_ok for what qualifies and why.
if parse_accept_chain_ok "$COMMAND"; then
  exit 0
fi

# Which repository the commit lands in, decided only from the two shapes plain
# reading can settle: a leading `cd`, and the commit's own `-C`. Anything else
# leaves TARGET_DIR empty and gates the session's own project. Reading text is
# not running it, so an unproven answer is a guess, and a guess that says
# "elsewhere" waves an unreviewed commit through.
TARGET_DIR=""
CODE=$(parse_strip_text "$COMMAND") && ROUTABLE=1 || ROUTABLE=0

# A path the gate cannot follow: an expansion it never performed, or a `..`
# segment, which lands somewhere else once the directories ahead of it exist.
unfollowable() {
  # shellcheck disable=SC2088  # matching a literal tilde, not expanding one
  case "$1" in
    ''|-*) return 0 ;;
    *['$`*?[']*) return 0 ;;
    # An escape means the raw token was split at a space that belongs to the
    # path, so what arrived here is a prefix of somewhere else entirely.
    *\\*) return 0 ;;
    ..|../*|*/..|*/../*) return 0 ;;
    # `~+`, `~-`, and `~user` expand to directories this has no way to know,
    # and the caller's `~` substitution would rewrite them into a path that
    # exists nowhere.
    '~'|'~/'*) [ -z "${HOME:-}" ] && return 0
               return 1 ;;
    '~'*) return 0 ;;
    *) return 1 ;;
  esac
}

# `!` inverts a grep that errored as readily as one that found nothing, which
# would re-enable routing on the commands whose target is unreadable.
REDIRECT_RC=0
printf '%s' "$CODE" | LC_ALL=C grep -qE "$PARSE_GIT_REDIRECT_RE" || REDIRECT_RC=$?
case "$INPUT_CWD" in /*) ;; *) INPUT_CWD="" ;; esac

# Everything read below stops at the first commit, so a second one lands
# somewhere the command never said.
if [ "$ROUTABLE" -eq 1 ] && [ -n "$INPUT_CWD" ] && [ "$REDIRECT_RC" -eq 1 ] \
   && [ "$(parse_commit_count "$COMMAND")" = "1" ] \
   && ! parse_prefix_unsafe "$CODE"; then
  # `&&` throughout means a hop that fails takes the commit with it. Plain
  # sequencing does not, so each directory has to be there already. Any other
  # separator and the text stops saying where bash ends up.
  CD_WALK="$INPUT_CWD"
  case "$(parse_prefix_seps "$CODE")" in
    '&&') CD_MUST_EXIST=0 ;;
    ''|';') CD_MUST_EXIST=1 ;;
    *) CD_WALK=""; CD_MUST_EXIST=1 ;;
  esac

  # Hops are read from the raw text, because blanking a quoted path would lose
  # the path itself. A hop carried as data is caught by the counts disagreeing:
  # the skeleton has no `cd` where quoted text merely mentions one.
  [ "$(parse_cd_count "$COMMAND")" = "$(parse_cd_count "$CODE")" ] || CD_WALK=""

  while IFS= read -r CD_HOP; do
    [ -n "$CD_WALK" ] || break
    # A chain of no hops still sends one empty line through the heredoc; a hop
    # the skeleton blanked arrives the same way and must not be followed, so
    # the count decides which this is.
    [ -n "$CD_HOP" ] || { [ "$(parse_cd_count "$COMMAND")" -eq 0 ] || CD_WALK=""; continue; }
    if unfollowable "$CD_HOP"; then CD_WALK=""; break; fi
    CD_WALK=$(parse_abs "${CD_HOP/#\~/$HOME}" "$CD_WALK")
    [ "$CD_MUST_EXIST" -eq 0 ] || [ -d "$CD_WALK" ] || CD_WALK=""
  done <<CD_CHAIN
$(parse_cd_chain "$COMMAND")
CD_CHAIN

  if [ -n "$CD_WALK" ]; then
    GIT_C_CANDIDATE=$(parse_extract_git_c "$COMMAND")
    if [ -z "$GIT_C_CANDIDATE" ]; then
      TARGET_DIR="$CD_WALK"
    elif ! unfollowable "$GIT_C_CANDIDATE"; then
      TARGET_DIR=$(parse_abs "${GIT_C_CANDIDATE/#\~/$HOME}" "$CD_WALK")
    fi
  fi
fi

PROJECT_ROOTS=$(gate_project_roots "$INPUT_CWD") || PROJECT_ROOTS=""

# A target the command settled decides on its own; only a proven answer stands
# the gate down. Where it could not be settled, every root the session owns is
# checked — picking one would leave the other ungated.
CHECK_ROOTS=""
if [ -n "$TARGET_DIR" ] && TARGET_ROOT=$(gate_target_root "$TARGET_DIR"); then
  [ -n "$TARGET_ROOT" ] || exit 0
  if [ -n "$PROJECT_ROOTS" ]; then
    MEMBER_RC=0
    printf '%s\n' "$PROJECT_ROOTS" | LC_ALL=C grep -qxF "$TARGET_ROOT" || MEMBER_RC=$?
    [ "$MEMBER_RC" -eq 1 ] && exit 0
  fi
  CHECK_ROOTS="$TARGET_ROOT"
fi
if [ -z "$CHECK_ROOTS" ]; then
  CHECK_ROOTS="$PROJECT_ROOTS"
  # Nothing readable and no project to protect: guard whatever repository is
  # in reach rather than nothing at all.
  [ -n "$CHECK_ROOTS" ] || CHECK_ROOTS=$(gate_resolve_project_root "$INPUT_CWD") || CHECK_ROOTS=""
fi
[ -n "$CHECK_ROOTS" ] || exit 0

RC=0
GATE_ERR=""
while IFS= read -r TARGET_ROOT; do
  [ -n "$TARGET_ROOT" ] || continue
  gate_should_run "$TARGET_ROOT" >/dev/null || continue
  GATE_ERR=$("${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$TARGET_ROOT" check 2>&1 >/dev/null)
  RC=$?
  [ "$RC" -eq 1 ] && break
  RC=0
done <<CHECK_LIST
$CHECK_ROOTS
CHECK_LIST

[ "$RC" -eq 1 ] || exit 0  # clean, sentinel matches, opted out, or read error

# RC=1 → drift. Deny the commit.
# PreToolUse uses hookSpecificOutput.permissionDecision, NOT the deprecated
# top-level decision/reason fields.
# The reason distinguishes "never reviewed" from "reviewed but drifted since
# the mark": an agent whose review DID happen reads a bare "run review first"
# as the review having failed, when the real cause is post-mark drift.
RS_BIN="${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel"
# A git failure blocks the same way ordinary drift does, but the remedies differ:
# /review-cycle:accept cannot clear it, because the write verbs fail on the same
# fault.
if [ -n "$GATE_ERR" ]; then
  jq -n --arg rs "$RS_BIN" --arg err "$GATE_ERR" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ("Commit blocked: the review gate could not read the working tree, so it cannot confirm this state was reviewed. " + $err + " Fix the underlying problem (most often an unreadable file — check its permissions) and retry. /review-cycle:accept will NOT clear this: it fails on the same fault. Diagnose with: \"" + $rs + "\" status. The user can opt this project out entirely with {\"disabled\": true} in .claude/review-cycle.json.")
    }
  }' 2>/dev/null \
    || printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Commit blocked: the review gate could not read the working tree. Fix the unreadable path and retry; /review-cycle:accept will not clear this."}}\n'
  exit 0
fi

jq -n --arg rs "$RS_BIN" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: ("Commit blocked: the current state does not match the last reviewed mark. If no review has happened, run /review-cycle:review. If these changes WERE reviewed, something changed the state after marking — edits since the mark, a commit-time formatter mutating files, or a hook manager restoring the index after a rejected commit (re-stage in that case) — and /review-cycle:accept re-marks a state you have already reviewed. Diagnose with: \"" + $rs + "\" status. Marking works before or after staging; ordering is not the problem. If you meant to commit in a DIFFERENT repository — a scratch fixture, a throwaway clone — name it: `git -C <path> commit`, or reach it with `cd` hops joined by `&&`. This gate reads where the commit lands, and blocks whenever the command does not say: a literal path it can follow, no `..` or unexpanded variable, and one commit per call. The user can opt this project out entirely with {\"disabled\": true} in .claude/review-cycle.json.")
  }
}' 2>/dev/null || printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Commit blocked: state does not match the last reviewed mark. Review with /review-cycle:review, or re-mark with /review-cycle:accept if already reviewed."}}\n'

exit 0
