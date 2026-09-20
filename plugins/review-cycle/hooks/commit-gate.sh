#!/usr/bin/env bash
# review-cycle: PreToolUse hook (Bash matcher)
#
# Blocks `git commit` in this project if uncommitted changes haven't been
# reviewed. Pass-through for any non-commit Bash command, and for a commit
# that lands in some other repository.
#
# Fail-open on a broken dependency in the sense that the commit proceeds — but
# visibly: the gate exits 1, which is a non-blocking error whose first stderr
# line reaches the transcript, where exit 0 would reach the debug log alone.
# The chained accept-state pass-through fails closed, and an awk that cannot
# build the command skeleton falls back to the raw text, which blocks.
#
# All lexical analysis of the command text (what counts as a git commit
# invocation, what makes a chained `review-sentinel accept-state && git
# commit` sanctioned, cd/-C extraction) lives in lib/command-parse.sh — the
# policy and its rationale are documented there, once, next to the code
# that implements them.

GATE_NAME="review-cycle commit-gate"
# shellcheck disable=SC2034  # read by dep_report_broken in lib/dep-check.sh
DEP_CONSEQUENCE="this gate did NOT run, so the commit was not checked against the review mark"

# Builtin redirection, not `cat`: the payload is read before the prefilter
# and before every probe, so an unprobed cat emptied INPUT and every gate
# exited 0 in silence. A PATH fault that breaks jq breaks cat first.
INPUT=$(</dev/stdin)

# Drain stdin before this: a gate that exits without reading leaves its writer's
# first write with no reader, and a writer that checks (jq does) reports a broken
# pipe where the caller sees it. Measured 5/5, at any payload size.
#
# Still ahead of the prefilter and the source loop, which can both fail loudly.
[ -f "$HOME/.claude/.disable-review-gate" ] && exit 0

# Fires on every Bash call, so a broken dependency must not be reported on
# commands it would never act on. parse_has_commit reads the JSON-DECODED
# command, so a backslash here may encode the verb (\u0063ommit) and cannot be
# ruled out from the raw bytes; only a payload with neither is provably not one.
case "$INPUT" in
  *commit*|*\\*) ;;
  *) exit 0 ;;
esac

# A lib unreadable at runtime leaves the gate off on that machine, which a CI
# check on the repo's own copy never sees.
for lib in gate.sh command-parse.sh dep-check.sh; do
  # shellcheck source=/dev/null
  source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/$lib" 2>/dev/null || {
    printf '%s: cannot load %s from %s — this gate did NOT run, so the commit was not checked against the review mark.\n' \
      "$GATE_NAME" "$lib" "${CLAUDE_PLUGIN_ROOT}/hooks/lib" >&2
    exit 1
  }
done

# A truncated lib sources at exit 0 with its helpers undefined; the missing
# emitter then fails as a command-not-found and the final exit 0 runs. Sourcing
# cleanly is not the same as loading.
for fn in dep_require dep_exit_pass emit_checked emit_deny gate_disabled \
          gate_should_run parse_has_commit; do
  type "$fn" >/dev/null 2>&1 || {
    printf '%s: %s undefined after loading libs from %s — this gate did NOT run, so the commit was not checked against the review mark.\n' \
      "$GATE_NAME" "$fn" "${CLAUDE_PLUGIN_ROOT}/hooks/lib" >&2
    exit 1
  }
done

gate_disabled && exit 0

DEPS_OK=1
# Liveness first, because root discovery below needs git; the rooted probe
# after it catches a git that runs but refuses THIS repo (safe.directory).
# command-parse.sh, which every decision routes through, is awk, sed, grep
# and tr. sort and grep belong to review-sentinel's staged_divergence, which
# decides this gate's verdict and goes silent when either one misanswers.
dep_require "$GATE_NAME" grep git awk sed tr sort || DEPS_OK=0

