#!/usr/bin/env bats

setup() {
  load 'helpers'
  setup_repo
  source "$GATE_LIB"
}

@test "gate_disabled returns 0 when kill-switch present" {
  touch "$HOME/.claude/.disable-review-gate"
  run gate_disabled
  [ "$status" -eq 0 ]
}

@test "gate_disabled returns 1 when no kill-switch" {
  run gate_disabled
  [ "$status" -eq 1 ]
}

@test "gate_project_opted_out returns 0 when legacy marker exists" {
  mkdir -p "$TEST_REPO/.claude"
  touch "$TEST_REPO/.claude/.no-review-gate"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 0 ]
}

@test "gate_project_opted_out returns 1 when no marker" {
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 1 ]
}

@test "gate_project_opted_out returns 0 when review-cycle.json has disabled:true" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":true}\n' > "$TEST_REPO/.claude/review-cycle.json"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 0 ]
}

@test "gate_project_opted_out returns 1 when review-cycle.json has disabled:false" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":false}\n' > "$TEST_REPO/.claude/review-cycle.json"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 1 ]
}

@test "gate_project_opted_out returns 1 when review-cycle.json omits disabled key" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"ignore":["foo/**"]}\n' > "$TEST_REPO/.claude/review-cycle.json"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 1 ]
}

@test "gate_project_opted_out returns 1 on malformed review-cycle.json (fail-open)" {
  mkdir -p "$TEST_REPO/.claude"
  printf 'not-json{' > "$TEST_REPO/.claude/review-cycle.json"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 1 ]
}

@test "gate_project_opted_out: review-cycle.json disabled:true wins over absent legacy marker" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":true}\n' > "$TEST_REPO/.claude/review-cycle.json"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 0 ]
}

# Explicit `disabled:false` in config must override a stale legacy marker.
# The user opted back IN; a leftover .no-review-gate from before they made
# that decision must not silently disable the gate.
@test "gate_project_opted_out: explicit disabled:false overrides legacy marker" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":false}\n' > "$TEST_REPO/.claude/review-cycle.json"
  touch "$TEST_REPO/.claude/.no-review-gate"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 1 ]
}

# Config without `disabled` key falls back to legacy marker (back-compat).
@test "gate_project_opted_out: config with no disabled key falls back to legacy marker" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"ignore":["foo/**"]}\n' > "$TEST_REPO/.claude/review-cycle.json"
  touch "$TEST_REPO/.claude/.no-review-gate"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 0 ]
}

# Type-strictness on `disabled`: string "true" and numeric 1 are NOT
# treated as truthy. Pins the current strict-bool semantics; a future
# refactor that broadens this without a deliberate decision would
# fail these tests.
@test "gate_project_opted_out: string 'true' does not opt out" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":"true"}\n' > "$TEST_REPO/.claude/review-cycle.json"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 1 ]
}

@test "gate_project_opted_out: numeric 1 does not opt out" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":1}\n' > "$TEST_REPO/.claude/review-cycle.json"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 1 ]
}

# Non-boolean `disabled` values fall through to the legacy marker. A
# hand-edit of `disabled: null` (or any non-bool) shouldn't silently lose
# a prior opt-out; only a proper `disabled: false` re-enables the gate.
@test "gate_project_opted_out: disabled:null falls back to legacy marker" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":null}\n' > "$TEST_REPO/.claude/review-cycle.json"
  touch "$TEST_REPO/.claude/.no-review-gate"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 0 ]
}

@test "gate_project_opted_out: disabled as string falls back to legacy marker" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":"true"}\n' > "$TEST_REPO/.claude/review-cycle.json"
  touch "$TEST_REPO/.claude/.no-review-gate"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 0 ]
}

# Malformed JSON + legacy marker → fallback still opts the user out.
@test "gate_project_opted_out: malformed JSON falls back to legacy marker" {
  mkdir -p "$TEST_REPO/.claude"
  printf 'not-json{' > "$TEST_REPO/.claude/review-cycle.json"
  touch "$TEST_REPO/.claude/.no-review-gate"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 0 ]
}

