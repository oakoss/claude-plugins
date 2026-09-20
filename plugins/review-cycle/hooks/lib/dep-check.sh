#!/usr/bin/env bash
# dep-check.sh: known-answer probes for the tools a gate depends on.
# Source, don't execute.
#
# A gate that cannot run must not be indistinguishable from a gate that ran and
# found nothing. Measured 2026-09-17 by fault injection against both gates: with
# jq or git replaced by a shim, every one of five fault modes (empty output at
# exit 0, exit 1, exit 127, SIGTERM, absent) produced exit 0, no stdout, no
# stderr — byte-identical to a genuine pass, in all twenty cells.
#
# Exit codes are not enough on their own. jq here resolves to a mise shim, and
# two of its failures differ: with mise relocated out from under it the shim
# printed nothing and exited 0 (recorded 2026-09-16), while an untrusted config
# writes to stderr and exits 1 (measured 2026-09-17). Only the second is
# catchable by status, so each probe asks a question with a known answer and
# checks the answer.
#
# Fail-open stays the policy (AGENTS.md: "Fail-open on any error — exit 0
# rather than trapping the user in a broken loop"). What changes is visibility.
#
# HOW TO REPORT A BROKEN DEPENDENCY, and why it is not `exit 0`:
# stderr from a hook that exits 0 reaches the debug log only — never the
# transcript, and Claude never sees it. A hook that exits non-zero and not 2
# is a non-blocking error: the action proceeds, and where the hook emits no
# valid JSON the transcript shows a hook error notice followed by THE FIRST
# LINE of stderr. So a gate that could not run prints one self-contained line,
# emits nothing on stdout, and exits 1. Exit 2 would block, which
# is the trap fail-open exists to avoid. (Verified against the hooks reference
# at code.claude.com/docs/en/hooks; not measured in-harness.)
#
# There is no dep_probe_jq: a probe answered correctly says nothing about the
# next invocation, so each gate asks jq its known question on the call that
# extracts the payload — the one whose answer it acts on.
#
# Callers set DEP_CONSEQUENCE to what their gate failed to do, in the user's
# terms; that clause is the whole message the transcript shows.
# Callers: dep_require <gate-name> <tool>... ; a failure sets their DEPS_OK=0,
# and dep_exit_pass turns every later pass-through into a visible exit 1.

# Each pipeline is braced with its own stderr redirect rather than only the
# tool's: a tool killed by a signal makes bash print a job-control line, which
# would take the one stderr line the transcript shows and bury the diagnostic.
#
# Both directions: a grep stuck at 0 claims every pattern matches, one stuck at
# 1 claims none do. Each is silent, and they fail the gate opposite ways.
# A grep that answers here and breaks afterwards is out of reach from a probe
# that runs once, so parse_has_commit confirms its own miss where it decides.
dep_probe_grep() {
  command -v grep >/dev/null 2>&1 || return 1
  { printf 'probe\n' | grep -q 'probe'; } 2>/dev/null || return 1
  { printf 'probe\n' | grep -q 'absent-pattern'; } 2>/dev/null && return 1
  return 0
}

# gate_marker_is_stale reads a clock through these; a dead date makes every
# in-progress marker look fresh, which holds a gate open forever.
dep_probe_date() {
  command -v date >/dev/null 2>&1 || return 1
  local now
  now=$(date +%s 2>/dev/null)
  case "$now" in
    ''|*[!0-9]*) return 1 ;;
  esac
  # A digit string is a shape, not an answer: a date stuck at 1 passes that and
  # makes every marker age zero. 1.7e9 is 2023; no earlier value is a real now.
  [ "$now" -ge 1700000000 ] 2>/dev/null
}

dep_probe_tr() {
  command -v tr >/dev/null 2>&1 || return 1
  [ "$( { printf 'a1b' | tr -cd '0-9'; } 2>/dev/null )" = "1" ]
}

dep_probe_sed() {
  command -v sed >/dev/null 2>&1 || return 1
  [ "$( { printf 'a\n' | sed -n 's/a/b/p'; } 2>/dev/null )" = "b" ]
}

dep_probe_awk() {
  command -v awk >/dev/null 2>&1 || return 1
  [ "$( { printf 'a b\n' | awk '{print $2}'; } 2>/dev/null )" = "b" ]
}

