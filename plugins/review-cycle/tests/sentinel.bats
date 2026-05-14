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

# Committing reviewed work must not drift the sentinel when other reviewed
# work is still uncommitted. Before 0.6.0, every commit advanced HEAD and
# invalidated the sentinel, forcing a re-review per commit.
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

# Untracked variant: committing a tracked file must not drift even when an
# untracked file (still uncommitted) was part of the reviewed batch.
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

# --- Exclusion defaults (agent task trackers, IDE state) -------------------

# X1: beads state edits don't drift an existing sentinel.
@test "check stays 0 when only .beads/ content changes after mark" {
  echo "code" > foo.txt
  "$REVIEW_SENTINEL" mark
  mkdir -p .beads
  echo '{"id":"x-1","status":"closed"}' > .beads/issues.jsonl
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# X2: beads-only edits in a never-reviewed repo hit the clean-tree fast path.
@test "check exits 0 when only .beads/ has changes and no sentinel exists" {
  mkdir -p .beads
  echo '{"id":"x-1","status":"closed"}' > .beads/issues.jsonl
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# X3: IDE state changes are also excluded.
@test "check exits 0 when only .vscode/ has changes and no sentinel exists" {
  mkdir -p .vscode
  echo '{"editor.formatOnSave": true}' > .vscode/settings.json
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# X4: every default-excluded directory hits the fast path on a fresh repo.
@test "check exits 0 for each built-in excluded directory in isolation" {
  for dir in .beads .trekker .vscode .idea .zed .cursor .fleet; do
    rm -rf "$dir"
    mkdir -p "$dir"
    echo "noise" > "$dir/state"
    run "$REVIEW_SENTINEL" check
    [ "$status" -eq 0 ] || { echo "drifted on $dir" >&2; return 1; }
    rm -rf "$dir"
  done
}

# X5: regression guard: actual code changes still drift.
@test "check exits 1 when a real source file changes alongside excluded state" {
  echo "real code" > app.ts
  mkdir -p .beads
  echo '{"id":"x-1"}' > .beads/issues.jsonl
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# X6: current-hash is invariant under default-excluded changes.
@test "current-hash unchanged when only excluded directories differ" {
  echo "code" > foo.txt
  H1=$("$REVIEW_SENTINEL" current-hash)
  mkdir -p .beads .vscode .idea
  echo "a" > .beads/issues.jsonl
  echo "b" > .vscode/settings.json
  echo "c" > .idea/workspace.xml
  H2=$("$REVIEW_SENTINEL" current-hash)
  [ "$H1" = "$H2" ]
}

# X7: nested .beads/ in a subdirectory is NOT excluded (only repo-root).
@test "check exits 1 when nested subproject/.beads/ changes (not anchored at root)" {
  mkdir -p subproject/.beads
  echo "stuff" > subproject/.beads/issues.jsonl
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# --- User-extensible .claude/review-cycle.json -----------------------------

# X8: user `ignore` array is honored after the config has been marked.
@test "check stays 0 when changes match an ignore pattern from review-cycle.json" {
  echo "code" > foo.txt
  mkdir -p .claude generated
  printf '{"ignore":["generated/**"]}\n' > .claude/review-cycle.json
  "$REVIEW_SENTINEL" mark
  echo "machine output" > generated/bundle.js
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# X9: ignore patterns are additive; built-ins still apply.
@test "user ignore patterns do not disable built-in defaults" {
  echo "code" > foo.txt
  mkdir -p .claude
  printf '{"ignore":["other/**"]}\n' > .claude/review-cycle.json
  "$REVIEW_SENTINEL" mark
  mkdir -p .beads other
  echo "x" > .beads/issues.jsonl
  echo "y" > other/state
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# X10: an unrelated source change still drifts even with user excludes set.
@test "user ignore patterns do not mask real code drift" {
  echo "code" > foo.txt
  mkdir -p .claude
  printf '{"ignore":["scratch/**"]}\n' > .claude/review-cycle.json
  "$REVIEW_SENTINEL" mark
  echo "v2" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# --- Self-exclusion bypass defense (Codex P1 + code-reviewer C95) ---------

# X11: editing the config file itself always drifts an existing sentinel.
# The load-bearing assertion that force-include works when user patterns
# match the config path is in X12 (pattern `**`) and X13 (`.claude/**`).
# X11 covers the "new config file appears after mark" case.
@test "check exits 1 when review-cycle.json is added after mark" {
  echo "code" > foo.txt
  "$REVIEW_SENTINEL" mark
  mkdir -p .claude
  printf '{"ignore":[]}\n' > .claude/review-cycle.json
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# X12: editing the config file drifts even when an `ignore` pattern would
# otherwise match the config path itself.
@test "user ignore pattern '**' cannot hide config edits from the hash" {
  mkdir -p .claude
  printf '{"ignore":[]}\n' > .claude/review-cycle.json
  echo "code" > foo.txt
  "$REVIEW_SENTINEL" mark
  printf '{"ignore":["**"]}\n' > .claude/review-cycle.json
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# X13: same defense, narrower pattern that explicitly targets the config.
@test "user ignore pattern '.claude/**' cannot hide config edits from the hash" {
  mkdir -p .claude
  printf '{"ignore":[]}\n' > .claude/review-cycle.json
  echo "code" > foo.txt
  "$REVIEW_SENTINEL" mark
  printf '{"ignore":[".claude/**"]}\n' > .claude/review-cycle.json
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# X14: malformed JSON degrades to "no user patterns" rather than a silent
# pass. With no extra excludes, real code drift still flags.
@test "malformed review-cycle.json does not silently disable the gate" {
  echo "code" > foo.txt
  mkdir -p .claude
  printf 'not-json{{' > .claude/review-cycle.json
  "$REVIEW_SENTINEL" mark
  echo "v2" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# X15: trailing-newline-less JSON file still parses.
@test "review-cycle.json without trailing newline is parsed" {
  echo "code" > foo.txt
  mkdir -p .claude artifacts
  printf '{"ignore":["artifacts/**"]}' > .claude/review-cycle.json
  "$REVIEW_SENTINEL" mark
  echo "blob" > artifacts/output.bin
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# X16: staged changes to a tracked excluded path don't drift. The
# `--cached` branch coverage is X16b below; X16 is a property test that
# `is_clean_tree`'s exclude pathspec correctly hides the staged change.
@test "staged change to a tracked excluded path does not drift" {
  mkdir -p .beads
  echo "v1" > .beads/issues.jsonl
  echo "code" > foo.txt
  git add foo.txt .beads/issues.jsonl
  git commit -q -m "add tracked beads file"
  "$REVIEW_SENTINEL" mark
  echo "v2" > .beads/issues.jsonl
  git add .beads/issues.jsonl
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# X16b: staged-only change to a non-excluded tracked file MUST drift even
# when the working tree matches the marked state. This exercises the
# --cached branch of compute_hash_from_anchor specifically: a regression
# that dropped it (and relied only on `git diff` of unstaged changes) would
# fail to flag this scenario.
@test "staged-only change to tracked file drifts even when working tree matches mark" {
  echo "v1" > foo.txt
  git add foo.txt
  git commit -q -m "add foo"
  "$REVIEW_SENTINEL" mark
  echo "v2" > foo.txt
  git add foo.txt
  echo "v1" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# X17: independent is_clean_tree coverage. `match` doesn't call
# is_clean_tree, so it can't disambiguate the fast-path from a coincidental
# hash collision. To pin is_clean_tree specifically: with no sentinel,
# create a non-excluded untracked file AND an excluded-dir change. The
# clean-tree fast-path must report "not clean" (because of the non-excluded
# file), forcing the sentinel-lookup path. With no sentinel present, that
# returns drift.
@test "is_clean_tree returns not-clean when non-excluded file is present alongside excluded changes" {
  mkdir -p .beads
  echo "real code" > app.ts
  echo "noise" > .beads/issues.jsonl
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# X18: unusual-looking user patterns don't crash the gate. `build_excludes`
# wraps every user line as `:(exclude,glob)<pattern>` and git's pathspec
# parser only inspects magic at the start, so user-supplied magic-prefix
# bytes become a literal path component, not a pathspec-rejection trigger.
# The smoke-test in compute_hash_from_anchor is defense-in-depth against
# corrupted git state, not against user input; it isn't reachable from a
# pure-string `ignore` entry. This test verifies the wrapped-literal
# behavior is stable and that real drift still flags alongside it.
@test "unusual-looking ignore pattern does not break drift detection" {
  echo "code" > foo.txt
  mkdir -p .claude
  printf '{"ignore":[":(badmagic)oops"]}\n' > .claude/review-cycle.json
  "$REVIEW_SENTINEL" mark
  echo "v2" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# X19: schema robustness: `ignore` as a string (not array) degrades to
# "no user patterns" rather than crashing.
@test "ignore as string (not array) degrades to no user patterns" {
  echo "code" > foo.txt
  mkdir -p .claude
  printf '{"ignore":"foo/**"}\n' > .claude/review-cycle.json
  "$REVIEW_SENTINEL" mark
  echo "v2" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# X20: schema robustness: non-string entries in `ignore` are dropped, but
# string entries still apply. select(type == "string") in build_excludes
# pins this behavior.
@test "ignore array with mixed types keeps only string entries" {
  echo "code" > foo.txt
  mkdir -p .claude artifacts
  printf '{"ignore":[123, "artifacts/**", null]}\n' > .claude/review-cycle.json
  "$REVIEW_SENTINEL" mark
  echo "blob" > artifacts/output.bin
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# X21: empty ignore array is the same as no array; built-ins still apply.
@test "empty ignore array preserves built-in exclusions" {
  echo "code" > foo.txt
  mkdir -p .claude
  printf '{"ignore":[]}\n' > .claude/review-cycle.json
  "$REVIEW_SENTINEL" mark
  mkdir -p .beads
  echo "x" > .beads/issues.jsonl
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

# X22: a gitignored config file must still be in the hash. Repos that
# gitignore all of .claude/ would otherwise let the config rules take
# effect while the config edit itself is invisible to git, which is a
# bypass: change config to `ignore: ["foo.txt"]`, edit foo.txt, gate
# passes without review.
@test "gitignored review-cycle.json is still hashed" {
  echo ".claude/" > .gitignore
  git add .gitignore
  git commit -q -m "gitignore .claude"
  echo "code" > foo.txt
  mkdir -p .claude
  printf '{"ignore":[]}\n' > .claude/review-cycle.json
  "$REVIEW_SENTINEL" mark
  # Edit the gitignored config to exclude foo.txt, then change foo.txt.
  # Without the fix, neither change reaches the hash and the gate passes.
  printf '{"ignore":["foo.txt"]}\n' > .claude/review-cycle.json
  echo "v2" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# X23: is_clean_tree must not take its fast path when the config is
# GITIGNORED. A gitignored config that has been edited would otherwise be
# invisible to git status and the fast-path would short-circuit before
# the sentinel compare can catch the drift.
@test "is_clean_tree skips fast-path when config is gitignored" {
  echo ".claude/" > .gitignore
  git add .gitignore
  git commit -q -m "gitignore .claude"
  mkdir -p .claude
  printf '{"ignore":[]}\n' > .claude/review-cycle.json
  # No mark exists; the fast path would have returned exit 0 (clean tree)
  # without seeing the config. The check-ignore guard forces not-clean
  # → sentinel lookup → no sentinel → drift.
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

# X24: regression guard: when the config is TRACKED (the recommended
# setup), is_clean_tree must keep the post-commit fast-path. The 0.6.0
# multi-commit-doesn't-drift property would otherwise be lost for any
# project that adopted review-cycle.json. With the config tracked, status
# can see edits to it, so we don't need to override the fast-path.
@test "tracked config preserves post-commit clean-tree fast-path" {
  echo "v1" > foo.txt
  mkdir -p .claude
  printf '{"ignore":[]}\n' > .claude/review-cycle.json
  git add foo.txt .claude/review-cycle.json
  git commit -q -m "init with tracked config"
  echo "v2" > foo.txt
  "$REVIEW_SENTINEL" mark
  git add foo.txt
  git commit -q -m "commit reviewed change"
  # Working tree is clean post-commit. Fast-path should keep check at 0
  # without falling through to a hash compare that would mismatch on the
  # untracked-to-tracked format transition.
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
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
