#!/usr/bin/env bats
# End-to-end tests for hooks/commit-gate.sh: pipe PreToolUse JSON to the
# script and assert on the emitted permission decision.
#
# The pass-through contract: a bare, path-anchored `review-sentinel
# accept-state` at command position, joined to the FIRST `git commit` by
# `&&` with nothing in between. Everything looser must deny, and so must
# the guarded `mark` verb, which is not part of this contract.

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
  "$REVIEW_SENTINEL" --root "$TEST_REPO" accept-state
  run run_hook "git commit -am 'msg'"
  assert_pass
}

# --- chained accept-state && commit: allowed shapes ---

@test "chained accept-state && git commit passes despite drift" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" accept-state && git commit -am 'msg'"
  assert_pass
}

@test "the exact form prescribed by accept SKILL.md passes (unexpanded plugin root)" {
  make_drift
  run run_hook '"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" accept-state && git commit -m "msg"'
  assert_pass
}

@test "cd repo && accept-state && git commit passes despite drift" {
  make_drift
  run run_hook "cd \"$TEST_REPO\" && \"$REVIEW_SENTINEL\" accept-state && git commit -am 'msg'"
  assert_pass
}

@test "commands before accept-state are allowed: git add -A && accept-state && git commit" {
  make_drift
  run run_hook "git add -A && \"$REVIEW_SENTINEL\" accept-state && git commit -m 'msg'"
  assert_pass
}

@test "line continuation between accept-state && and git commit passes" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" accept-state && \\
git commit -am 'msg'"
  assert_pass
}

@test "single-quoted sentinel path passes" {
  make_drift
  run run_hook "'$REVIEW_SENTINEL' accept-state && git commit -am 'msg'"
  assert_pass
}

@test "no space after && still passes: accept-state &&git commit" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" accept-state &&git commit -am 'msg'"
  assert_pass
}

@test "fully spaceless join passes: accept-state&&git commit" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" accept-state&&git commit -am 'msg'"
  assert_pass
}

@test "line ending in && continues onto the next line (bash semantics)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" accept-state &&
git commit -am 'msg'"
  assert_pass
}

@test "comment between accept-state && and the commit line passes (bash joins across it)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" accept-state && # sentinel updated
git commit -am 'msg'"
  assert_pass
}

# --- accept-state present but not guaranteed to gate the commit: denied ---

@test "accept-state; git commit (semicolon) is denied — a failed write would not stop the commit" {
  make_drift
  run run_hook "$REVIEW_SENTINEL accept-state; git commit -am 'msg'"
  assert_deny
}

@test "accept-state on an earlier line joined by newline is denied" {
  make_drift
  run run_hook "$REVIEW_SENTINEL accept-state
git commit -am 'msg'"
  assert_deny
}

@test "accept-state || git commit is denied — commit would run exactly when the write failed" {
  make_drift
  run run_hook "$REVIEW_SENTINEL accept-state || git commit -am 'msg'"
  assert_deny
}

@test "false && accept-state; git commit is denied — accept-state never executes" {
  make_drift
  run run_hook "false && $REVIEW_SENTINEL accept-state; git commit -am 'msg'"
  assert_deny
}

@test "command between accept-state and commit is denied — it could re-drift the tree" {
  make_drift
  run run_hook "$REVIEW_SENTINEL accept-state && git add -A && git commit -m 'msg'"
  assert_deny
}

@test "redirect after accept-state is denied (documented limitation)" {
  make_drift
  run run_hook "$REVIEW_SENTINEL accept-state > /dev/null && git commit -am 'msg'"
  assert_deny
}

@test "--root form is denied (documented: chained pass-through is bare accept-state only)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" --root $TEST_REPO accept-state && git commit -am 'msg'"
  assert_deny
}

@test "accept-state AFTER git commit does not pass the gate" {
  make_drift
  run run_hook "git commit -am 'msg' && $REVIEW_SENTINEL accept-state"
  assert_deny
}

@test "accept-state between two commits does not sanction the first commit" {
  make_drift
  run run_hook "git commit -am 'one' && $REVIEW_SENTINEL accept-state && git commit -am 'two'"
  assert_deny
}

@test "sentinel subcommand other than accept-state does not pass the gate" {
  make_drift
  run run_hook "$REVIEW_SENTINEL check && git commit -am 'msg'"
  assert_deny
}

@test "cycle-start && mark && git commit is denied — self-issued evidence is not a chain" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" cycle-start && \"$REVIEW_SENTINEL\" mark && git commit -am 'msg'"
  assert_deny
}

