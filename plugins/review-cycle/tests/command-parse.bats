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

@test "has_commit: rejects the hyphenated plumbing verbs" {
  refute parse_has_commit "git commit-tree \$TREE -m x"
  refute parse_has_commit "git commit-graph write"
}

# The gate blocked `bd create --description='...git commit...'` because the
# text a tool carries is not a command it runs.
@test "has_commit: rejects the phrase inside a non-git command's argument" {
  refute parse_has_commit 'bd create --description="run git commit first"'
  refute parse_has_commit "bd create --description='then; git commit -m x'"
  refute parse_has_commit "echo 'run git commit later'"
  refute parse_has_commit 'grep -r "git commit" .'
}

@test "has_commit: rejects a heredoc body being written to a file" {
  refute parse_has_commit "cat <<'EOF' > setup.sh
git commit -m x
EOF"
  refute parse_has_commit "cat <<-'EOF' > setup.sh
	git commit -m x
	EOF"
}

# An unquoted delimiter expands its body, but only the substitutions run. A
# plain line there is still data, and blocking it would refuse the ordinary
# act of writing a script that happens to mention the verb.
@test "has_commit: an unquoted heredoc body runs its substitutions, not its text" {
  parse_has_commit "cat <<EOF > f
\$(git commit -m x)
EOF"
  refute parse_has_commit "cat <<EOF > f
git commit -m x
EOF"
}

# The trailing slash is what separates git from a binary whose name merely
# ends in those three letters.
@test "has_commit: a path-qualified git is still git" {
  parse_has_commit "/usr/bin/git commit -m x"
  parse_has_commit "./git commit -m x"
  refute parse_has_commit "mygit commit -m x"
  refute parse_has_commit "legit commit -m x"
}

@test "has_commit: a substitution inside double quotes still runs" {
  parse_has_commit 'echo "$(git commit -m x)"'
  parse_has_commit 'FOO="$(git commit -m x)"'
  parse_has_commit 'echo "`git commit -m x`"'
}

# A lexer that lost track of where quoting ends cannot say what is data, so
# the raw view decides — which blocks rather than passes.
@test "has_commit: a desynchronized lexer falls back instead of missing" {
  run parse_strip_text "echo 'unterminated"
  [ "$status" -eq 3 ]
  parse_has_commit "echo \$'it\\'s' ; git commit -m x"
  parse_has_commit "cat <<E\"O\"F > f
body
EOF
git commit -m x"
}

@test "has_commit: input past the lexer's size cap falls back to the raw view" {
  local big
  big=$(printf 'x%.0s' $(seq 1 40000))
  run parse_strip_text "echo $big"
  [ "$status" -eq 3 ]
  parse_has_commit "echo $big; git commit -m x"
}

@test "has_commit: detects a quoted commit in the shapes that hand it to a shell" {
  parse_has_commit 'bash -lc "git commit -m x"'
  parse_has_commit "echo 'git commit -m x' | sh"
  parse_has_commit "printf '%s' 'git commit -m x' | bash"
}

@test "has_commit: rejects a mention inside a shell comment" {
  refute parse_has_commit "# git commit the fix
git status"
  refute parse_has_commit "git status  # then git commit"
}

# Blanked text still runs when a shell is handed it, so those shapes fall
# back to the unfiltered view.
@test "has_commit: detects a quoted commit handed to a shell" {
  parse_has_commit 'bash -c "git commit -m x"'
  parse_has_commit "sh -c 'git commit -m x'"
  parse_has_commit 'eval "git commit -m x"'
  parse_has_commit 'ssh host "git commit -m x"'
}

@test "has_commit: detects a heredoc body piped into a shell" {
  parse_has_commit "bash <<'EOF'
git commit -m x
EOF"
}

@test "has_commit: a herestring is not a heredoc opener" {
  parse_has_commit "git commit -m x <<< input"
}

