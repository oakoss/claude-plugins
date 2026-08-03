#!/usr/bin/env bats
# Tests for `review-sentinel install-hook`: manager detection, marker
# management, and end-to-end commit gating through a real git pre-commit
# hook with the CLAUDECODE env guard.

setup() {
  load 'helpers'
  setup_repo
  # The session running these tests exports agent markers; tests set them
  # explicitly per case.
  unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT
}

hook_path() {
  local p
  p=$(git -C "$TEST_REPO" rev-parse --git-path hooks)
  case "$p" in
    /*) echo "$p/pre-commit" ;;
    *) echo "$TEST_REPO/$p/pre-commit" ;;
  esac
}

make_drift() {
  echo "unreviewed" > "$TEST_REPO/drift.txt"
  git -C "$TEST_REPO" add drift.txt
}

# --- plain-git installation mechanics ---

@test "install creates an executable pre-commit with markers" {
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ "$status" -eq 0 ]
  local hp
  hp=$(hook_path)
  [ -x "$hp" ]
  grep -qF ">>> review-cycle gate >>>" "$hp"
  grep -qF "<<< review-cycle gate <<<" "$hp"
  head -1 "$hp" | grep -q '^#!/bin/sh'
}

@test "reinstall is idempotent — exactly one marker block" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ "$(grep -cF '>>> review-cycle gate >>>' "$(hook_path)")" -eq 1 ]
}

@test "install relocates an existing foreign hook to .local and still runs it" {
  local hp
  hp=$(hook_path)
  mkdir -p "$(dirname "$hp")"
  printf '#!/bin/sh\necho foreign-hook-ran >> "%s/hook-log"\n' "$TEST_REPO" > "$hp"
  chmod +x "$hp"
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ -f "$hp.local" ]
  grep -q "foreign-hook-ran" "$hp.local"
  grep -qF ">>> review-cycle gate >>>" "$hp"
  git -C "$TEST_REPO" commit --allow-empty -m x
  [ -f "$TEST_REPO/hook-log" ]
}

@test "foreign hook ending in exit 0 no longer defeats the gate" {
  local hp
  hp=$(hook_path)
  mkdir -p "$(dirname "$hp")"
  printf '#!/bin/sh\n# existing hook\nexit 0\n' > "$hp"
  chmod +x "$hp"
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  make_drift
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "unreviewed"
  [ "$status" -ne 0 ]
}

@test "a failing foreign hook still blocks the commit (status preserved)" {
  local hp
  hp=$(hook_path)
  mkdir -p "$(dirname "$hp")"
  printf '#!/bin/sh\necho lint-failed >&2\nexit 3\n' > "$hp"
  chmod +x "$hp"
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  run git -C "$TEST_REPO" commit --allow-empty -m x
  [ "$status" -ne 0 ]
  [[ "$output" == *"lint-failed"* ]]
}

@test "non-shell foreign hook is preserved and executed via its interpreter" {
  local hp
  hp=$(hook_path)
  mkdir -p "$(dirname "$hp")"
  printf '#!/usr/bin/env python3\nopen("%s/py-log","w").write("ran")\n' "$TEST_REPO" > "$hp"
  chmod +x "$hp"
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  git -C "$TEST_REPO" commit --allow-empty -m x
  [ -f "$TEST_REPO/py-log" ]
}

@test "reinstall over a marker file with extra foreign content relocates that content" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook >/dev/null
  local hp
  hp=$(hook_path)
  # Simulate the append-era shape: a foreign line living outside the markers.
  { head -1 "$hp"
    printf 'echo appended-era-foreign >> "%s/hook-log"\n' "$TEST_REPO"
    sed 1d "$hp"
  } > "$hp.new"
  mv "$hp.new" "$hp"
  chmod +x "$hp"
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ "$status" -eq 0 ]
  [ -f "$hp.local" ]
  grep -q "appended-era-foreign" "$hp.local"
  ! grep -q "appended-era-foreign" "$hp"
  [ "$(grep -cF '>>> review-cycle gate >>>' "$hp")" -eq 1 ]
  git -C "$TEST_REPO" commit --allow-empty -m x
  [ -f "$TEST_REPO/hook-log" ]
}

@test "a git-tracked hook file is never rewritten (snippet instead)" {
  git -C "$TEST_REPO" config core.hooksPath .husky
  mkdir -p "$TEST_REPO/.husky"
  printf '#!/bin/sh\nnpm test\n' > "$TEST_REPO/.husky/pre-commit"
  chmod +x "$TEST_REPO/.husky/pre-commit"
  git -C "$TEST_REPO" add .husky/pre-commit
  git -C "$TEST_REPO" commit -qm "husky hook" --no-verify
  local before
  before=$(cat "$TEST_REPO/.husky/pre-commit")
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_REPO/.husky/pre-commit")" = "$before" ]
  [ ! -f "$TEST_REPO/.husky/pre-commit.local" ]
  [[ "$output" == *"tracked by git"* ]]
  [ -x "$TEST_REPO/.claude/review-cycle-pre-commit.sh" ]
}

@test "relocating a non-executable foreign hook warns that the chain skips it" {
  local hp
  hp=$(hook_path)
  mkdir -p "$(dirname "$hp")"
  printf '#!/bin/sh\ntrue\n' > "$hp"
  chmod -x "$hp"
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"not executable"* ]]
}

@test "install refuses when both a foreign hook and .local already exist" {
  local hp
  hp=$(hook_path)
  mkdir -p "$(dirname "$hp")"
  printf '#!/bin/sh\ntrue\n' > "$hp"
  printf '#!/bin/sh\ntrue\n' > "$hp.local"
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ "$status" -ne 0 ]
  [[ "$output" == *"resolve manually"* ]]
}

@test "install lands in a core.hooksPath dir (husky-style)" {
  git -C "$TEST_REPO" config core.hooksPath .husky
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  grep -qF ">>> review-cycle gate >>>" "$TEST_REPO/.husky/pre-commit"
}

# --- end-to-end gating through git ---

@test "agent commit of unreviewed changes is blocked at commit time" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  make_drift
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "unreviewed"
  [ "$status" -ne 0 ]
  [[ "$output" == *"review-cycle: unreviewed changes"* ]]
}

@test "CLAUDE_CODE_ENTRYPOINT alone triggers gating" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  make_drift
  export CLAUDE_CODE_ENTRYPOINT=cli
  run git -C "$TEST_REPO" commit -m "unreviewed"
  [ "$status" -ne 0 ]
}

@test "global kill-switch disables the installed hook" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  make_drift
  touch "$HOME/.claude/.disable-review-gate"
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "opted out"
  [ "$status" -eq 0 ]
}

@test "legacy .no-review-gate marker disables the installed hook" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  make_drift
  mkdir -p "$TEST_REPO/.claude"
  touch "$TEST_REPO/.claude/.no-review-gate"
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "opted out"
  [ "$status" -eq 0 ]
}

@test "review-cycle.json disabled:true disables the installed hook" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  make_drift
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":true}\n' > "$TEST_REPO/.claude/review-cycle.json"
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "opted out"
  [ "$status" -eq 0 ]
}

@test "disabled:false overrides a stale legacy marker (still gated)" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  make_drift
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":false}\n' > "$TEST_REPO/.claude/review-cycle.json"
  touch "$TEST_REPO/.claude/.no-review-gate"
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "unreviewed"
  [ "$status" -ne 0 ]
}

@test "marked partial commit (pathspec, temp index) passes" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  echo "a" > "$TEST_REPO/a.txt"
  echo "b" > "$TEST_REPO/b.txt"
  git -C "$TEST_REPO" add a.txt b.txt
  "$REVIEW_SENTINEL" --root "$TEST_REPO" mark
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "partial" -- a.txt
  [ "$status" -eq 0 ]
}

@test "unreviewed partial commit blocks" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  echo "a" > "$TEST_REPO/a.txt"
  git -C "$TEST_REPO" add a.txt
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "partial" -- a.txt
  [ "$status" -ne 0 ]
}

@test "commit from a repo subdirectory is gated" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  make_drift
  mkdir -p "$TEST_REPO/sub"
  export CLAUDECODE=1
  run bash -c "cd '$TEST_REPO/sub' && git commit -m unreviewed"
  [ "$status" -ne 0 ]
}

@test "install works from a binary path containing a dollar sign" {
  mkdir -p "$BATS_TEST_TMPDIR/dol\$lar"
  cp "$REVIEW_SENTINEL" "$BATS_TEST_TMPDIR/dol\$lar/review-sentinel"
  chmod +x "$BATS_TEST_TMPDIR/dol\$lar/review-sentinel"
  "$BATS_TEST_TMPDIR/dol\$lar/review-sentinel" --root "$TEST_REPO" install-hook
  make_drift
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "unreviewed"
  [ "$status" -ne 0 ]
}

@test "human commit (no env) passes despite drift" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  make_drift
  run git -C "$TEST_REPO" commit -m "human"
  [ "$status" -eq 0 ]
}

@test "agent commit after mark passes" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  make_drift
  "$REVIEW_SENTINEL" --root "$TEST_REPO" mark
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "reviewed"
  [ "$status" -eq 0 ]
}

@test "missing binary fails open" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  local hp
  hp=$(hook_path)
  sed -i.bak "s|rs='.*'|rs='/nonexistent/review-sentinel'|" "$hp"
  make_drift
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "plugin gone"
  [ "$status" -eq 0 ]
}

@test "check rc=2 fails open" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  cat > "$BATS_TEST_TMPDIR/stub-rs" <<'EOF'
#!/bin/sh
exit 2
EOF
  chmod +x "$BATS_TEST_TMPDIR/stub-rs"
  local hp
  hp=$(hook_path)
  sed -i.bak "s|rs='.*'|rs='$BATS_TEST_TMPDIR/stub-rs'|" "$hp"
  make_drift
  export CLAUDECODE=1
  run git -C "$TEST_REPO" commit -m "check errored"
  [ "$status" -eq 0 ]
}

@test "hook fires for commits in a linked worktree" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  git -C "$TEST_REPO" worktree add -q "$BATS_TEST_TMPDIR/wt" -b wt-branch
  local wt
  wt="$(cd "$BATS_TEST_TMPDIR/wt" && pwd -P)"
  echo "unreviewed" > "$wt/drift.txt"
  git -C "$wt" add drift.txt
  export CLAUDECODE=1
  run git -C "$wt" commit -m "unreviewed in worktree"
  [ "$status" -ne 0 ]
}

# --- manager-aware paths ---

@test "lefthook repo: helper written and job appended when no pre-commit key" {
  printf 'pre-push:\n  commands:\n    test:\n      run: true\n' > "$TEST_REPO/lefthook.yml"
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ "$status" -eq 0 ]
  [ -x "$TEST_REPO/.claude/review-cycle-pre-commit.sh" ]
  grep -q "review-cycle-pre-commit.sh" "$TEST_REPO/lefthook.yml"
  grep -qE '^pre-commit:' "$TEST_REPO/lefthook.yml"
  [ ! -f "$(hook_path)" ]
}

@test "lefthook repo: existing pre-commit key is not mutated, snippet printed" {
  printf 'pre-commit:\n  commands:\n    lint:\n      run: true\n' > "$TEST_REPO/lefthook.yml"
  local before
  before=$(cat "$TEST_REPO/lefthook.yml")
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_REPO/lefthook.yml")" = "$before" ]
  [[ "$output" == *"add this job"* ]]
  [ -x "$TEST_REPO/.claude/review-cycle-pre-commit.sh" ]
}

@test "lefthook repo: rerun after wiring reports already present" {
  printf 'pre-push:\n  commands:\n    test:\n      run: true\n' > "$TEST_REPO/lefthook.yml"
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"already present"* ]]
  [ "$(grep -c 'review-cycle-pre-commit.sh' "$TEST_REPO/lefthook.yml")" -eq 1 ]
}

@test "lefthook helper gates a commit when run as the job would run it" {
  printf 'pre-push: {}\n' > "$TEST_REPO/lefthook.yml"
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  make_drift
  export CLAUDECODE=1
  run bash -c "cd '$TEST_REPO' && sh -c 'test ! -f .claude/review-cycle-pre-commit.sh || sh .claude/review-cycle-pre-commit.sh'"
  [ "$status" -ne 0 ]
}

@test "pre-commit repo: config untouched, snippet printed, helper written" {
  printf 'repos: []\n' > "$TEST_REPO/.pre-commit-config.yaml"
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_REPO/.pre-commit-config.yaml")" = "repos: []" ]
  [[ "$output" == *"repo: local"* ]]
  [ -x "$TEST_REPO/.claude/review-cycle-pre-commit.sh" ]
  [ ! -f "$(hook_path)" ]
}

@test "simple-git-hooks repo: package.json untouched, snippet printed" {
  printf '{"simple-git-hooks":{"pre-commit":"npm test"}}\n' > "$TEST_REPO/package.json"
  local before
  before=$(cat "$TEST_REPO/package.json")
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ "$status" -eq 0 ]
  [ "$(cat "$TEST_REPO/package.json")" = "$before" ]
  [[ "$output" == *"simple-git-hooks"* ]]
  [ -x "$TEST_REPO/.claude/review-cycle-pre-commit.sh" ]
}

@test "install-hook outside a git repo exits 1" {
  mkdir -p "$BATS_TEST_TMPDIR/notarepo"
  cd "$BATS_TEST_TMPDIR/notarepo"
  run "$REVIEW_SENTINEL" install-hook
  [ "$status" -eq 1 ]
}

@test "lefthook install fails loudly when config is read-only" {
  printf 'pre-push: {}\n' > "$TEST_REPO/lefthook.yml"
  chmod a-w "$TEST_REPO/lefthook.yml"
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  chmod u+w "$TEST_REPO/lefthook.yml"
  [ "$status" -ne 0 ]
  [[ "$output" == *"cannot append"* ]]
  [[ "$output" != *"job appended"* ]]
}

# --- uninstall-hook ---

@test "uninstall restores a relocated foreign hook" {
  local hp
  hp=$(hook_path)
  mkdir -p "$(dirname "$hp")"
  printf '#!/bin/sh\necho original\n' > "$hp"
  chmod +x "$hp"
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" uninstall-hook
  [ "$status" -eq 0 ]
  grep -q "echo original" "$hp"
  ! grep -qF ">>> review-cycle gate >>>" "$hp"
  [ ! -f "$hp.local" ]
}

@test "uninstall removes a gate-only hook entirely" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" uninstall-hook
  [ "$status" -eq 0 ]
  [ ! -f "$(hook_path)" ]
}

@test "uninstall removes the lefthook helper" {
  printf 'pre-push: {}\n' > "$TEST_REPO/lefthook.yml"
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  [ -f "$TEST_REPO/.claude/review-cycle-pre-commit.sh" ]
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" uninstall-hook
  [ "$status" -eq 0 ]
  [ ! -f "$TEST_REPO/.claude/review-cycle-pre-commit.sh" ]
}

@test "uninstall with nothing installed reports and exits 0" {
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" uninstall-hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"nothing to uninstall"* ]]
}

@test "uninstall fails loudly when the hook cannot be removed" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook
  local hd
  hd=$(dirname "$(hook_path)")
  chmod a-w "$hd"
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" uninstall-hook
  chmod u+w "$hd"
  [ "$status" -ne 0 ]
  [[ "$output" == *"cannot"* ]]
}

@test "uninstall keeps non-managed content that lives outside the markers" {
  "$REVIEW_SENTINEL" --root "$TEST_REPO" install-hook >/dev/null
  local hp
  hp=$(hook_path)
  { head -1 "$hp"
    printf 'echo user-added\n'
    sed 1d "$hp"
  } > "$hp.new"
  mv "$hp.new" "$hp"
  chmod +x "$hp"
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" uninstall-hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"non-managed hook content kept"* ]]
  [ -f "$hp" ]
  grep -q "user-added" "$hp"
  ! grep -qF ">>> review-cycle gate >>>" "$hp"
}

@test "uninstall warns when a relocated .local hook is stranded" {
  local hp
  hp=$(hook_path)
  mkdir -p "$(dirname "$hp")"
  printf '#!/bin/sh\ntrue\n' > "$hp"
  printf '#!/bin/sh\necho original\n' > "$hp.local"
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" uninstall-hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"NOT running"* ]]
}