@test "chained mark && git commit is denied — the guarded verb is not the chain verb" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" mark && git commit -am 'msg'"
  assert_deny
}

# The real-world bypass: `mark` in one Bash call (which the gate never sees,
# having no git commit in it) and `git commit` in the next. With no review in
# progress the mark now refuses, so the second call still meets drift.
@test "two-call bypass: unguarded mark then commit is denied" {
  make_drift
  run "$REVIEW_SENTINEL" --root "$TEST_REPO" mark
  [ "$status" -eq 3 ]
  [ ! -f "$TEST_REPO/.claude/.review-mark" ]
  run run_hook "git commit -am 'msg'"
  assert_deny
}

@test "two-call flow after a real cycle-start passes" {
  make_drift
  "$REVIEW_SENTINEL" --root "$TEST_REPO" cycle-start
  "$REVIEW_SENTINEL" --root "$TEST_REPO" mark
  run run_hook "git commit -am 'msg'"
  assert_pass
}

# --- textual mentions of the phrase: denied ---

@test "unquoted echo of 'review-sentinel accept-state' is denied" {
  make_drift
  run run_hook "echo review-sentinel accept-state && git commit -am 'msg'"
  assert_deny
}

@test "quoted echo of the phrase is denied" {
  make_drift
  run run_hook "echo \"review-sentinel accept-state then commit\" && git commit -am 'msg'"
  assert_deny
}

@test "commit message mentioning 'review-sentinel accept-state' is denied" {
  make_drift
  run run_hook "git commit -am 'chore: run review-sentinel accept-state before commit'"
  assert_deny
}

@test "heredoc commit message mentioning the phrase is denied" {
  make_drift
  run run_hook "git commit -am \"\$(cat <<'EOF'
docs: explain review-sentinel accept-state usage
EOF
)\""
  assert_deny
}

@test "heredoc prose mentioning the phrase before the commit is denied" {
  make_drift
  run run_hook "cat <<'EOF' > NOTES.md
run review-sentinel accept-state first, then commit
EOF
git commit -am 'msg'"
  assert_deny
}

@test "test-filter argument containing the phrase is denied" {
  make_drift
  run run_hook "bin/run-bats -f \"review-sentinel accept-state writes hash\" t.bats && git commit -am 'msg'"
  assert_deny
}

@test "differently-named binary my-review-sentinel is denied" {
  make_drift
  run run_hook "my-review-sentinel accept-state && git commit -am 'msg'"
  assert_deny
}

@test "comment containing the accepted chain does not sanction a later commit" {
  make_drift
  run run_hook "# review-sentinel accept-state && git commit placeholder
git commit -am 'actual'"
  assert_deny
}

@test "second commit after a marked first commit is denied (semicolon tail)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" accept-state && git commit -m 'a'; echo evil >> f; git add f; git commit -m 'b'"
  assert_deny
}

@test "second commit after a marked first commit is denied (&& tail)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" accept-state && git commit -m 'a' && echo evil >> f && git add f && git commit -m 'b'"
  assert_deny
}

@test "heredoc line that is a literal accept-state-&&-commit chain does not sanction a real commit" {
  make_drift
  run run_hook "cat <<'EOF' > DOC.md
review-sentinel accept-state && git commit -m \"msg\"
EOF
git commit -am 'actual'"
  assert_deny
}

@test "quoted prose ending in the accepted chain does not sanction a real commit" {
  make_drift
  run run_hook "echo '& review-sentinel accept-state && git commit' ; git commit -am 'msg'"
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
  "$REVIEW_SENTINEL" --root "$TEST_REPO" accept-state
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
  run run_hook "\"$REVIEW_SENTINEL\" accept-state && git committed-x ; git commit -m 'msg'"
  assert_deny
}

@test "quoted # in a commit message does not hide a second commit" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" accept-state && git commit -m 'fix #12' && git commit -m 'sneaky'"
  assert_deny
}

@test "quoted # later in the chain does not hide the tail commit" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" accept-state && git commit -m 'ok' && echo 'x #' && git add drift.txt && git commit -m 'evil'"
  assert_deny
}

@test "options on the chained commit are denied (documented: plain git commit only)" {
  make_drift
  run run_hook "\"$REVIEW_SENTINEL\" accept-state && git -c user.name=x commit -m 'msg'"
  assert_deny
}

@test "|| before accept-state is denied — the write may be short-circuited away" {
  make_drift
  run run_hook "true || \"$REVIEW_SENTINEL\" accept-state && git commit -am 'msg'"
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
