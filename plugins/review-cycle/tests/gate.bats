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

@test "gate_project_opted_out returns 0 when marker exists" {
  mkdir -p "$TEST_REPO/.claude"
  touch "$TEST_REPO/.claude/.no-review-gate"
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 0 ]
}

@test "gate_project_opted_out returns 1 when no marker" {
  run gate_project_opted_out "$TEST_REPO"
  [ "$status" -eq 1 ]
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
