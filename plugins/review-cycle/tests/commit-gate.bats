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
  assert_matches "$output" '"permissionDecision": *"deny"'
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
  [ ! -f "$TEST_REPO/.claude/review-cycle/mark" ]
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

# --- the gate is scoped to the project, not to every repo in reach ---
#
# Reviewer agents build scratch repos to perturb a copy of the target: a
# worktree at the base revision to diff against, a fixture with real history.
# Blocking those taught agents to route around the gate instead.

@test "a commit in a scratch repo passes while the project has drift" {
  make_drift
  local scratch
  scratch=$(make_other_repo "scratch")
  echo "wip" > "$scratch/f.txt"
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "git -C \"$scratch\" commit -am 'fixture'"
  assert_pass
}

@test "cd into a scratch repo then commit passes while the project has drift" {
  make_drift
  local scratch
  scratch=$(make_other_repo "scratch")
  echo "wip" > "$scratch/f.txt"
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "cd \"$scratch\" && git commit -am 'fixture'"
  assert_pass
}

# The hook runs before the command does, so the repo the command is about to
# build is not on disk yet. Resolving that miss to the project would block
# exactly the setup step reviewers need.
@test "a commit in a repo the command has not created yet passes" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "cd \"$BATS_TEST_TMPDIR\" && mkdir fixture && cd fixture && git init -q && git commit --allow-empty -m base"
  assert_pass
}

@test "the project root still blocks when a scratch repo is also in play" {
  make_drift
  local scratch
  scratch=$(make_other_repo "scratch")
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "cd \"$scratch\" && ls; cd \"$TEST_REPO\" && git commit -am 'msg'"
  assert_deny
}

# Routing on the first cd would read this as a scratch commit and wave it past.
@test "a later cd back into the project is where the commit lands" {
  make_drift
  local scratch
  scratch=$(make_other_repo "scratch")
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "cd \"$scratch\" && cd \"$TEST_REPO\" && git commit -am 'msg'"
  assert_deny
}

@test "relative hops compose, as they do in bash" {
  make_drift
  mkdir -p "$BATS_TEST_TMPDIR/nest"
  local nest
  nest="$(cd "$BATS_TEST_TMPDIR/nest" && pwd -P)"
  git -C "$nest" init -q
  git -C "$nest" -c user.email=t@e.x -c user.name=T commit --allow-empty -q -m init
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook_from "$BATS_TEST_TMPDIR" "cd nest && git commit --allow-empty -m x"
  assert_pass
}

# The hop only exists inside a quoted argument, so it cannot move the commit.
# The separator matters: with a `;` the quoted text puts `cd` at what looks
# like command position, which is the case the skeleton comparison is for.
@test "a cd mentioned in carried text does not route the gate away" {
  make_drift
  local scratch
  scratch=$(make_other_repo "scratch")
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "echo \"setup: cd $scratch\" > notes.txt && git commit -am 'msg'"
  assert_deny
  run run_hook "echo \"setup; cd $scratch\" > notes.txt && git commit -am 'msg'"
  assert_deny
  run run_hook "bd create --description='then; cd $scratch' && git commit -am 'msg'"
  assert_deny
  # This one reads as a perfectly clean hop — the quote falls outside the
  # token, so only the skeleton knows no `cd` was ever written.
  run run_hook "echo \"; cd $scratch \" > notes.txt && git commit -am 'msg'"
  assert_deny
}

@test "an unknown project root still gates the repo the commit targets" {
  make_drift
  unset CLAUDE_PROJECT_DIR
  run run_hook_from "$BATS_TEST_TMPDIR" "git -C \"$TEST_REPO\" commit -am 'msg'"
  assert_deny
}

# --- the escape hatches the deny message points users at ---
#
# gate_should_run is the only place this hook honors either one, and deleting
# that call left every other test green.

@test "the global kill-switch passes a commit through" {
  make_drift
  touch "$HOME/.claude/.disable-review-gate"
  run run_hook "git commit -am 'msg'"
  assert_pass
}

