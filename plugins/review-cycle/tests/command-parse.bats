#!/usr/bin/env bats
# Unit tests for hooks/lib/command-parse.sh: pure string functions, no git
# repos needed. The end-to-end contract lives in commit-gate.bats; this
# suite pins the lexical layer cheaply.

setup() {
  load 'helpers'
  source "$PLUGIN_ROOT/hooks/lib/command-parse.sh"
}

# --- parse_has_commit / detection shapes ---

@test "has_commit: plain git commit" {
  parse_has_commit "git commit -m x"
}

@test "has_commit: git -C path commit" {
  parse_has_commit "git -C /some/repo commit -m x"
}

@test "has_commit: quoted spaced -c value" {
  parse_has_commit "git -c user.name='Jace Babin' commit -m x"
}

@test "has_commit: separate-argument --git-dir --work-tree" {
  parse_has_commit 'git --git-dir "/r/.git" --work-tree "/r" commit -m x'
}

@test "has_commit: subshell and backtick openers" {
  parse_has_commit "(git commit -m x)"
  parse_has_commit 'v=`git commit -m x`'
}

@test "has_commit: backslash-continued git commit" {
  parse_has_commit 'git \
commit -m x'
}

@test "has_commit: rejects non-commit git commands" {
  refute parse_has_commit "git log -p something"
  refute parse_has_commit "git checkout -b commit-fix"
  refute parse_has_commit "git stash push -m commit"
  refute parse_has_commit "echo commit"
}

@test "has_commit: rejects lookalike binary names" {
  refute parse_has_commit "mygit commit -m x"
  refute parse_has_commit "legit commit -m x"
}

# --- parse_commit_count ---

@test "count: zero, one, two" {
  [ "$(parse_commit_count "ls -la")" = "0" ]
  [ "$(parse_commit_count "git commit -m x")" = "1" ]
  [ "$(parse_commit_count "git commit -m a && git commit -m b")" = "2" ]
}

@test "count: quoted # in a message cannot hide a later commit" {
  [ "$(parse_commit_count "git commit -m 'fix #12' && git commit -m y")" = "2" ]
}

@test "count: prose mention counts too (fail-closed)" {
  [ "$(parse_commit_count "echo 'run git commit later'; git commit -m x")" = "2" ]
}

# --- parse_accept_chain_ok ---

@test "accept chain: sanctioned shapes pass" {
  parse_accept_chain_ok '"/p/review-sentinel" accept-state && git commit -m x'
  parse_accept_chain_ok "'/p/review-sentinel' accept-state && git commit -m x"
  parse_accept_chain_ok '/p/review-sentinel accept-state &&git commit -m x'
  parse_accept_chain_ok 'cd /r && /p/review-sentinel accept-state && git commit -m x'
  parse_accept_chain_ok 'git add -A && /p/review-sentinel accept-state && git commit -m x'
}

@test "accept chain: continuation joins pass" {
  parse_accept_chain_ok '/p/review-sentinel accept-state && \
git commit -m x'
  parse_accept_chain_ok '/p/review-sentinel accept-state &&
git commit -m x'
}

@test "accept chain: weak separators denied" {
  refute parse_accept_chain_ok '/p/review-sentinel accept-state; git commit -m x'
  refute parse_accept_chain_ok '/p/review-sentinel accept-state || git commit -m x'
  refute parse_accept_chain_ok 'true || /p/review-sentinel accept-state && git commit -m x'
  refute parse_accept_chain_ok '/p/review-sentinel accept-state
git commit -m x'
}

@test "accept chain: commands or options near the pair denied" {
  refute parse_accept_chain_ok '/p/review-sentinel accept-state && git add -A && git commit -m x'
  refute parse_accept_chain_ok '/p/review-sentinel accept-state > /dev/null && git commit -m x'
  refute parse_accept_chain_ok '/p/review-sentinel --root /r accept-state && git commit -m x'
  refute parse_accept_chain_ok '/p/review-sentinel accept-state && git -c a=b commit -m x'
}

@test "accept chain: textual spoofs denied" {
  refute parse_accept_chain_ok 'echo review-sentinel accept-state && git commit -m x'
  refute parse_accept_chain_ok 'my-review-sentinel accept-state && git commit -m x'
  refute parse_accept_chain_ok 'git commit -m x && /p/review-sentinel accept-state'
  refute parse_accept_chain_ok '/p/review-sentinel check && git commit -m x'
}

@test "accept chain: multi-commit denied" {
  refute parse_accept_chain_ok '/p/review-sentinel accept-state && git commit -m a && git commit -m b'
}

@test "accept chain: the guarded mark verb is not a sanctioned chain" {
  refute parse_accept_chain_ok '/p/review-sentinel mark && git commit -m x'
}

# --- parse_extract_cd / parse_extract_git_c ---

@test "extract_cd: bare, quoted, absent" {
  [ "$(parse_extract_cd 'cd /a/b && git commit -m x')" = "/a/b" ]
  [ "$(parse_extract_cd 'cd "/a b/c" && git commit -m x')" = "/a b/c" ]
  [ -z "$(parse_extract_cd 'git commit -m x')" ]
}

@test "extract_git_c: bare, quoted, absent" {
  [ "$(parse_extract_git_c 'git -C /repo commit -m x')" = "/repo" ]
  [ "$(parse_extract_git_c 'git -C "/my repo" commit -m x')" = "/my repo" ]
  [ -z "$(parse_extract_git_c 'git commit -m x')" ]
}

@test "extract_git_c: last -C wins within the invocation" {
  [ "$(parse_extract_git_c 'git -C /a -C /b commit -m x')" = "/b" ]
}

@test "extract_git_c: empty on multi-commit ambiguity" {
  [ -z "$(parse_extract_git_c 'git -C /a commit -m x && git commit -m y')" ]
  [ -z "$(parse_extract_git_c "echo 'run git -C /a commit'; git commit -m x")" ]
}

@test "extract_git_c: message text after commit never reaches it" {
  [ -z "$(parse_extract_git_c 'git commit -m "see git -C /steer"')" ]
}

# --- parse_abs ---

@test "abs: absolute and empty unchanged, relative prefixed" {
  [ "$(parse_abs "/a/b" "/base")" = "/a/b" ]
  [ -z "$(parse_abs "" "/base")" ]
  [ "$(parse_abs "rel" "/base")" = "/base/rel" ]
  [ "$(parse_abs "rel" "")" = "rel" ]
}
