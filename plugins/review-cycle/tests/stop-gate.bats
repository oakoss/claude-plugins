#!/usr/bin/env bats
# Stop-gate behavior: in-progress marker pass-through, block-once-per-state,
# and the cycle-start/cycle-end sentinel subcommands backing them.

setup() {
  load 'helpers'
  setup_repo
}

run_stop_gate() {
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$PLUGIN_ROOT/hooks/stop-gate.sh" <<< "${1:-\{\}}"
}

MARKER=".claude/.review-in-progress"
RECORD=".claude/.review-stop-block"

# --- sentinel subcommands ---

@test "cycle-start writes epoch-seconds marker" {
  run "$REVIEW_SENTINEL" cycle-start
  [ "$status" -eq 0 ]
  [ -f "$TEST_REPO/$MARKER" ]
  grep -qE '^[0-9]+$' "$TEST_REPO/$MARKER"
}

@test "cycle-end removes the marker" {
  "$REVIEW_SENTINEL" cycle-start
  run "$REVIEW_SENTINEL" cycle-end
  [ "$status" -eq 0 ]
  [ ! -f "$TEST_REPO/$MARKER" ]
}

@test "cycle-end is a no-op without a marker" {
  run "$REVIEW_SENTINEL" cycle-end
  [ "$status" -eq 0 ]
}

@test "cycle-start exits 1 outside a git repo" {
  mkdir -p "$BATS_TEST_TMPDIR/notarepo"
  cd "$BATS_TEST_TMPDIR/notarepo"
  run "$REVIEW_SENTINEL" cycle-start
  [ "$status" -eq 1 ]
}

@test "mark clears both the marker and the stop record" {
  "$REVIEW_SENTINEL" cycle-start
  mkdir -p "$TEST_REPO/.claude"
  echo "stale-record" > "$TEST_REPO/$RECORD"
  echo "change" > foo.txt
  run "$REVIEW_SENTINEL" mark
  [ "$status" -eq 0 ]
  [ ! -f "$TEST_REPO/$MARKER" ]
  [ ! -f "$TEST_REPO/$RECORD" ]
}

@test "cycle-start failure leaves no marker behind" {
  mkdir -p "$TEST_REPO/.claude"
  chmod 555 "$TEST_REPO/.claude"
  run "$REVIEW_SENTINEL" cycle-start
  chmod 755 "$TEST_REPO/.claude"
  [ "$status" -eq 2 ]
  [ ! -f "$TEST_REPO/$MARKER" ]
}

@test "cycle-end reports failure when the marker cannot be removed" {
  "$REVIEW_SENTINEL" cycle-start
  chmod 555 "$TEST_REPO/.claude"
  run "$REVIEW_SENTINEL" cycle-end
  chmod 755 "$TEST_REPO/.claude"
  [ "$status" -eq 2 ]
}

@test "seed clears both the marker and the stop record" {
  "$REVIEW_SENTINEL" cycle-start
  mkdir -p "$TEST_REPO/.claude"
  echo "stale-record" > "$TEST_REPO/$RECORD"
  run "$REVIEW_SENTINEL" seed
  [ "$status" -eq 0 ]
  [ ! -f "$TEST_REPO/$MARKER" ]
  [ ! -f "$TEST_REPO/$RECORD" ]
}

