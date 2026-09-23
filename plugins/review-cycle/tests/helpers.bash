#!/usr/bin/env bash
# Shared setup for the plugin's .bats suites. Loaded via `load 'helpers'`.

# shellcheck disable=SC2034  # read by the .bats suites that load this file
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

# `! cmd` is exempt from `set -e` in every bash per POSIX, so a bare `! cmd`
# assertion is inert even on bash 5. Only exit 1 is a clean false; other
# nonzero statuses mean the command never ran its check (grep on an unreadable
# file exits 2, a missing binary 127). `set -e` is suppressed inside a called
# function, so this proves the return status, not a clean body.
refute() {
  if [ "$#" -eq 0 ]; then
    printf 'refute: no command given\n' >&2
    return 1
  fi
  local rc=0
  "$@" || rc=$?
  if [ "$rc" -eq 0 ]; then
    printf 'expected failure, but succeeded: %s\n' "$*" >&2
    return 1
  fi
  if [ "$rc" -ne 1 ]; then
    if [ "$rc" -eq 126 ] || [ "$rc" -eq 127 ]; then
      printf 'refute: command could not be run (exit %s): %s\n' "$rc" "$*" >&2
    else
      printf 'refute: %s exited %s, not a clean false\n' "$1" "$rc" >&2
    fi
    return 1
  fi
  return 0
}

setup_repo() {
  # Isolate HOME before any git call. It keeps every git call here off the
  # developer's ~/.gitconfig — a global commit.gpgsign signs every fixture
  # commit, which measured 166ms against 21ms unsigned.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"

  # HOME alone leaves /etc/gitconfig's credential.helper=osxkeychain in play, so
  # fixture git hunts a keychain under the fake HOME and macOS offers to reset one.
  export GIT_CONFIG_NOSYSTEM=1

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