# jq answers a known question on the call that does the work: a separate probe
# says nothing about the next invocation, and this is the one the gate acts on.
# Saves a mise-shim exec per Bash call too (measured 107ms). -sR reads stdin as
# a raw string so the program always runs, which is what separates a broken jq
# (no token) from a payload that is not JSON (token, notjson) -- a jq that
# rejects bad input is working. cwd rides the token line, so only the command
# can span lines and the split below cannot shift. tostring keeps a non-string
# cwd from pretty-printing; a cwd containing a newline is discarded rather than
# truncated, which the gate already handles -- it drops any cwd that is not an
# absolute path.
JQ_OUT=$(echo "$INPUT" | jq -sRr '((try fromjson catch null) | if type == "object" then . else null end) as $o
  | (($o.cwd? // "") | tostring) as $c
  | "_probe_ok:" + (if $o == null then "notjson" else "json:" + (if ($c | index("\n")) then "" else $c end) end),
    ($o.tool_input?.command? // "")' 2>/dev/null)
COMMAND=""
INPUT_CWD=""
case "$JQ_OUT" in
  # Command substitution strips the trailing newline, so an empty command
  # leaves the token line alone. Treating that as a broken jq blamed a healthy
  # one and, in the commit gate, denied a call that was never a commit.
  "_probe_ok:json:"*)
    JQ_REST="${JQ_OUT#_probe_ok:json:}"
    case "$JQ_REST" in
      *$'\n'*) INPUT_CWD="${JQ_REST%%$'\n'*}"; COMMAND="${JQ_REST#*$'\n'}" ;;
      *)       INPUT_CWD="$JQ_REST" ;;
    esac
    ;;
  "_probe_ok:notjson"*) dep_report_bad_payload "$GATE_NAME"; DEPS_OK=0 ;;
  *) dep_report_broken "$GATE_NAME" jq "known-answer probe failed"; DEPS_OK=0 ;;
esac


# With a broken dependency the short-circuit below cannot be trusted: a dead jq
# empties COMMAND, and a grep reporting no match says "not a commit" about every
# command there is. jq answers for itself in the token above; grep answers for
# itself in parse_has_commit, since dep_probe_grep ran once at startup and says
# nothing about the invocation this decision rests on. Either way, fall back to
# the raw payload on the prefilter's own two arms. The backslash arm is not
# optional: a JSON escape can carry the verb (\u0063ommit) past a reader of raw
# bytes, and dropping it here let an unreviewed commit through at exit 0 while
# the diagnostic went to the debug log, where nobody sees it.
PARSE_RC=0
if [ "$DEPS_OK" -eq 1 ]; then
  parse_has_commit "$COMMAND" || PARSE_RC=$?
  case "$PARSE_RC" in
    1) exit 0 ;;
    2) DEPS_OK=0 ;;
  esac
fi
if [ "$DEPS_OK" -eq 0 ]; then
  # The same arms as the top prefilter, restated so the fallback stays correct
  # on its own if that prefilter is ever narrowed. Both arms pass today, so
  # nothing reaches the exit below; what decided relevance was the prefilter.
  case "$INPUT" in
    *commit*|*\\*) ;;
    *) exit 0 ;;
  esac
  # An unconfirmable miss means grep could not say whether this is a commit at
  # all, so the gate has no standing to deny it: continuing would block an
  # ordinary Bash call on an answer nothing computed, which is the trap
  # fail-open exists to avoid. Report and stand down -- exit 1 is non-blocking,
  # and the action proceeds.
  if [ "$PARSE_RC" -eq 2 ]; then
    dep_report_broken "$GATE_NAME" grep "reported a miss it could not confirm"
    exit 1
  fi
fi

# A chained `review-sentinel accept-state && git commit` writes the sentinel
# before the commit runs, but this hook fires before the whole chain
# executes, so checking the current (pre-write) state would deny the flow
# /accept prescribes. Pass through the sanctioned shape; see
# parse_accept_chain_ok for what qualifies and why.
if parse_accept_chain_ok "$COMMAND"; then
  dep_exit_pass
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
# No root found means either no repository in reach or a git that would not
# say. Discovery runs through git either way, so the second arrives looking
# like the first and takes the quiet exit; .git on disk separates them.
probe_root_then_pass() {
  dep_require_git_upward "$GATE_NAME" "$@" || DEPS_OK=0
  dep_exit_pass
}