# 0 = answered correctly. 1 = git is broken. 2 = git is fine and says this root
# is not a work tree — a different remedy, so callers give it its own message
# rather than sending the user to debug a healthy git.
dep_probe_git() {
  local root="${1:-}" top
  command -v git >/dev/null 2>&1 || return 1
  # --version is answered before repository discovery, so a git that refuses
  # every real operation still passes it. --sq-quote needs no repository and
  # exercises the machinery that root discovery depends on.
  case "$(git --version 2>/dev/null)" in
    "git version "*) ;;
    *) return 1 ;;
  esac
  # --sq-quote prefixes its output with a space, by design.
  case "$(git rev-parse --sq-quote probe 2>/dev/null)" in
    *"'probe'") ;;
    *) return 1 ;;
  esac
  [ -n "$root" ] || return 0
  [ -d "$root" ] || return 2
  if [ "$(git -C "$root" rev-parse --is-inside-work-tree 2>/dev/null)" != "true" ]; then
    # A .git on disk while git denies the work tree is git misanswering, not a
    # missing repository. Asking git twice cannot separate those; the
    # filesystem can, and only one of them is a fault worth naming.
    [ -e "$root/.git" ] && return 1
    return 2
  fi
  # Every gate decides through --show-toplevel, which nothing above exercises:
  # a git answering all of them and nothing here empties every root silently.
  top=$(git -C "$root" rev-parse --show-toplevel 2>/dev/null)
  case "$top" in
    /*) return 0 ;;
    *) return 1 ;;
  esac
}

# review-sentinel's staged_divergence checks sort's exit status, so a sort that
# dies routes to the hash. One that exits 0 printing nothing writes an empty
# set, and a tree with staged unreviewed content reports clean (measured: 1->0).
# No tr in the comparison: a probe that borrows another tool reports that
# tool's fault under this one's name.
dep_probe_sort() {
  command -v sort >/dev/null 2>&1 || return 1
  [ "$( { printf 'b\na\nb\n' | sort -u; } 2>/dev/null )" = "$(printf 'a\nb')" ]
}

# One self-contained line: with stdout empty, only the first stderr line surfaces.
dep_report_broken() {
  local gate="$1" tool="$2" detail="${3:-}"
  local msg="$gate: $tool is not answering correctly${detail:+ ($detail)} — ${DEP_CONSEQUENCE:-this gate did NOT run}. Fix $tool and retry."
  # printf may be the casualty; its own "command not found" would otherwise
  # take the one line the transcript shows.
  if type printf >/dev/null 2>&1; then
    printf '%s\n' "$msg" >&2
  else
    echo "$msg" >&2
  fi
}

# A jq that rejects invalid JSON is a working jq. Blaming the tool for the
# payload sends the user to reinstall something that is not broken.
dep_report_bad_payload() {
  printf '%s: the hook payload is not a JSON object — %s.\n' \
    "$1" "${DEP_CONSEQUENCE:-this gate did NOT run}" >&2
}

# git works; the root does not. Naming the root is the whole remedy, and the
# generic message would send the user to reinstall a healthy git.
dep_report_root_not_worktree() {
  local gate="$1" root="${2:-}"
  printf '%s: %s is not a git work tree — %s.\n' \
    "$gate" "${root:-the resolved project root}" \
    "${DEP_CONSEQUENCE:-this gate did NOT run}" >&2
}

# emit_checked <built> <token-the-decision-must-contain> <fallback>
# Keys on the content, not jq's exit status: a jq that exits 0 printing nothing
# satisfies `||` and emits no decision at all, turning a block into a pass at
# the last step.
emit_checked() {
  case "$1" in
    *"$2"*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$3" ;;
  esac
}

emit_deny() {
  emit_checked "$1" '"deny"' \
    "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"$2\"}}"
}

# Exit 0 is reserved for user-legible states; taken while a dependency is
# broken it buries the diagnostic in the debug log instead of the transcript.
dep_exit_pass() {
  case "${DEPS_OK:-unset}" in
    1) exit 0 ;;
    *) exit 1 ;;
  esac
}

# The session cwd is usually below the repository root, so a candidate has to
# be walked upward. Returns 1 only when git is asked about a root and misanswers.
dep_require_git_upward() {
  local gate="$1" dir d
  shift
  for dir in "$@"; do
    [ -n "$dir" ] || continue
    d="$dir"
    while [ -n "$d" ] && [ "$d" != "/" ]; do
      if [ -e "$d/.git" ]; then
        dep_require "$gate" "git:$d" || return 1
        return 0
      fi
      d="${d%/*}"
    done
  done
  return 0
}

# dep_require <gate-name> <tool>...
# Returns 0 when every named tool answers correctly. Otherwise reports the
# first broken one and returns 1.
# `git` may be followed by a root to probe inside: dep_require gate "git:$root"
dep_require() {
  local gate="$1"; shift
  if [ "$#" -eq 0 ]; then
    dep_report_broken "$gate" "(none)" "dep_require called with no tools"
    return 1
  fi
  local spec tool arg rc
  for spec in "$@"; do
    tool="${spec%%:*}"
    arg=""
    [ "$spec" != "$tool" ] && arg="${spec#*:}"
    case "$tool" in
      grep) dep_probe_grep      || { dep_report_broken "$gate" grep "known-answer probe failed"; return 1; } ;;
      sed)  dep_probe_sed       || { dep_report_broken "$gate" sed  "known-answer probe failed"; return 1; } ;;
      date) dep_probe_date      || { dep_report_broken "$gate" date "known-answer probe failed"; return 1; } ;;
      tr)   dep_probe_tr        || { dep_report_broken "$gate" tr   "known-answer probe failed"; return 1; } ;;
      awk)  dep_probe_awk       || { dep_report_broken "$gate" awk  "known-answer probe failed"; return 1; } ;;
      sort) dep_probe_sort      || { dep_report_broken "$gate" sort "known-answer probe failed"; return 1; } ;;
      git)
        rc=0; dep_probe_git "$arg" || rc=$?
        case "$rc" in
          0) ;;
          2) dep_report_root_not_worktree "$gate" "$arg"; return 1 ;;
          *) dep_report_broken "$gate" git "known-answer probe failed"; return 1 ;;
        esac
        ;;
      *) dep_report_broken "$gate" "$tool" "no probe defined"; return 1 ;;
    esac
  done
  return 0
}