@test "a project opted out with review-cycle.json passes a commit through" {
  make_drift
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled": true}\n' > "$TEST_REPO/.claude/review-cycle.json"
  run run_hook "git commit -am 'msg'"
  assert_pass
}

# --- fail-closed table: the commit lands in the project, so the gate holds ---
#
# Every shape here reached the project under an earlier cut of the scoping
# change. Reading text is not running it, and each of these is a place where
# the difference shows: bash expands, short-circuits, or fails a `cd` in a way
# the text alone does not say. Deciding "elsewhere" on any of them waves an
# unreviewed commit through, so an unproven answer must gate instead.

@test "a substitution inside double quotes still runs the commit" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook 'echo "$(git commit -m x)"'
  assert_deny
  run run_hook 'FOO="`git commit -m x`"'
  assert_deny
}

# The lexer tracks substitution nesting so a quoted `$( )` survives blanking.
# Without that, the redirect guard reads a skeleton where GIT_DIR has vanished
# and routing walks off to the scratch repo — while every other test stays
# green, which is why these two shapes are pinned here by name.
@test "a substitution inside quotes is still code after a cd" {
  make_drift
  local other
  other=$(make_other_repo "elsewhere")
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "cd \"$other\"; echo \"\$(git commit -m x)\""
  assert_deny
  run run_hook "cd \"$other\"; echo \"\$(GIT_DIR=$TEST_REPO/.git git commit -m x)\""
  assert_deny
}

@test "an unquoted heredoc expands its body" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "cat <<EOF > f
\$(git commit -m x)
EOF"
  assert_deny
}

@test "a shell reading the body off a pipe still runs it" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "echo 'git commit -m x' | sh"
  assert_deny
  run run_hook "bash -lc \"git commit -m x\""
  assert_deny
}

@test "a cd bash may never reach does not move the commit" {
  make_drift
  local other
  other=$(make_other_repo "elsewhere")
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "false && cd \"$other\"; git commit -m x"
  assert_deny
  run run_hook "(cd \"$other\" && true); git commit -m x"
  assert_deny
  run run_hook "f() { cd \"$other\" ; } ; git commit -m x"
  assert_deny
}

# A hop inside a substitution runs in a subshell the parent never leaves, and
# one inside a branch may never run at all. Neither shows up in the separators.
@test "a cd in a subshell or a branch does not move the commit" {
  make_drift
  local other
  other=$(make_other_repo "elsewhere")
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "echo \`cd \"$other\"\` && git commit -m x"
  assert_deny
  run run_hook "echo \$(cd \"$other\") && git commit -m x"
  assert_deny
  run run_hook "if false; then cd \"$other\"; fi; git commit -m x"
  assert_deny
  run run_hook "for d in \"$other\"; do cd \"\$d\"; done; git commit -m x"
  assert_deny
}

# `cd -` goes wherever OLDPWD points, which the text does not say — including
# back into the project, even when the session is sitting somewhere else.
@test "a cd the gate cannot resolve gates even from another repo" {
  make_drift
  local other
  other=$(make_other_repo "elsewhere")
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook_from "$other" "cd - && git commit -m x"
  assert_deny
  run run_hook_from "$other" "cd -P && git commit -m x"
  assert_deny
}

# `;` does not short-circuit, so a cd that fails leaves bash where it started.
@test "a cd that fails leaves the commit in the payload cwd" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "cd \"$BATS_TEST_TMPDIR/absent\" ; git commit -m x"
  assert_deny
}

@test "a path the gate never expanded is not a path" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook 'cd $SCRATCH && git commit -m x'
  assert_deny
  run run_hook "cd \"$BATS_TEST_TMPDIR\"/re* && git commit -m x"
  assert_deny
  run run_hook "cd -- && git commit -m x"
  assert_deny
  run run_hook "cd ~+ && git commit -m x"
  assert_deny
  run run_hook 'cd $(pwd) && git commit -m x'
  assert_deny
  run run_hook 'git -C "$PWD" commit -m x'
  assert_deny
  run run_hook "cd -P \"$TEST_REPO\" && git commit -m x"
  assert_deny
  run run_hook "cd - && git commit -m x"
  assert_deny
}