CHECK_ROOTS=""
if [ -n "$TARGET_DIR" ] && TARGET_ROOT=$(gate_target_root "$TARGET_DIR"); then
  [ -n "$TARGET_ROOT" ] || probe_root_then_pass "$TARGET_DIR" "$INPUT_CWD"
  if [ -n "$PROJECT_ROOTS" ]; then
    MEMBER_RC=0
    printf '%s\n' "$PROJECT_ROOTS" | LC_ALL=C grep -qxF "$TARGET_ROOT" || MEMBER_RC=$?
    [ "$MEMBER_RC" -eq 1 ] && dep_exit_pass
  fi
  CHECK_ROOTS="$TARGET_ROOT"
fi
if [ -z "$CHECK_ROOTS" ]; then
  CHECK_ROOTS="$PROJECT_ROOTS"
  # Nothing readable and no project to protect: guard whatever repository is
  # in reach rather than nothing at all.
  [ -n "$CHECK_ROOTS" ] || CHECK_ROOTS=$(gate_resolve_project_root "$INPUT_CWD") || CHECK_ROOTS=""
fi
[ -n "$CHECK_ROOTS" ] || probe_root_then_pass "$TARGET_DIR" "$INPUT_CWD"

RC=0
GATE_ERR=""
while IFS= read -r TARGET_ROOT; do
  [ -n "$TARGET_ROOT" ] || continue
  # Per root, not once for the first: a git that refuses THIS repository still
  # passes a liveness probe. Skipped once something is broken, so the one line
  # the transcript shows is not spent re-naming a fault already reported.
  if [ "$DEPS_OK" -eq 1 ]; then
    dep_require "$GATE_NAME" "git:$TARGET_ROOT" || DEPS_OK=0
  fi
  gate_should_run "$TARGET_ROOT" >/dev/null || continue
  GATE_ERR=$("${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$TARGET_ROOT" check 2>&1 >/dev/null)
  RC=$?
  [ "$RC" -eq 1 ] && break
  # 0 is clean and 2 is the documented read-error fail-open. Anything else is
  # the sentinel failing to run, and collapsing it to 0 read as a clean tree:
  # absent, exit 127 and SIGTERM all produced a byte-identical pass.
  case "$RC" in
    0|1|2) ;;
    *) dep_report_broken "$GATE_NAME" review-sentinel "check exited $RC"; DEPS_OK=0 ;;
  esac
  RC=0
done <<CHECK_LIST
$CHECK_ROOTS
CHECK_LIST

[ "$RC" -eq 1 ] || dep_exit_pass  # clean, sentinel matches, opted out, or read error

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
  DENY_JSON=$(jq -n --arg rs "$RS_BIN" --arg err "$GATE_ERR" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ("Commit blocked: the review gate could not read the working tree, so it cannot confirm this state was reviewed. " + $err + " Fix the underlying problem (most often an unreadable file — check its permissions) and retry. /review-cycle:accept will NOT clear this: it fails on the same fault. Diagnose with: \"" + $rs + "\" status. The user can opt this project out entirely with {\"disabled\": true} in .claude/review-cycle.json.")
    }
  }' 2>/dev/null)
  emit_deny "$DENY_JSON" 'Commit blocked: the review gate could not read the working tree. Fix the unreadable path and retry; /review-cycle:accept will not clear this.'
  exit 0
fi

DENY_JSON=$(jq -n --arg rs "$RS_BIN" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: ("Commit blocked: the current state does not match the last reviewed mark. If no review has happened, run /review-cycle:review. If these changes WERE reviewed, something changed the state after marking — edits since the mark, a commit-time formatter mutating files, or a hook manager restoring the index after a rejected commit (re-stage in that case) — and /review-cycle:accept re-marks a state you have already reviewed. Diagnose with: \"" + $rs + "\" status. Marking works before or after staging; ordering is not the problem. If you meant to commit in a DIFFERENT repository — a scratch fixture, a throwaway clone — name it: `git -C <path> commit`, or reach it with `cd` hops joined by `&&`. This gate reads where the commit lands, and blocks whenever the command does not say: a literal path it can follow, no `..` or unexpanded variable, and one commit per call. The user can opt this project out entirely with {\"disabled\": true} in .claude/review-cycle.json.")
  }
}' 2>/dev/null)
emit_deny "$DENY_JSON" 'Commit blocked: state does not match the last reviewed mark. Review with /review-cycle:review, or re-mark with /review-cycle:accept if already reviewed.'

exit 0