@test "has_commit: quoting that spans lines stays blanked to its end" {
  refute parse_has_commit "bd create --description='line one
git commit -m x
line three'"
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

# A match tail that consumed the separator would leave the second invocation
# without the `;` its own match needs, and two commits would count as one.
@test "count: adjacent commits with no spaces around the separator count 2" {
  [ "$(parse_commit_count "git commit -m a;git commit -m b")" = "2" ]
  [ "$(parse_commit_count "git commit -m a&&git commit -m b")" = "2" ]
}

@test "count: the hyphenated plumbing verb still counts (fail-closed)" {
  [ "$(parse_commit_count "git commit-tree abc")" = "1" ]
}

# --- parse_cd_chain ---

@test "cd_chain: reports each hop in order" {
  [ -z "$(parse_cd_chain "git commit -m x")" ]
  [ "$(parse_cd_chain "cd /a && git commit -m x")" = "/a" ]
  [ "$(parse_cd_chain "cd /a && cd b && git commit -m x")" = "/a
b" ]
  [ "$(parse_cd_chain "cd /a
cd /b
git commit -m x")" = "/a
/b" ]
}

@test "cd_chain: quoted and subshell hops" {
  [ "$(parse_cd_chain 'cd "/a b" && git commit -m x')" = "/a b" ]
  [ "$(parse_cd_chain "cd '/a b' && git commit -m x")" = "/a b" ]
  [ "$(parse_cd_chain '(cd /a && git commit -m x)')" = "/a" ]
}

# A hop after the commit cannot move it, and following it would route the
# gate at a directory the commit never saw.
@test "cd_chain: hops after the commit are dropped" {
  [ "$(parse_cd_chain "cd /a && git commit -m x && cd /b")" = "/a" ]
  [ -z "$(parse_cd_chain "git commit -m x; cd /b")" ]
}

# Hops are read from the raw text so a quoted path is not lost with its
# quotes. A hop carried as data shows up as the two counts disagreeing: the
# skeleton has no `cd` where quoted text or a heredoc body merely mentions one.
@test "cd_count: carried text is visible as a disagreement with the skeleton" {
  local carried='echo "setup; cd /elsewhere" && git commit -m x'
  [ "$(parse_cd_count "$carried")" = "1" ]
  [ "$(parse_cd_count "$(parse_strip_text "$carried")")" = "0" ]

  local real='cd "/a b" && git commit -m x'
  [ "$(parse_cd_count "$real")" = "$(parse_cd_count "$(parse_strip_text "$real")")" ]
}

@test "cd_count: a hop in a heredoc body does not count" {
  local hd="cat <<'EOF' > f
cd /elsewhere
EOF
git commit -m x"
  [ "$(parse_cd_count "$hd")" = "1" ]
  [ "$(parse_cd_count "$(parse_strip_text "$hd")")" = "0" ]
}

# --- parse_prefix_seps ---

# A hop only moves the commit if bash both reaches it and keeps it, so the
# separators decide whether the fold means anything.
@test "prefix_seps: reports what joins the commands ahead of the commit" {
  [ -z "$(parse_prefix_seps 'git commit -m x')" ]
  [ "$(parse_prefix_seps 'cd /a && git commit -m x')" = "&&" ]
  [ "$(parse_prefix_seps 'cd /a
git commit -m x')" = ";" ]
  [ "$(parse_prefix_seps 'false && cd /a; git commit -m x')" = "&&
;" ]
  [ "$(parse_prefix_seps '(cd /a); git commit -m x')" = "(
)
;" ]
}

@test "prefix_seps: separators after the commit are not counted" {
  [ "$(parse_prefix_seps 'cd /a && git commit -m x; cd /b || true')" = "&&" ]
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

# The count that gates extraction treats the plumbing verb as a candidate, so
# this shape is ambiguous and yields nothing rather than /a — the wrong repo.
@test "extract_git_c: a preceding commit-tree makes the path ambiguous, not wrong" {
  [ -z "$(parse_extract_git_c 'git -C /a commit-tree abc && git -C /b commit -m x')" ]
}

# --- parse_abs ---

@test "abs: absolute and empty unchanged, relative prefixed" {
  [ "$(parse_abs "/a/b" "/base")" = "/a/b" ]
  [ -z "$(parse_abs "" "/base")" ]
  [ "$(parse_abs "rel" "/base")" = "/base/rel" ]
  [ "$(parse_abs "rel" "")" = "rel" ]
}
