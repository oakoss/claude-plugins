#!/usr/bin/env bash
# Compat shim. The canonical bats wrapper now lives at <repo>/bin/run-bats.
# Defaults to running all .bats files in this directory; pass explicit args to
# override.

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$TESTS_DIR/../../.." && pwd)"

if [ $# -eq 0 ]; then
  exec "$REPO_ROOT/bin/run-bats" "$TESTS_DIR"/*.bats
else
  exec "$REPO_ROOT/bin/run-bats" "$@"
fi
