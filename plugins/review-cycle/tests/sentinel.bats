#!/usr/bin/env bats

setup() {
  load 'helpers'
  setup_repo
}

@test "seed writes two-line sentinel in fresh repo" {
  echo "change" > foo.txt
  run "$REVIEW_SENTINEL" seed
  [ "$status" -eq 0 ]
  [ -f "$TEST_REPO/.claude/.review-mark" ]
  grep -qE '^anchor:[a-f0-9]{40}$' <(sed -n '1p' "$TEST_REPO/.claude/.review-mark")
  grep -qE '^sha256:[a-f0-9]{64}$' <(sed -n '2p' "$TEST_REPO/.claude/.review-mark")
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

@test "current-hash prints anchor and sha256 on two lines" {
  echo "change" > foo.txt
  run "$REVIEW_SENTINEL" current-hash
  [ "$status" -eq 0 ]
  [[ "${lines[0]}" =~ ^anchor:[a-f0-9]{40}$ ]]
  [[ "${lines[1]}" =~ ^sha256:[a-f0-9]{64}$ ]]
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

# Unborn repo: empty-tree anchor lets mark + check round-trip cleanly.
@test "unborn HEAD: mark uses empty-tree anchor and check passes" {
  UNBORN="$BATS_TEST_TMPDIR/unborn2"
  mkdir -p "$UNBORN"
  cd "$UNBORN"
  git init -q
  git config user.email t@t
  git config user.name t
  echo "v1" > a.txt
  git add a.txt
  "$REVIEW_SENTINEL" mark
  ANCHOR_LINE=$(sed -n '1p' "$UNBORN/.claude/.review-mark")
  [ "$ANCHOR_LINE" = "anchor:4b825dc642cb6eb9a060e54bf8d69288fbee4904" ]
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# THE FIX: committing reviewed work doesn't drift the sentinel when other
# reviewed work is still uncommitted. Before 0.6.0, every commit advanced HEAD
# and invalidated the sentinel, forcing a re-review per commit.
@test "check stays 0 after committing one reviewed edit with another still uncommitted" {
  echo "original" > foo.txt
  echo "original" > bar.txt
  git add foo.txt bar.txt
  git commit -q -m "add foo and bar"
  echo "v1" > foo.txt
  echo "v1" > bar.txt
  "$REVIEW_SENTINEL" mark
  git add foo.txt
  git commit -q -m "edit foo"
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# THE FIX, untracked variant: committing a tracked file doesn't drift even
# when an untracked file (still uncommitted) was part of the reviewed batch.
@test "check stays 0 after committing tracked file when reviewed untracked file is still present" {
  echo "original" > foo.txt
  git add foo.txt
  git commit -q -m "add foo"
  echo "v1" > foo.txt
  echo "u1" > new.txt
  "$REVIEW_SENTINEL" mark
  git add foo.txt
  git commit -q -m "edit foo"
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# New unreviewed edit after mark is still detected even after a reviewed commit.
@test "check exits 1 when a new edit appears after a reviewed commit" {
  echo "original" > foo.txt
  echo "original" > bar.txt
  git add foo.txt bar.txt
  git commit -q -m "add foo and bar"
  echo "v1" > foo.txt
  echo "v1" > bar.txt
  "$REVIEW_SENTINEL" mark
  git add foo.txt
  git commit -q -m "edit foo"
  echo "v2" > bar.txt  # unreviewed edit
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# `git commit --amend` with no content change keeps the diff-from-anchor
# identical, so the sentinel still matches.
@test "check stays 0 after amend that only changes commit message" {
  echo "original" > foo.txt
  git add foo.txt
  git commit -q -m "add foo"
  echo "v1" > foo.txt
  echo "u1" > new.txt
  "$REVIEW_SENTINEL" mark
  git add foo.txt
  git commit -q -m "edit foo"
  git commit --amend -q -m "edit foo (better message)"
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# `git commit --amend` that changes file content shifts the cumulative diff
# from the anchor and must be re-reviewed.
@test "check exits 1 after amend that changes file contents" {
  echo "original" > foo.txt
  git add foo.txt
  git commit -q -m "add foo"
  echo "v1" > foo.txt
  echo "u1" > new.txt
  "$REVIEW_SENTINEL" mark
  git add foo.txt
  git commit -q -m "edit foo"
  echo "v1-modified" > foo.txt
  git add foo.txt
  git commit --amend -q --no-edit
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# Codex P1 bypass: after mark, stage unreviewed content and restore the
# working tree to the reviewed state. Without the staged-content half of
# the hash, the gate would let `git commit` ship unreviewed index content.
@test "check exits 1 when staged content differs from reviewed working tree" {
  echo "original" > foo.txt
  git add foo.txt
  git commit -q -m "add foo"
  echo "v1" > foo.txt
  "$REVIEW_SENTINEL" mark
  # Stage v2 then restore wtree to v1 — wtree matches mark, index doesn't.
  echo "v2" > foo.txt
  git add foo.txt
  echo "v1" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# Inverse: same final content, staging state changed. The `--no-prefix` flag
# on git diff makes the cached and uncached streams hash-equivalent for
# identical content, so moving reviewed content between staged and unstaged
# does NOT drift the sentinel. This is the property that makes the bypass
# detection above coexist with the multi-commit-doesn't-drift property.
@test "check stays 0 when reviewed content moves between staged and unstaged" {
  echo "original" > foo.txt
  git add foo.txt
  git commit -q -m "add foo"
  echo "v1" > foo.txt
  "$REVIEW_SENTINEL" mark
  git add foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# Anchor unreachable (history rewrite that drops the marked commit) → drift.
@test "check exits 1 when anchor is no longer reachable in the object db" {
  echo "v1" > foo.txt
  "$REVIEW_SENTINEL" mark
  # Manually corrupt the anchor line to point at an object that doesn't exist.
  printf 'anchor:%s\nsha256:%s\n' \
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" \
    "0000000000000000000000000000000000000000000000000000000000000000" \
    > "$TEST_REPO/.claude/.review-mark"
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# `match` is stricter than `check`: no clean-tree fast-path.
@test "match exits 1 on clean tree with stale sentinel (no fast-path)" {
  echo "stale" > foo.txt
  "$REVIEW_SENTINEL" mark
  rm foo.txt
  run "$REVIEW_SENTINEL" match
  [ "$status" -eq 1 ]
}

@test "match exits 0 when sentinel matches current state" {
  echo "change" > foo.txt
  "$REVIEW_SENTINEL" mark
  run "$REVIEW_SENTINEL" match
  [ "$status" -eq 0 ]
}

@test "match exits 1 when sentinel is missing" {
  echo "change" > foo.txt
  run "$REVIEW_SENTINEL" match
  [ "$status" -eq 1 ]
}

@test "match exits 2 outside git repo" {
  cd "$BATS_TEST_TMPDIR"
  rm -rf "$TEST_REPO"
  run "$REVIEW_SENTINEL" match
  [ "$status" -eq 2 ]
}

@test "match exits 0 against empty-tree anchor in unborn repo" {
  UNBORN="$BATS_TEST_TMPDIR/unborn-match"
  mkdir -p "$UNBORN"
  cd "$UNBORN"
  git init -q
  git config user.email t@t
  git config user.name t
  echo "v1" > a.txt
  git add a.txt
  "$REVIEW_SENTINEL" mark
  run "$REVIEW_SENTINEL" match
  [ "$status" -eq 0 ]
  echo "v2" > a.txt
  git add a.txt
  run "$REVIEW_SENTINEL" match
  [ "$status" -eq 1 ]
}

@test "mark exits 2 when .claude is blocked by a file (write_sentinel failure)" {
  echo "v1" > foo.txt
  # Block mkdir -p by placing a non-directory at the .claude path.
  echo "blocking" > "$TEST_REPO/.claude"
  run "$REVIEW_SENTINEL" mark
  [ "$status" -eq 2 ]
  [[ "$output" =~ "cannot write sentinel" || "$output" =~ "Not a directory" || "$output" =~ "File exists" ]]
}

@test "mark + check works in detached HEAD state" {
  echo "a" > foo.txt
  git add foo.txt
  git commit -q -m c1
  echo "b" > foo.txt
  git add foo.txt
  git commit -q -m c2
  git checkout -q HEAD~1
  echo "wip" > foo.txt
  "$REVIEW_SENTINEL" mark
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
  echo "wip2" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# Idempotent re-seed after a reviewed commit advances the anchor.
@test "re-seeding after a reviewed commit advances the anchor forward" {
  echo "original" > foo.txt
  git add foo.txt
  git commit -q -m "add foo"
  ANCHOR_AT_MARK=$(git rev-parse HEAD)
  echo "v1" > foo.txt
  "$REVIEW_SENTINEL" mark
  STORED_ANCHOR_1=$(sed -n '1p' "$TEST_REPO/.claude/.review-mark" | sed 's/^anchor://')
  [ "$STORED_ANCHOR_1" = "$ANCHOR_AT_MARK" ]
  git add foo.txt
  git commit -q -m "edit foo"
  NEW_HEAD=$(git rev-parse HEAD)
  # `match` passes because content hasn't changed.
  run "$REVIEW_SENTINEL" match
  [ "$status" -eq 0 ]
  # Idempotent re-seed should rewrite the anchor to NEW_HEAD.
  "$REVIEW_SENTINEL" seed
  STORED_ANCHOR_2=$(sed -n '1p' "$TEST_REPO/.claude/.review-mark" | sed 's/^anchor://')
  [ "$STORED_ANCHOR_2" = "$NEW_HEAD" ]
}
