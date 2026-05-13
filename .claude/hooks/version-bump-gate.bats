#!/usr/bin/env bats
# Tests for .claude/hooks/version-bump-gate.sh.
# Run with `bats .claude/hooks/version-bump-gate.bats`.

setup() {
  HOOK_DIR="$(cd "$(dirname "${BATS_TEST_FILENAME}")" && pwd)"
  GATE="$HOOK_DIR/version-bump-gate.sh"

  mkdir -p "$BATS_TEST_TMPDIR/repo"
  TEST_REPO="$(cd "$BATS_TEST_TMPDIR/repo" && pwd -P)"
  cd "$TEST_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test"

  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME/.claude"
  unset CLAUDE_PROJECT_DIR

  export GIT_CEILING_DIRECTORIES="$BATS_TEST_TMPDIR:$(cd "$BATS_TEST_TMPDIR" && pwd -P)"

  mkdir -p .claude-plugin plugins/foo/.claude-plugin plugins/foo/hooks plugins/foo/tests
  cat > .claude-plugin/marketplace.json <<'EOF'
{"plugins":[{"name":"foo","version":"0.1.0"}]}
EOF
  cat > plugins/foo/.claude-plugin/plugin.json <<'EOF'
{"name":"foo","version":"0.1.0"}
EOF
  echo "v1" > plugins/foo/hooks/runtime.sh
  echo "doc" > plugins/foo/README.md
  echo "log" > plugins/foo/CHANGELOG.md
  echo "test" > plugins/foo/tests/foo.bats
  git add -A
  git commit -q -m "baseline"
}

run_gate() {
  local cmd="${1:-git commit -m x}"
  echo "{\"tool_input\":{\"command\":\"$cmd\"},\"cwd\":\"$TEST_REPO\"}" \
    | CLAUDE_PROJECT_DIR="$TEST_REPO" bash "$GATE"
}

gate_decision() {
  echo "$1" | jq -r '.hookSpecificOutput.permissionDecision // "allow"' 2>/dev/null
}

@test "no-op when command is not git commit" {
  run run_gate "ls -la"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "no-op when working tree has nothing staged" {
  run run_gate
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "no-op when only doc files (README, CHANGELOG) are staged" {
  echo "updated docs" > plugins/foo/README.md
  echo "log update" > plugins/foo/CHANGELOG.md
  git add plugins/foo/README.md plugins/foo/CHANGELOG.md
  run run_gate
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "no-op when only test files are staged" {
  echo "updated tests" > plugins/foo/tests/foo.bats
  git add plugins/foo/tests/foo.bats
  run run_gate
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "BLOCKS when runtime file is staged without version bump" {
  echo "v2" > plugins/foo/hooks/runtime.sh
  git add plugins/foo/hooks/runtime.sh
  run run_gate
  [ "$status" -eq 0 ]
  [ "$(gate_decision "$output")" = "deny" ]
  [[ "$output" =~ "foo" ]]
  [[ "$output" =~ "version bump" ]]
}

@test "BLOCKS when only plugin.json is bumped, marketplace.json is not" {
  echo "v2" > plugins/foo/hooks/runtime.sh
  sed -i.bak 's/0.1.0/0.1.1/' plugins/foo/.claude-plugin/plugin.json
  rm -f plugins/foo/.claude-plugin/plugin.json.bak
  git add plugins/foo/hooks/runtime.sh plugins/foo/.claude-plugin/plugin.json
  run run_gate
  [ "$status" -eq 0 ]
  [ "$(gate_decision "$output")" = "deny" ]
  [[ "$output" =~ "marketplace.json bumped: 0" ]]
}

@test "BLOCKS when only marketplace.json is bumped, plugin.json is not" {
  echo "v2" > plugins/foo/hooks/runtime.sh
  sed -i.bak 's/0.1.0/0.1.1/' .claude-plugin/marketplace.json
  rm -f .claude-plugin/marketplace.json.bak
  git add plugins/foo/hooks/runtime.sh .claude-plugin/marketplace.json
  run run_gate
  [ "$status" -eq 0 ]
  [ "$(gate_decision "$output")" = "deny" ]
  [[ "$output" =~ "plugin.json bumped: 0" ]]
}

@test "PASSES when both plugin.json and marketplace.json are bumped" {
  echo "v2" > plugins/foo/hooks/runtime.sh
  sed -i.bak 's/0.1.0/0.1.1/' plugins/foo/.claude-plugin/plugin.json .claude-plugin/marketplace.json
  rm -f plugins/foo/.claude-plugin/plugin.json.bak .claude-plugin/marketplace.json.bak
  git add plugins/foo/hooks/runtime.sh plugins/foo/.claude-plugin/plugin.json .claude-plugin/marketplace.json
  run run_gate
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "no-op when .claude-plugin/marketplace.json is absent (not a marketplace repo)" {
  rm .claude-plugin/marketplace.json
  echo "v2" > plugins/foo/hooks/runtime.sh
  git add plugins/foo/hooks/runtime.sh
  run run_gate
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "no-op when per-project opt-out marker is set" {
  mkdir -p .claude
  touch .claude/.no-version-gate
  echo "v2" > plugins/foo/hooks/runtime.sh
  git add plugins/foo/hooks/runtime.sh
  run run_gate
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "no-op when global kill-switch is set" {
  touch "$HOME/.claude/.disable-review-gate"
  echo "v2" > plugins/foo/hooks/runtime.sh
  git add plugins/foo/hooks/runtime.sh
  run run_gate
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "BLOCKS when multiple plugins have staged runtime changes, lists all" {
  mkdir -p plugins/bar/.claude-plugin plugins/bar/hooks
  cat > plugins/bar/.claude-plugin/plugin.json <<'EOF'
{"name":"bar","version":"0.1.0"}
EOF
  echo "v1" > plugins/bar/hooks/runtime.sh
  git add -A && git commit -q -m "add bar"
  echo "v2" > plugins/foo/hooks/runtime.sh
  echo "v2" > plugins/bar/hooks/runtime.sh
  git add plugins/foo/hooks/runtime.sh plugins/bar/hooks/runtime.sh
  run run_gate
  [ "$status" -eq 0 ]
  [ "$(gate_decision "$output")" = "deny" ]
  [[ "$output" =~ "foo" ]]
  [[ "$output" =~ "bar" ]]
}

@test "manifest-only change passes through (no associated runtime change)" {
  sed -i.bak 's/0.1.0/0.1.1/' plugins/foo/.claude-plugin/plugin.json .claude-plugin/marketplace.json
  rm -f plugins/foo/.claude-plugin/plugin.json.bak .claude-plugin/marketplace.json.bak
  git add plugins/foo/.claude-plugin/plugin.json .claude-plugin/marketplace.json
  run run_gate
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
