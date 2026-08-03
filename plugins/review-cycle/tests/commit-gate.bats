#!/usr/bin/env bats
# End-to-end tests for hooks/commit-gate.sh: pipe PreToolUse JSON to the
# script and assert on the emitted permission decision.
#
# The pass-through contract: a bare, path-anchored `review-sentinel mark` at
# command position, joined to the FIRST `git commit` by `&&` with nothing in
# between. Everything looser must deny.

setup() {
  load 'helpers'
  setup_repo
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
}

run_hook() {
  local cmd="$1"
  jq -n --arg cmd "$cmd" --arg cwd "$TEST_REPO" \
    '{tool_input: {command: $cmd}, cwd: $cwd}' \
    | bash "$PLUGIN_ROOT/hooks/commit-gate.sh"
}

run_hook_from() {
  local cwd="$1" cmd="$2"
  cd "$cwd"
  jq -n --arg cmd "$cmd" --arg cwd "$cwd" \
    '{tool_input: {command: $cmd}, cwd: $cwd}' \
    | bash "$PLUGIN_ROOT/hooks/commit-gate.sh"
}

make_drift() {
  echo "unreviewed" > "$TEST_REPO/drift.txt"
}

# Creates a second repo with one clean commit; echoes its canonical path.
make_other_repo() {
  mkdir -p "$BATS_TEST_TMPDIR/$1"
  local r
  r="$(cd "$BATS_TEST_TMPDIR/$1" && pwd -P)"
  git -C "$r" init -q
  git -C "$r" config user.email "test@example.com"
  git -C "$r" config user.name "Test"
  git -C "$r" commit --allow-empty -q -m "init"
  echo "$r"
}

assert_pass() {
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

assert_deny() {
  [ "$status" -eq 0 ]
  echo "$output" | grep -q '"permissionDecision": *"deny"'
}

# --- baseline gate behavior ---

@test "non-commit command passes through silently" {
  make_drift
  run run_hook "ls -la"
  assert_pass
}

@test "git commit on clean tree passes" {
  run run_hook "git commit -m 'msg'"
  assert_pass
}

@test "git commit with drift and no sentinel is denied" {
  make_drift
  run run_hook "git commit -am 'msg'"
  assert_deny
}

@test "git commit with matching sentinel passes" {
  make_drift
  "$REVIEW_SENTINEL" --root "$TEST_REPO" mark
  run run_hook "git commit -am 'msg'"
  assert_pass
}

# --- chained mark && commit: allowed shapes ---

@test "chained mark && git commit passes despite drift" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark && git commit -am 'msg'"
  assert_pass
}

@test "the exact form prescribed by accept SKILL.md passes (unexpanded plugin root)" {
  make_drift
  run run_hook '"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" mark && git commit -m "msg"'
  assert_pass
}

@test "cd repo && mark && git commit passes despite drift" {
  make_drift
  run run_hook "cd \"$TEST_REPO\" && \"$REVIEW_SENTINEL\" mark && git commit -am 'msg'"
  assert_pass
}

@test "commands before the mark are allowed: git add -A && mark && git commit" {
  make_drift
  run run_hook "git add -A && \"$REVIEW_SENTINEL\" mark && git commit -m 'msg'"
  assert_pass
}

@test "line continuation between mark && and git commit passes" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark && \\
git commit -am 'msg'"
  assert_pass
}

@test "single-quoted sentinel path passes" {
  make_drift
  run run_hook "'$REVIEW_SENTINEL' mark && git commit -am 'msg'"
  assert_pass
}

@test "no space after && still passes: mark &&git commit" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark &&git commit -am 'msg'"
  assert_pass
}

@test "fully spaceless join passes: mark&&git commit" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark&&git commit -am 'msg'"
  assert_pass
}

@test "line ending in && continues onto the next line (bash semantics)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark &&
git commit -am 'msg'"
  assert_pass
}

@test "comment between mark && and the commit line passes (bash joins across it)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark && # sentinel updated
git commit -am 'msg'"
  assert_pass
}

# --- mark present but not guaranteed to gate the commit: denied ---

@test "mark; git commit (semicolon) is denied — a failed mark would not stop the commit" {
  make_drift
  run run_hook "$REVIEW_SENTINEL mark; git commit -am 'msg'"
  assert_deny
}

@test "mark on earlier line joined by newline is denied" {
  make_drift
  run run_hook "$REVIEW_SENTINEL mark
git commit -am 'msg'"
  assert_deny
}

