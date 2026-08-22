#!/usr/bin/env bash
# Shared setup for sentinel.bats and gate.bats. Loaded via `load 'helpers'`.

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# bash 3.2 does not honor `set -e` for a failing bare [[ ]], so a mid-body
# [[ ]] assertion is inert on macOS while live on bash 5 (cpl-lan). These
# helpers return nonzero — which every bash enforces — and print the mismatch.
# The needle/pattern guard exists because an empty or unset second argument
# would otherwise pass vacuously (and `=~ ''` diverges between the two bashes).
assert_contains() {
  if [ "$#" -ne 2 ] || [ -z "$2" ]; then
    printf 'assert_contains: empty or missing needle\n' >&2
    return 1
  fi
  [[ "$1" == *"$2"* ]] && return 0
  printf 'expected to contain: %s\nactual:\n%s\n' "$2" "$1" >&2
  return 1
}

refute_contains() {
  if [ "$#" -ne 2 ] || [ -z "$2" ]; then
    printf 'refute_contains: empty or missing needle\n' >&2
    return 1
  fi
  [[ "$1" != *"$2"* ]] && return 0
  printf 'expected NOT to contain: %s\nactual:\n%s\n' "$2" "$1" >&2
  return 1
}

assert_matches() {
  if [ "$#" -ne 2 ] || [ -z "$2" ]; then
    printf 'assert_matches: empty or missing pattern\n' >&2
    return 1
  fi
  local rc=0
  # shellcheck disable=SC2319  # the condition's $? is the value being captured
  [[ "$1" =~ $2 ]] || rc=$?
  [ "$rc" -eq 0 ] && return 0
  if [ "$rc" -ge 2 ]; then
    printf 'assert_matches: invalid regex: %s\n' "$2" >&2
    return 1
  fi
  printf 'expected to match: %s\nactual:\n%s\n' "$2" "$1" >&2
  return 1
}

# Consumed by the .bats suites that `load 'helpers'`; shellcheck can't see them.
# shellcheck disable=SC2034
REVIEW_SENTINEL="$PLUGIN_ROOT/bin/review-sentinel"
# shellcheck disable=SC2034
GATE_LIB="$PLUGIN_ROOT/hooks/lib/gate.sh"

setup_repo() {
  # Isolate HOME before any git call. It keeps kill-switch tests off the real
  # ~/.claude, and it keeps every git call here off the developer's
  # ~/.gitconfig — a global commit.gpgsign signs every fixture commit, which
  # measured 166ms against 21ms unsigned.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude"

  # Canonicalize: on macOS BATS_TEST_TMPDIR is under /var/folders which is a
  # symlink to /private/var/folders. `git rev-parse --show-toplevel` returns
  # the canonical path, so tests must compare against the canonical form.
  mkdir -p "$BATS_TEST_TMPDIR/repo"
  TEST_REPO="$(cd "$BATS_TEST_TMPDIR/repo" && pwd -P)"
  cd "$TEST_REPO" || return 1
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test"
  git commit --allow-empty -q -m "init"

  # Don't inherit a parent CLAUDE_PROJECT_DIR.
  unset CLAUDE_PROJECT_DIR

  # Stop git from walking above BATS_TEST_TMPDIR to find a parent repo
  # (the project tree we're running from is itself a git repo). Include both
  # the canonical and uncanonical forms because git compares paths verbatim.
  local canonical_tmpdir
  canonical_tmpdir="$(cd "$BATS_TEST_TMPDIR" && pwd -P)"
  export GIT_CEILING_DIRECTORIES="$BATS_TEST_TMPDIR:$canonical_tmpdir"
}
