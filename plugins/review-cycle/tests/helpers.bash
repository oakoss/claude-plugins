#!/usr/bin/env bash
# Shared setup for sentinel.bats and gate.bats. Loaded via `load 'helpers'`.

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REVIEW_SENTINEL="$PLUGIN_ROOT/bin/review-sentinel"
GATE_LIB="$PLUGIN_ROOT/hooks/lib/gate.sh"

setup_repo() {
  # Canonicalize: on macOS BATS_TEST_TMPDIR is under /var/folders which is a
  # symlink to /private/var/folders. `git rev-parse --show-toplevel` returns
  # the canonical path, so tests must compare against the canonical form.
  mkdir -p "$BATS_TEST_TMPDIR/repo"
  TEST_REPO="$(cd "$BATS_TEST_TMPDIR/repo" && pwd -P)"
  cd "$TEST_REPO"
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
  export GIT_CEILING_DIRECTORIES="$BATS_TEST_TMPDIR:$(cd "$BATS_TEST_TMPDIR" && pwd -P)"
}