@test "gate_in_git_repo returns 0 inside repo" {
  run gate_in_git_repo "$TEST_REPO"
  [ "$status" -eq 0 ]
}

@test "gate_in_git_repo fails outside repo" {
  mkdir -p "$BATS_TEST_TMPDIR/notarepo"
  run gate_in_git_repo "$BATS_TEST_TMPDIR/notarepo"
  [ "$status" -ne 0 ]
}

@test "gate_resolve_project_root from explicit candidate arg" {
  cd "$BATS_TEST_TMPDIR"
  run gate_resolve_project_root "$TEST_REPO"
  [ "$status" -eq 0 ]
  [ "$output" = "$TEST_REPO" ]
}

@test "gate_resolve_project_root from CLAUDE_PROJECT_DIR" {
  mkdir -p "$BATS_TEST_TMPDIR/notarepo"
  cd "$BATS_TEST_TMPDIR/notarepo"
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run gate_resolve_project_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TEST_REPO" ]
}

@test "gate_resolve_project_root from cwd as last resort" {
  cd "$TEST_REPO"
  run gate_resolve_project_root
  [ "$status" -eq 0 ]
  [ "$output" = "$TEST_REPO" ]
}

@test "gate_resolve_project_root tries candidates in order" {
  # First candidate is invalid; second is valid; should pick second.
  cd "$BATS_TEST_TMPDIR"
  run gate_resolve_project_root "/nonexistent/path" "$TEST_REPO"
  [ "$status" -eq 0 ]
  [ "$output" = "$TEST_REPO" ]
}

@test "gate_should_run succeeds when all conditions met" {
  cd "$TEST_REPO"
  run gate_should_run
  [ "$status" -eq 0 ]
  [ "$output" = "$TEST_REPO" ]
}

@test "gate_should_run fails when kill-switch active" {
  cd "$TEST_REPO"
  touch "$HOME/.claude/.disable-review-gate"
  run gate_should_run
  [ "$status" -ne 0 ]
}

@test "gate_should_run fails when project opted out" {
  cd "$TEST_REPO"
  mkdir -p "$TEST_REPO/.claude"
  touch "$TEST_REPO/.claude/.no-review-gate"
  run gate_should_run
  [ "$status" -ne 0 ]
}

@test "gate_should_run fails when not in git repo" {
  mkdir -p "$BATS_TEST_TMPDIR/notarepo"
  cd "$BATS_TEST_TMPDIR/notarepo"
  run gate_should_run
  [ "$status" -ne 0 ]
}

@test "gate_should_run accepts extra candidate arg for cd-prefix scenario" {
  mkdir -p "$BATS_TEST_TMPDIR/notarepo"
  cd "$BATS_TEST_TMPDIR/notarepo"
  run gate_should_run "$TEST_REPO"
  [ "$status" -eq 0 ]
  [ "$output" = "$TEST_REPO" ]
}

# G12: kill-switch short-circuits before root resolution
@test "gate_should_run kill-switch wins even outside a git repo" {
  mkdir -p "$BATS_TEST_TMPDIR/notarepo"
  cd "$BATS_TEST_TMPDIR/notarepo"
  touch "$HOME/.claude/.disable-review-gate"
  run gate_should_run
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

# G13: gate_should_run emits no stdout on any failure path
@test "gate_should_run prints nothing on failure: kill-switch" {
  cd "$TEST_REPO"
  touch "$HOME/.claude/.disable-review-gate"
  run gate_should_run
  [ -z "$output" ]
}

@test "gate_should_run prints nothing on failure: opt-out marker" {
  cd "$TEST_REPO"
  mkdir -p .claude && touch .claude/.no-review-gate
  run gate_should_run
  [ -z "$output" ]
}

@test "gate_should_run prints nothing on failure: not in git repo" {
  mkdir -p "$BATS_TEST_TMPDIR/notarepo"
  cd "$BATS_TEST_TMPDIR/notarepo"
  run gate_should_run
  [ -z "$output" ]
}