@test "a lexer that lost track of quoting gates rather than misses" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "echo \$'it\\'s' ; git commit -m x"
  assert_deny
}

# git obeys these over the path the gate resolved, so the path proves nothing.
@test "a redirected git dir makes the target unresolvable" {
  make_drift
  local other
  other=$(make_other_repo "elsewhere")
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "GIT_DIR=$TEST_REPO/.git GIT_WORK_TREE=$TEST_REPO git -C \"$other\" commit -m x"
  assert_deny
  run run_hook "git --git-dir=\"$TEST_REPO/.git\" --work-tree=\"$TEST_REPO\" -C \"$other\" commit -m x"
  assert_deny
  run run_hook "CDPATH=$BATS_TEST_TMPDIR cd elsewhere && git commit -m x"
  assert_deny
}

# A second commit is a second landing place, and everything the router reads
# stops at the first one.
@test "a command holding two commits routes on neither" {
  make_drift
  local other
  other=$(make_other_repo "elsewhere")
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "cd \"$other\" && git commit -m a && cd \"$TEST_REPO\" && git commit -m b"
  assert_deny
  run run_hook "cd \"$other\" && git commit -m a; cd \"$TEST_REPO\"; git commit -m b"
  assert_deny
}

@test "a path-qualified git is still gated" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook "/usr/bin/git commit -am 'msg'"
  assert_deny
}

# Every root the session owns is checked. Picking one would leave the other
# ungated exactly when the two disagree.
@test "an unresolvable target gates the project even when the cwd is elsewhere" {
  make_drift
  local other
  other=$(make_other_repo "elsewhere")
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook_from "$other" 'cd $SCRATCH && git commit -m x'
  assert_deny
  run run_hook_from "$other" "false || cd \"$TEST_REPO\"; git commit -m x"
  assert_deny
}

# A wrong CLAUDE_PROJECT_DIR must not be able to switch the gate off in the
# repository the session sits in.
@test "CLAUDE_PROJECT_DIR naming another repo does not disarm the cwd's gate" {
  make_drift
  local other
  other=$(make_other_repo "elsewhere")
  export CLAUDE_PROJECT_DIR="$other"
  run run_hook "git commit -m x"
  assert_deny
}

# A broken tool has not read the command, and unread text is not "no commit".
break_tool() {
  mkdir -p "$BATS_TEST_TMPDIR/shim"
  printf '#!/bin/sh\nexit %s\n' "${2:-127}" > "$BATS_TEST_TMPDIR/shim/$1"
  chmod +x "$BATS_TEST_TMPDIR/shim/$1"
  PATH="$BATS_TEST_TMPDIR/shim:$PATH"
}

@test "a dead awk does not switch the gate off" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  break_tool awk 127
  run run_hook "git commit -am 'msg'"
  assert_deny
}

@test "an awk that exits cleanly with no output does not switch the gate off" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  break_tool awk 0
  run run_hook "git commit -am 'msg'"
  assert_deny
}

@test "a grep that errors is not read as a clean miss" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  break_tool grep 2
  run run_hook "git commit -am 'msg'"
  assert_deny
}

# A relative cwd would otherwise resolve against the hook process's own
# directory, gating whichever repository the hook happened to start in.
@test "a relative payload cwd names nothing" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run bash -c "jq -n '{tool_input:{command:\"git commit -am x\"},cwd:\"relative/path\"}' | CLAUDE_PROJECT_DIR='$TEST_REPO' CLAUDE_PLUGIN_ROOT='$PLUGIN_ROOT' bash '$PLUGIN_ROOT/hooks/commit-gate.sh'"
  assert_deny
}

