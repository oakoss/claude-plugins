#!/usr/bin/env bash
# Shared setup for sentinel.bats and gate.bats. Loaded via `load 'helpers'`.

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Consumed by the .bats suites that `load 'helpers'`; shellcheck can't see them.
# shellcheck disable=SC2034
REVIEW_SENTINEL="$PLUGIN_ROOT/bin/review-sentinel"
# shellcheck disable=SC2034
GATE_LIB="$PLUGIN_ROOT/hooks/lib/gate.sh"

setup_repo() {
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

  # Isolate HOME so kill-switch tests don't touch the real ~/.claude.
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude"

  # Don't inherit a parent CLAUDE_PROJECT_DIR.
  unset CLAUDE_PROJECT_DIR

  # Stop git from walking above BATS_TEST_TMPDIR to find a parent repo
  # (the project tree we're running from is itself a git repo). Include both
  # the canonical and uncanonical forms because git compares paths verbatim.
  local canonical_tmpdir
  canonical_tmpdir="$(cd "$BATS_TEST_TMPDIR" && pwd -P)"
  export GIT_CEILING_DIRECTORIES="$BATS_TEST_TMPDIR:$canonical_tmpdir"
}
