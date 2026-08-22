#!/usr/bin/env bats
# Behavior of scripts/sync-plugin-versions.mjs against fixture repos.

# Copy of the plugin suites' helper (plugins/review-cycle/tests/helpers.bash):
# bash 3.2 does not honor `set -e` for a failing bare [[ ]], so assertions
# must return nonzero.
assert_contains() {
  if [ "$#" -ne 2 ] || [ -z "$2" ]; then
    printf 'assert_contains: empty or missing needle\n' >&2
    return 1
  fi
  [[ "$1" == *"$2"* ]] && return 0
  printf 'expected to contain: %s\nactual:\n%s\n' "$2" "$1" >&2
  return 1
}

@test "assert_contains copy is load-bearing: mismatch returns nonzero" {
  run assert_contains "actual" "absent"
  [ "$status" -eq 1 ]
  assert_contains "$output" "expected to contain"
}

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  SCRIPT="$REPO_ROOT/scripts/sync-plugin-versions.mjs"
  FIXTURE="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$FIXTURE/.claude-plugin" "$FIXTURE/plugins/alpha/.claude-plugin"

  cat > "$FIXTURE/.claude-plugin/marketplace.json" <<'EOF'
{
  "name": "fixture",
  "plugins": [
    { "name": "alpha", "version": "1.0.0", "source": "./plugins/alpha" }
  ]
}
EOF
  cat > "$FIXTURE/plugins/alpha/.claude-plugin/plugin.json" <<'EOF'
{ "name": "alpha", "version": "1.0.0" }
EOF
  cat > "$FIXTURE/plugins/alpha/CHANGELOG.md" <<'EOF'
# Changelog

## [1.0.0] - 2026-01-01
EOF
}

run_script() {
  PLUGIN_REPO_ROOT="$FIXTURE" run node "$SCRIPT" "$@"
}

@test "consistent tree passes --check" {
  run_script --check
  [ "$status" -eq 0 ]
}

@test "marketplace drift fails --check and names the plugin" {
  sed -i.bak 's/"version": "1.0.0"/"version": "0.9.0"/' \
    "$FIXTURE/.claude-plugin/marketplace.json"
  run_script --check
  [ "$status" -eq 1 ]
  assert_contains "$output" "alpha: marketplace.json 0.9.0"
}

@test "package.json vs plugin.json drift fails --check" {
  printf '{ "name": "alpha", "version": "1.1.0", "private": true }\n' \
    > "$FIXTURE/plugins/alpha/package.json"
  run_script --check
  [ "$status" -eq 1 ]
  assert_contains "$output" "plugin.json 1.0.0 != package.json 1.1.0"
}

@test "missing changelog heading for the version fails --check" {
  printf '# Changelog\n\n## [0.9.0] - 2025-12-01\n' \
    > "$FIXTURE/plugins/alpha/CHANGELOG.md"
  run_script --check
  [ "$status" -eq 1 ]
  assert_contains "$output" "CHANGELOG.md has no heading for 1.0.0"
}

@test "changesets-style unbracketed heading satisfies the changelog check" {
  printf '# Changelog\n\n## 1.0.0\n' > "$FIXTURE/plugins/alpha/CHANGELOG.md"
  run_script --check
  [ "$status" -eq 0 ]
}

@test "sync writes package.json version into plugin.json and marketplace.json" {
  printf '{ "name": "alpha", "version": "1.1.0", "private": true }\n' \
    > "$FIXTURE/plugins/alpha/package.json"
  printf '# Changelog\n\n## 1.1.0\n' > "$FIXTURE/plugins/alpha/CHANGELOG.md"
  run_script
  [ "$status" -eq 0 ]
  grep -q '"version": "1.1.0"' "$FIXTURE/plugins/alpha/.claude-plugin/plugin.json"
  grep -q '"version": "1.1.0"' "$FIXTURE/.claude-plugin/marketplace.json"
}

@test "plugin without package.json is checked for manifest agreement only" {
  sed -i.bak 's/"version": "1.0.0"/"version": "0.9.0"/' \
    "$FIXTURE/plugins/alpha/.claude-plugin/plugin.json"
  run_script --check
  [ "$status" -eq 1 ]
  assert_contains "$output" "alpha: marketplace.json 1.0.0 != 0.9.0"
}

@test "plugin missing from marketplace.json is reported" {
  mkdir -p "$FIXTURE/plugins/beta/.claude-plugin"
  printf '{ "name": "beta", "version": "0.1.0" }\n' \
    > "$FIXTURE/plugins/beta/.claude-plugin/plugin.json"
  run_script --check
  [ "$status" -eq 1 ]
  assert_contains "$output" "beta: no entry in marketplace.json"
}