@test "a payload with no cwd gates rather than resolving somewhere arbitrary" {
  make_drift
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run bash -c "printf '{\"tool_input\":{\"command\":\"git commit -m x\"}}' | CLAUDE_PROJECT_DIR='$TEST_REPO' CLAUDE_PLUGIN_ROOT='$PLUGIN_ROOT' bash '$PLUGIN_ROOT/hooks/commit-gate.sh'"
  assert_deny
}

# --- text a command carries is not a command it runs ---

@test "commit-tree passes: it writes an object and moves no ref" {
  make_drift
  run run_hook "git commit-tree \$(git write-tree) -p HEAD -m x"
  assert_pass
}

@test "a tracker description quoting the phrase passes" {
  make_drift
  run run_hook "bd create --title=t --description=\"blocked on git commit gating\""
  assert_pass
}

@test "a heredoc writing a script that commits passes" {
  make_drift
  run run_hook "cat <<'EOF' > setup.sh
git commit -m x
EOF"
  assert_pass
}

@test "a heredoc piped into a shell is still denied" {
  make_drift
  run run_hook "bash <<'EOF'
git commit -m x
EOF"
  assert_deny
}

@test "a quoted commit handed to bash -c is still denied" {
  make_drift
  run run_hook "bash -c \"git commit -m x\""
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

# Both repos here are real, so the payload cwd would otherwise name the wrong
# one as the project and the scope check would skip before precedence matters.
@test "cd into a clean repo does not outrank the commit's -C repo" {
  make_drift
  local other
  other=$(make_other_repo "cleanrepo")
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
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
  export CLAUDE_PROJECT_DIR="$TEST_REPO"
  run run_hook_from "$other" "cd \"$BATS_TEST_TMPDIR\" && git -C repo commit -am 'msg'"
  assert_deny
}

@test "the block names the failing path, not just the anchor" {
  printf 'reviewed\n' > f.txt
  git add -A
  git commit -q -m base
  "$REVIEW_SENTINEL" accept-state
  printf 'reviewed\nEDIT\n' > f.txt
  printf 'secret\n' > locked.txt
  chmod 000 locked.txt
  run "$REVIEW_SENTINEL" check
  chmod 644 locked.txt
  [ "$status" -eq 1 ]
  assert_contains "$output" "locked.txt"
  assert_contains "$output" "working tree"
}

@test "the commit gate's deny reason carries the sentinel diagnostic" {
  printf 'reviewed\n' > f.txt
  git add -A
  git commit -q -m base
  "$REVIEW_SENTINEL" accept-state
  printf 'reviewed\nEDIT\n' > f.txt
  printf 'secret\n' > locked.txt
  chmod 000 locked.txt
  run bash -c "printf '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m x\"},\"cwd\":\"$TEST_REPO\"}' | CLAUDECODE=1 CLAUDE_PLUGIN_ROOT='$PLUGIN_ROOT' bash '$PLUGIN_ROOT/hooks/commit-gate.sh'"
  chmod 644 locked.txt
  [ "$status" -eq 0 ]
  assert_matches "$output" '"permissionDecision": *"deny"'
  assert_contains "$output" "locked.txt"
  assert_contains "$output" "will NOT clear this"
}

@test "ordinary drift still gets the ordinary deny reason" {
  printf 'reviewed\n' > f.txt
  git add -A
  git commit -q -m base
  "$REVIEW_SENTINEL" accept-state
  printf 'reviewed\nEDIT\n' > f.txt
  run bash -c "printf '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git commit -m x\"},\"cwd\":\"$TEST_REPO\"}' | CLAUDECODE=1 CLAUDE_PLUGIN_ROOT='$PLUGIN_ROOT' bash '$PLUGIN_ROOT/hooks/commit-gate.sh'"
  [ "$status" -eq 0 ]
  assert_contains "$output" "does not match the last reviewed mark"
  refute_contains "$output" "could not read the working tree"
}
