#!/usr/bin/env bash
# gate.sh: shared preconditions for review-cycle hooks. Source, don't execute.
#
# Functions:
#   gate_disabled                          0 if global kill-switch active
#   gate_project_opted_out <root>          0 if per-project marker present
#   gate_in_git_repo <root>                0 if path is inside a git work tree
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
  local root="$1"
  [ -n "$root" ] && [ -f "$root/.claude/.no-review-gate" ]
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

gate_should_run() {
  gate_disabled && return 1
  local root
  root=$(gate_resolve_project_root "$@") || return 1
  [ -n "$root" ] || return 1
  gate_project_opted_out "$root" && return 1
  echo "$root"
  return 0
}