@test "mark || git commit is denied — commit would run exactly when mark failed" {
  make_drift
  run run_hook "$REVIEW_SENTINEL mark || git commit -am 'msg'"
  assert_deny
}

@test "false && mark; git commit is denied — mark never executes" {
  make_drift
  run run_hook "false && $REVIEW_SENTINEL mark; git commit -am 'msg'"
  assert_deny
}

@test "command between mark and commit is denied — it could re-drift the tree" {
  make_drift
  run run_hook "$REVIEW_SENTINEL mark && git add -A && git commit -m 'msg'"
  assert_deny
}

@test "redirect after mark is denied (documented limitation)" {
  make_drift
  run run_hook "$REVIEW_SENTINEL mark > /dev/null && git commit -am 'msg'"
  assert_deny
}

@test "--root form is denied (documented: chained pass-through is bare mark only)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" --root $TEST_REPO mark && git commit -am 'msg'"
  assert_deny
}

@test "mark AFTER git commit does not pass the gate" {
  make_drift
  run run_hook "git commit -am 'msg' && $REVIEW_SENTINEL mark"
  assert_deny
}

@test "mark between two commits does not sanction the first commit" {
  make_drift
  run run_hook "git commit -am 'one' && $REVIEW_SENTINEL mark && git commit -am 'two'"
  assert_deny
}

@test "sentinel subcommand other than mark does not pass the gate" {
  make_drift
  run run_hook "$REVIEW_SENTINEL check && git commit -am 'msg'"
  assert_deny
}

# --- textual mentions of the phrase: denied ---

@test "unquoted echo of 'review-sentinel mark' is denied" {
  make_drift
  run run_hook "echo review-sentinel mark && git commit -am 'msg'"
  assert_deny
}

@test "quoted echo of the phrase is denied" {
  make_drift
  run run_hook "echo \"review-sentinel mark then commit\" && git commit -am 'msg'"
  assert_deny
}

@test "commit message mentioning 'review-sentinel mark' is denied" {
  make_drift
  run run_hook "git commit -am 'chore: run review-sentinel mark before commit'"
  assert_deny
}

@test "heredoc commit message mentioning the phrase is denied" {
  make_drift
  run run_hook "git commit -am \"\$(cat <<'EOF'
docs: explain review-sentinel mark usage
EOF
)\""
  assert_deny
}

@test "heredoc prose mentioning the phrase before the commit is denied" {
  make_drift
  run run_hook "cat <<'EOF' > NOTES.md
run review-sentinel mark first, then commit
EOF
git commit -am 'msg'"
  assert_deny
}

@test "test-filter argument containing the phrase is denied" {
  make_drift
  run run_hook "bin/run-bats -f \"review-sentinel mark writes hash\" t.bats && git commit -am 'msg'"
  assert_deny
}

@test "differently-named binary my-review-sentinel is denied" {
  make_drift
  run run_hook "my-review-sentinel mark && git commit -am 'msg'"
  assert_deny
}

@test "comment containing the accepted chain does not sanction a later commit" {
  make_drift
  run run_hook "# review-sentinel mark && git commit placeholder
git commit -am 'actual'"
  assert_deny
}

@test "second commit after a marked first commit is denied (semicolon tail)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark && git commit -m 'a'; echo evil >> f; git add f; git commit -m 'b'"
  assert_deny
}

@test "second commit after a marked first commit is denied (&& tail)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark && git commit -m 'a' && echo evil >> f && git add f && git commit -m 'b'"
  assert_deny
}

@test "heredoc line that is a literal mark-&&-commit chain does not sanction a real commit" {
  make_drift
  run run_hook "cat <<'EOF' > DOC.md
review-sentinel mark && git commit -m \"msg\"
EOF
git commit -am 'actual'"
  assert_deny
}

@test "quoted prose ending in the accepted chain does not sanction a real commit" {
  make_drift
  run run_hook "echo '& review-sentinel mark && git commit' ; git commit -am 'msg'"
  assert_deny
}

# --- git global-option forms reach the gate ---

@test "git -C <repo> commit is denied under drift (from outside the repo)" {
  make_drift
  run run_hook_from "$BATS_TEST_TMPDIR" "git -C \"$TEST_REPO\" commit -am 'msg'"
  assert_deny
}

