#!/usr/bin/env bats

setup() {
  load 'helpers'
  setup_repo
}

@test "seed writes sentinel in fresh repo" {
  echo "change" > foo.txt
  run "$REVIEW_SENTINEL" seed
  [ "$status" -eq 0 ]
  [ -f "$TEST_REPO/.claude/.review-mark" ]
  grep -qE '^sha256:[a-f0-9]{64}$' "$TEST_REPO/.claude/.review-mark"
}

@test "mark writes sentinel in fresh repo" {
  echo "change" > foo.txt
  run "$REVIEW_SENTINEL" mark
  [ "$status" -eq 0 ]
  [ -f "$TEST_REPO/.claude/.review-mark" ]
}

@test "seed always overwrites existing sentinel" {
  echo "v1" > foo.txt
  "$REVIEW_SENTINEL" seed
  V1=$(cat "$TEST_REPO/.claude/.review-mark")
  echo "v2" > foo.txt
  "$REVIEW_SENTINEL" seed
  V2=$(cat "$TEST_REPO/.claude/.review-mark")
  [ "$V1" != "$V2" ]
}

@test "mark always overwrites existing sentinel" {
  echo "v1" > foo.txt
  "$REVIEW_SENTINEL" mark
  V1=$(cat "$TEST_REPO/.claude/.review-mark")
  echo "v2" > foo.txt
  "$REVIEW_SENTINEL" mark
  V2=$(cat "$TEST_REPO/.claude/.review-mark")
  [ "$V1" != "$V2" ]
}

@test "check exits 0 on clean tree (no sentinel)" {
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

@test "check exits 0 on clean tree even with stale sentinel" {
  echo "stale" > foo.txt
  "$REVIEW_SENTINEL" mark
  rm foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

@test "check exits 0 when sentinel matches current state" {
  echo "change" > foo.txt
  "$REVIEW_SENTINEL" mark
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

@test "check exits 1 when state drifted from sentinel" {
  echo "v1" > foo.txt
  "$REVIEW_SENTINEL" mark
  echo "v2" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

@test "check exits 1 when dirty tree has no sentinel" {
  echo "change" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

@test "check exits 2 outside git repo" {
  cd "$BATS_TEST_TMPDIR"
  rm -rf "$TEST_REPO"
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 2 ]
}

@test "seed exits 1 outside git repo" {
  cd "$BATS_TEST_TMPDIR"
  rm -rf "$TEST_REPO"
  run "$REVIEW_SENTINEL" seed
  [ "$status" -eq 1 ]
}

@test "mark exits 1 outside git repo" {
  cd "$BATS_TEST_TMPDIR"
  rm -rf "$TEST_REPO"
  run "$REVIEW_SENTINEL" mark
  [ "$status" -eq 1 ]
}

@test "paths prints two relative paths" {
  run "$REVIEW_SENTINEL" paths
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = ".claude/.review-mark" ]
  [ "${lines[1]}" = ".claude/.no-review-gate" ]
}

@test "paths works outside git repo" {
  cd "$BATS_TEST_TMPDIR"
  rm -rf "$TEST_REPO"
  run "$REVIEW_SENTINEL" paths
  [ "$status" -eq 0 ]
}

@test "--root flag overrides cwd" {
  echo "change" > foo.txt
  "$REVIEW_SENTINEL" mark
  cd "$BATS_TEST_TMPDIR"
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" check
  [ "$status" -eq 0 ]
}

@test "current-hash prints sha256:<hex>" {
  echo "change" > foo.txt
  run "$REVIEW_SENTINEL" current-hash
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^sha256:[a-f0-9]{64}$ ]]
}

@test "check treats malformed sentinel as missing" {
  echo "change" > foo.txt
  mkdir -p .claude
  echo "not-a-valid-hash" > .claude/.review-mark
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

@test "check treats wrong-prefix sentinel as missing" {
  echo "change" > foo.txt
  mkdir -p .claude
  # 64 hex chars but no sha256: prefix (the old format)
  echo "0000000000000000000000000000000000000000000000000000000000000000" > .claude/.review-mark
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

@test "unknown subcommand exits 2" {
  run "$REVIEW_SENTINEL" bogus
  [ "$status" -eq 2 ]
}

@test "no subcommand exits 2" {
  run "$REVIEW_SENTINEL"
  [ "$status" -eq 2 ]
}

@test "CLAUDE_PROJECT_DIR honored when no --root and cwd is elsewhere" {
  echo "change" > foo.txt
  "$REVIEW_SENTINEL" mark
  cd "$BATS_TEST_TMPDIR"
  CLAUDE_PROJECT_DIR="$TEST_REPO" run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# G1: content-change drift on a tracked file (same porcelain status both edits)
@test "check exits 1 when tracked file is re-edited (same porcelain status)" {
  echo "original" > foo.txt
  git add foo.txt
  git commit -q -m "add foo"
  echo "v1" > foo.txt
  "$REVIEW_SENTINEL" mark
  echo "v2" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# G2: content-change drift on an untracked file
@test "check exits 1 when untracked file content changes" {
  echo "u1" > new.txt
  "$REVIEW_SENTINEL" mark
  echo "u2" > new.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# G3: the sentinel file itself does not affect its own hash
@test "current-hash ignores sentinel file presence and content" {
  echo "change" > foo.txt
  H_NONE=$("$REVIEW_SENTINEL" current-hash)
  mkdir -p .claude
  echo "sha256:0000000000000000000000000000000000000000000000000000000000000000" > .claude/.review-mark
  H_WITH=$("$REVIEW_SENTINEL" current-hash)
  [ "$H_NONE" = "$H_WITH" ]
}

# G4: the opt-out marker does not affect the hash
@test "creating opt-out marker does not drift the hash" {
  echo "change" > foo.txt
  "$REVIEW_SENTINEL" mark
  mkdir -p .claude
  touch .claude/.no-review-gate
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# G7: gitignored files don't affect the hash
@test "gitignored files do not affect the hash" {
  echo "build/" > .gitignore
  git add .gitignore
  git commit -q -m "ignore"
  H1=$("$REVIEW_SENTINEL" current-hash)
  mkdir -p build && echo "junk" > build/output
  H2=$("$REVIEW_SENTINEL" current-hash)
  [ "$H1" = "$H2" ]
}

# G8: --root takes precedence over CLAUDE_PROJECT_DIR
@test "--root wins over CLAUDE_PROJECT_DIR when both set" {
  mkdir -p "$BATS_TEST_TMPDIR/other"
  OTHER="$(cd "$BATS_TEST_TMPDIR/other" && pwd -P)"
  (cd "$OTHER" && git init -q && git config user.email t@t && git config user.name t && git commit --allow-empty -q -m init)
  echo "change" > foo.txt
  "$REVIEW_SENTINEL" mark
  cd "$BATS_TEST_TMPDIR"
  CLAUDE_PROJECT_DIR="$OTHER" run "$REVIEW_SENTINEL" --root "$TEST_REPO" check
  [ "$status" -eq 0 ]
  [ ! -f "$OTHER/.claude/.review-mark" ]
}

# Unborn repo: staged content in initial commit is captured
@test "check exits 1 when staged file in unborn repo is re-edited" {
  UNBORN="$BATS_TEST_TMPDIR/unborn"
  mkdir -p "$UNBORN"
  cd "$UNBORN"
  git init -q
  git config user.email t@t
  git config user.name t
  # No initial commit — HEAD does not exist.
  echo "v1" > a.txt
  git add a.txt
  "$REVIEW_SENTINEL" mark
  echo "v2" > a.txt
  git add a.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}
