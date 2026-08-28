#!/usr/bin/env bash
# gate.sh: shared preconditions for review-cycle hooks. Source, don't execute.
#
# Functions:
#   gate_disabled                          0 if global kill-switch active
#   gate_project_opted_out <root>          0 if per-project marker present
#   gate_in_git_repo <root>                0 if path is inside a git work tree
#   gate_project_roots <cwd>               print the session's project roots
#   gate_target_root <dir>                 print the repo a path belongs to
#   gate_resolve_project_root [cand]...    print resolved root, nonzero if none
#   gate_should_run [cand]...              composite: print root if hook should
#                                          proceed, nonzero otherwise
#
# `gate_should_run` is the typical entry point. It checks the kill-switch,
# resolves the root from extra candidates + CLAUDE_PROJECT_DIR + cwd, and
# checks the per-project opt-out. On success it prints the root and returns 0;
# callers capture: PROJECT_ROOT=$(gate_should_run "$@") || exit 0

gate_disabled() {
  [ -f "$HOME/.claude/.disable-review-gate" ]
}

gate_project_opted_out() {
  local root="$1" config
  [ -n "$root" ] || return 1
  config="$root/.claude/review-cycle.json"
  # Honor `disabled` only when it's a proper JSON boolean. `null`, strings,
  # numbers, and missing values fall through to the legacy marker; a
  # hand-edit of `disabled: null` shouldn't silently lose the prior opt-out.
  # `disabled: false` (proper bool) does override a stale `.no-review-gate`.
  if [ -f "$config" ] && command -v jq >/dev/null 2>&1; then
    if jq -e '(.disabled | type) == "boolean"' "$config" >/dev/null 2>&1; then
      jq -e '.disabled == true' "$config" >/dev/null 2>&1
      return $?
    fi
  fi
  [ -f "$root/.claude/.no-review-gate" ]
}

gate_in_git_repo() {
  local root="$1"
  [ -n "$root" ] && git -C "$root" rev-parse --show-toplevel >/dev/null 2>&1
}

gate_resolve_project_root() {
  local candidate root
  for candidate in "$@" "${CLAUDE_PROJECT_DIR:-}"; do
    [ -n "$candidate" ] || continue
    [ -d "$candidate" ] || continue
    root=$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null) || continue
    if [ -n "$root" ]; then
      echo "$root"
      return 0
    fi
  done
  root=$(git rev-parse --show-toplevel 2>/dev/null) || return 1
  [ -n "$root" ] && echo "$root"
}

# Every repository the session may be working in — the payload cwd's and the
# one CLAUDE_PROJECT_DIR names — one per line. Both are listed rather than
# ranked: this repo's own AGENTS.md calls CLAUDE_PROJECT_DIR unreliable in
# plugin hooks, and letting a wrong value outrank the cwd would disarm the
# gate everywhere except the repository it names. Nonzero when neither
# resolves, which callers must read as "unknown", never as "no project".
gate_project_roots() {
  local candidate root found=1
  for candidate in "$1" "${CLAUDE_PROJECT_DIR:-}"; do
    [ -n "$candidate" ] || continue
    [ -d "$candidate" ] || continue
    root=$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null) || continue
    [ -n "$root" ] || continue
    echo "$root"
    found=0
  done
  return "$found"
}

# The repository a path belongs to, resolved through its nearest existing
# ancestor. The hook runs before the command does, so a directory the command
# is about to create is not yet on disk — and a not-yet-created directory
# inside the project is still the project, since git walks up to find it.
# Nonzero means the walk itself could not proceed. Success with empty output
# is an answer, not a failure: no repository lies above the path, so a commit
# there reaches none. A relative path is refused rather than resolved, since
# it would resolve against the hook process's own directory.
gate_target_root() {
  local dir="$1" parent
  case "$dir" in /*) ;; *) return 1 ;; esac
  while [ ! -d "$dir" ]; do
    parent="${dir%/*}"
    [ -n "$parent" ] || parent="/"
    [ "$parent" != "$dir" ] || return 1
    dir="$parent"
  done
  git -C "$dir" rev-parse --show-toplevel 2>/dev/null
  return 0
}

gate_should_run() {
  gate_disabled && return 1
  local root
  root=$(gate_resolve_project_root "$@") || return 1
  [ -n "$root" ] || return 1
  gate_project_opted_out "$root" && return 1
  echo "$root"
  return 0
}

# Machine-written state directory; mirrors bin/review-sentinel's STATE_DIR,
# which cannot source this lib — change both together. Consumed by the
# sourcing hooks; shellcheck can't see them.
# shellcheck disable=SC2034
GATE_STATE_DIR=".claude/review-cycle"

# How long an in-progress marker is honored: shared by the Stop gate
# (which lets turns end while it is fresh) and SessionStart (which revokes it
# once it is not). bin/review-sentinel is a standalone binary and cannot source
# this lib, so its status output hardcodes the same number — change both.
GATE_IN_PROGRESS_TTL=3600

# 0 when the marker at $1 is absent, unreadable, or older than the TTL —
# i.e. when no running cycle can still be claiming it. A future-dated marker
# counts as stale: a clock that disagrees must not hold the gate open.
gate_marker_is_stale() {
  local marker="$1" started now
  [ -f "$marker" ] || return 0
  started=$(sed -n '1p' "$marker" 2>/dev/null | tr -cd '0-9')
  now=$(date +%s 2>/dev/null | tr -cd '0-9')
  # No clock means no TTL decision: treat as fresh rather than kill a live cycle.
  [ -n "$now" ] || return 1
  [ -n "$started" ] || return 0
  [ $((now - started)) -ge 0 ] && [ $((now - started)) -lt "$GATE_IN_PROGRESS_TTL" ] && return 1
  return 0
}