@test "marker and record files do not drift the sentinel hash" {
  echo "change" > foo.txt
  "$REVIEW_SENTINEL" mark
  "$REVIEW_SENTINEL" cycle-start
  echo "whatever" > "$TEST_REPO/$RECORD"
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

@test "paths lists the marker and record files" {
  run "$REVIEW_SENTINEL" paths
  [ "$status" -eq 0 ]
  [[ "$output" == *"$MARKER"* ]]
  [[ "$output" == *"$RECORD"* ]]
}

# --- stop-gate: baseline ---

@test "stop-gate blocks on drift" {
  echo "change" > foo.txt
  run run_stop_gate
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision"'* ]]
  [[ "$output" == *'"block"'* ]]
}

@test "stop-gate passes on clean tree" {
  run run_stop_gate
  [ "$status" -eq 0 ]
  [[ "$output" != *'"block"'* ]]
}

@test "stop-gate passes on reviewed (marked) drift" {
  echo "change" > foo.txt
  "$REVIEW_SENTINEL" mark
  run run_stop_gate
  [ "$status" -eq 0 ]
  [[ "$output" != *'"block"'* ]]
}

@test "stop-gate passes when stop_hook_active" {
  echo "change" > foo.txt
  run run_stop_gate '{"stop_hook_active": true}'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "stop-gate passes when kill-switch active" {
  echo "change" > foo.txt
  touch "$HOME/.claude/.disable-review-gate"
  run run_stop_gate
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# --- stop-gate: in-progress marker ---

@test "fresh in-progress marker lets the turn end despite drift" {
  echo "change" > foo.txt
  "$REVIEW_SENTINEL" cycle-start
  run run_stop_gate
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ -f "$TEST_REPO/$MARKER" ]
}

@test "stale in-progress marker is removed and the gate blocks" {
  echo "change" > foo.txt
  mkdir -p "$TEST_REPO/.claude"
  echo "$(( $(date +%s) - 7200 ))" > "$TEST_REPO/$MARKER"
  run run_stop_gate
  [ "$status" -eq 0 ]
  [[ "$output" == *'"block"'* ]]
  [ ! -f "$TEST_REPO/$MARKER" ]
}

@test "garbage in-progress marker is removed and the gate blocks" {
  echo "change" > foo.txt
  mkdir -p "$TEST_REPO/.claude"
  echo "not-a-timestamp" > "$TEST_REPO/$MARKER"
  run run_stop_gate
  [ "$status" -eq 0 ]
  [[ "$output" == *'"block"'* ]]
  [ ! -f "$TEST_REPO/$MARKER" ]
}

@test "empty in-progress marker is removed and the gate blocks" {
  echo "change" > foo.txt
  mkdir -p "$TEST_REPO/.claude"
  : > "$TEST_REPO/$MARKER"
  run run_stop_gate
  [ "$status" -eq 0 ]
  [[ "$output" == *'"block"'* ]]
  [ ! -f "$TEST_REPO/$MARKER" ]
}

@test "future-dated in-progress marker is treated as stale" {
  echo "change" > foo.txt
  mkdir -p "$TEST_REPO/.claude"
  echo "$(( $(date +%s) + 7200 ))" > "$TEST_REPO/$MARKER"
  run run_stop_gate
  [ "$status" -eq 0 ]
  [[ "$output" == *'"block"'* ]]
}

# --- stop-gate: block once per drift state ---

@test "first stop on a drift state blocks and records the state" {
  echo "change" > foo.txt
  run run_stop_gate
  [[ "$output" == *'"block"'* ]]
  [ -f "$TEST_REPO/$RECORD" ]
}

@test "second stop on the identical state soft-passes with a warning" {
  echo "change" > foo.txt
  run_stop_gate >/dev/null
  run run_stop_gate
  [ "$status" -eq 0 ]
  [[ "$output" != *'"block"'* ]]
  [[ "$output" == *'"systemMessage"'* ]]
}

@test "new drift after a soft-pass blocks again" {
  echo "v1" > foo.txt
  run_stop_gate >/dev/null
  run_stop_gate >/dev/null
  echo "v2" > foo.txt
  run run_stop_gate
  [ "$status" -eq 0 ]
  [[ "$output" == *'"block"'* ]]
}

@test "reverting to an earlier blocked state blocks again (record holds last state only)" {
  echo "v1" > foo.txt
  run_stop_gate >/dev/null
  echo "v2" > foo.txt
  run_stop_gate >/dev/null
  echo "v1" > foo.txt
  run run_stop_gate
  [ "$status" -eq 0 ]
  [[ "$output" == *'"block"'* ]]
}

@test "clean pass clears the stop record so the next drift blocks fresh" {
  echo "change" > foo.txt
  run_stop_gate >/dev/null
  [ -f "$TEST_REPO/$RECORD" ]
  rm foo.txt
  run run_stop_gate
  [ "$status" -eq 0 ]
  [ ! -f "$TEST_REPO/$RECORD" ]
  echo "change again" > foo.txt
  run run_stop_gate
  [[ "$output" == *'"block"'* ]]
}
