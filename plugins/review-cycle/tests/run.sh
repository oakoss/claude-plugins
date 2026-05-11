#!/usr/bin/env bash
# Wrapper around bats that terminates the runner once all results have been
# emitted. Works around a post-suite cleanup hang on macOS where bats holds
# file descriptors open after the final `ok`/`not ok` line.
#
# Usage:   tests/run.sh [bats-arg...]
# Default: runs every .bats file in this directory.

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ARGS=("$@")
if [ ${#ARGS[@]} -eq 0 ]; then
  ARGS=("$TESTS_DIR"/*.bats)
fi

OUT=$(mktemp)
trap '/bin/rm -f "$OUT"' EXIT

bats --tap "${ARGS[@]}" > "$OUT" 2>&1 &
BATS_PID=$!

# Expected count comes from the `1..N` plan line.
EXPECTED=""
RESULT_COUNT=0
DEADLINE=$(($(date +%s) + 120))
EXIT_CODE=0

while [ "$(date +%s)" -lt $DEADLINE ]; do
  if ! kill -0 $BATS_PID 2>/dev/null; then
    wait $BATS_PID
    EXIT_CODE=$?
    break
  fi

  if [ -z "$EXPECTED" ]; then
    PLAN=$(grep -m1 -E '^1\.\.[0-9]+' "$OUT" 2>/dev/null || true)
    if [ -n "$PLAN" ]; then
      EXPECTED="${PLAN#1..}"
    fi
  fi

  if [ -n "$EXPECTED" ]; then
    RESULT_COUNT=$(grep -cE '^(ok|not ok) ' "$OUT" 2>/dev/null || true)
    [ -z "$RESULT_COUNT" ] && RESULT_COUNT=0
    if [ "$RESULT_COUNT" -ge "$EXPECTED" ]; then
      sleep 0.5
      if kill -0 $BATS_PID 2>/dev/null; then
        kill -TERM $BATS_PID 2>/dev/null
        sleep 0.5
        kill -KILL $BATS_PID 2>/dev/null || true
      fi
      wait $BATS_PID 2>/dev/null
      break
    fi
  fi

  sleep 0.2
done

cat "$OUT"

if [ -z "$EXPECTED" ]; then
  echo "tests/run.sh: no plan line emitted by bats" >&2
  exit 2
fi

FAILED=$(grep -cE '^not ok ' "$OUT" 2>/dev/null || true)
[ -z "$FAILED" ] && FAILED=0
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
if [ "$RESULT_COUNT" -lt "$EXPECTED" ]; then
  echo "tests/run.sh: only $RESULT_COUNT/$EXPECTED tests reported" >&2
  exit 2
fi
exit 0