@test "git -C <repo> commit passes with matching sentinel" {
  make_drift
  "$REVIEW_SENTINEL" --root "$TEST_REPO" mark
  run run_hook_from "$BATS_TEST_TMPDIR" "git -C \"$TEST_REPO\" commit -am 'msg'"
  assert_pass
}

@test "git -c key=val commit is denied under drift" {
  make_drift
  run run_hook "git -c core.editor=true commit -am 'msg'"
  assert_deny
}

@test "git -c ... -C <repo> commit resolves the -C repo (option before -C)" {
  make_drift
  run run_hook_from "$BATS_TEST_TMPDIR" "git -c core.editor=true -C \"$TEST_REPO\" commit -am 'msg'"
  assert_deny
}

@test "quoted -C path containing spaces is detected" {
  local spaced
  spaced=$(make_other_repo "repo two")
  echo "unreviewed" > "$spaced/drift.txt"
  run run_hook_from "$BATS_TEST_TMPDIR" "git -C \"$spaced\" commit -am 'msg'"
  assert_deny
}

@test "relative -C path resolves against the payload cwd" {
  make_drift
  run run_hook_from "$BATS_TEST_TMPDIR" "git -C repo commit -am 'msg'"
  assert_deny
}

@test "cd into a clean repo does not outrank the commit's -C repo" {
  make_drift
  local other
  other=$(make_other_repo "cleanrepo")
  run run_hook_from "$other" "cd \"$other\" && git -C \"$TEST_REPO\" commit -am 'msg'"
  assert_deny
}

@test "a later git -C does not override the commit's own -C" {
  make_drift
  local other
  other=$(make_other_repo "cleanrepo")
  run run_hook_from "$BATS_TEST_TMPDIR" "git -C \"$TEST_REPO\" commit -am 'msg' && git -C \"$other\" log"
  assert_deny
}

@test "commit message mentioning git -C a clean repo does not steer the gate" {
  make_drift
  local other
  other=$(make_other_repo "cleanrepo")
  run run_hook "git commit -am \"validated via git -C $other earlier\""
  assert_deny
}

@test "subshell commit is detected" {
  make_drift
  run run_hook "(git commit -am 'msg')"
  assert_deny
}

@test "backtick command substitution commit is detected" {
  make_drift
  run run_hook 'v=`git commit -am "msg"`'
  assert_deny
}

@test "backslash-continued git commit is detected" {
  make_drift
  run run_hook 'git \
commit -am "msg"'
  assert_deny
}

@test "decoy token git committed-x does not stand in for the real commit" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark && git committed-x ; git commit -m 'msg'"
  assert_deny
}

@test "quoted # in a commit message does not hide a second commit" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark && git commit -m 'fix #12' && git commit -m 'sneaky'"
  assert_deny
}

@test "quoted # later in the chain does not hide the tail commit" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark && git commit -m 'ok' && echo 'x #' && git add drift.txt && git commit -m 'evil'"
  assert_deny
}

@test "options on the chained commit are denied (documented: plain git commit only)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark && git -c user.name=x commit -m 'msg'"
  assert_deny
}

@test "|| before the mark is denied — the mark may be short-circuited away" {
  make_drift
  run run_hook "true || \"$REVIEW_SENTINEL\" mark && git commit -am 'msg'"
  assert_deny
}

@test "prose mentioning git -C a clean repo BEFORE the commit does not steer the gate" {
  make_drift
  local other
  other=$(make_other_repo "cleanrepo")
  run run_hook "echo 'run: git -C $other commit' > notes.txt && git commit -am 'msg'"
  assert_deny
}

@test "with two -C flags the last one wins, matching git" {
  make_drift
  local other
  other=$(make_other_repo "cleanrepo")
  run run_hook_from "$BATS_TEST_TMPDIR" "git -C \"$other\" -C \"$TEST_REPO\" commit -am 'msg'"
  assert_deny
}

@test "git --git-dir --work-tree with separate arguments is detected" {
  make_drift
  run run_hook "git --git-dir \"$TEST_REPO/.git\" --work-tree \"$TEST_REPO\" commit -am 'msg'"
  assert_deny
}

@test "git -c with a quoted spaced value is detected" {
  make_drift
  run run_hook "git -c user.name='Jace Babin' commit -am 'msg'"
  assert_deny
}

@test "relative -C after a leading cd resolves against the cd target" {
  make_drift
  local other
  other=$(make_other_repo "cleanrepo")
  run run_hook_from "$other" "cd \"$BATS_TEST_TMPDIR\" && git -C repo commit -am 'msg'"
  assert_deny
}
