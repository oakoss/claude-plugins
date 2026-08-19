#!/usr/bin/env bash
# command-parse.sh: lexical analysis of Bash command text for the
# review-cycle gates. Source, don't execute. No git or filesystem access —
# every function maps strings to strings/exit codes, so tests need no repo.
#
# PARSE_GIT_COMMIT_RE is the single definition of "this text contains a git
# commit invocation". The repo-local version-bump gate in marketplace repos
# sources this file too; change it here and every gate moves together.
#
# Functions:
#   parse_join_raw <cmd>        joined single-line view, every byte kept
#   parse_join_flat <cmd>       joined view with shell comments stripped
#   parse_has_commit <cmd>      0 if the text contains a git-commit invocation
#   parse_commit_count <cmd>    print the number of git-commit invocations
#   parse_accept_chain_ok <cmd> 0 if the command is a sanctioned
#                               accept-state+commit chain
#   parse_extract_cd <cmd>      print leading `cd` argument, unquoted
#   parse_extract_git_c <cmd>   print the commit's -C path, unquoted
#   parse_abs <path> <base>     print path absolutized against base

# `git commit` with word boundary: path strings containing 'git commit' don't
# false-positive; `git commit-tree` etc. are intentionally caught. Global
# options between `git` and `commit` are recognized in every real shape —
# `-C <path>`, `-c k='v with spaces'`, `--flag`, separate-argument
# `--git-dir <path>`, quoted whole or mid-token — as are subshell/backtick
# openers before `git`. An option's value is a sequence of quoted-or-bare
# chunks; a separate value token must not start with `-` so one option can
# never swallow the next.
PARSE_GIT_OPT_ARG="([^[:space:];&|\"']|\"[^\"]*\"|'[^']*')+"
PARSE_GIT_OPT_VAL="(\"[^\"]*\"|'[^']*'|[^-[:space:];&|\"'])([^[:space:];&|\"']|\"[^\"]*\"|'[^']*')*"
PARSE_GIT_COMMIT_RE="(^|[;&|[:space:](\`])git([[:space:]]+-${PARSE_GIT_OPT_ARG}([[:space:]]+${PARSE_GIT_OPT_VAL})?)*[[:space:]]+commit\b"

# Join lines: backslash and `&&` line-ends continue (bash semantics),
# remaining newlines act as `;`. Detection and counting must run on this
# view, never per-line — a backslash-split `git \<newline>commit` is one
# invocation to bash and must be one invocation here.
parse_join_raw() {
  printf '%s\n' "$1" | awk '{
    if (sub(/\\$/, "") || $0 ~ /&&[[:space:]]*$/) printf "%s ", $0
    else printf "%s;", $0
  }'
}

# Same join with comments stripped (a `#` at line start or after
# whitespace). Used only where stripping can narrow what matches
# (fail-closed); never for counting — a quoted `#` in a commit message
# must not be able to hide a later commit from the count.
parse_join_flat() {
  printf '%s\n' "$1" | awk '{
    sub(/^[[:space:]]*#.*$/, "")
    sub(/[[:space:]]#.*$/, "")
    if (sub(/\\$/, "") || $0 ~ /&&[[:space:]]*$/) printf "%s ", $0
    else printf "%s;", $0
  }'
}

parse_has_commit() {
  parse_join_raw "$1" | LC_ALL=C grep -qE "$PARSE_GIT_COMMIT_RE"
}

parse_commit_count() {
  parse_join_raw "$1" | LC_ALL=C grep -oE "$PARSE_GIT_COMMIT_RE" \
    | wc -l | tr -d '[:space:]'
}

# The sanctioned chained form: exactly one git commit in the command, and a
# bare path-anchored `review-sentinel accept-state` at command position —
# start of string or right after `;` `&` `|` `(` — immediately `&&`-joined
# to a plain `git commit`.
#
# `accept-state`, never `mark`: the chain exists to serve /accept, where a
# human is vouching for the state. `mark` is the review cycle's internal
# verb and refuses without a cycle-start marker; letting it chain here
# would hand the guarded verb the one pass-through that skips the sentinel
# check. A review that reached Phase 8 has no reason to &&-join a commit.
#
# Why each condition exists:
#   - `&&` join: the commit runs only if accept-state succeeded. `;`, `||`,
#     and bare newlines give no such guarantee. A `||` anywhere before the
#     commit is rejected outright — `true || accept-state && commit` skips
#     the write yet still commits; the safe `false || accept-state` shape is
#     denied too (fail-closed; drop the `||`).
#   - single commit: quoted or heredoc text containing the phrase cannot
#     stand in for the real commit, and a second commit cannot ride through
#     ungated behind a marked first one.
#   - bare accept-state, plain commit: `--root` on accept-state, like `-C`
#     on the commit, could make the two target different repos — both
#     option forms fall back to the sentinel check.
#   - nothing in between: an intervening command could re-drift the tree
#     after the sentinel was written.
parse_accept_chain_ok() {
  local cmd="$1" pre
  [ "$(parse_commit_count "$cmd")" = "1" ] || return 1
  pre=$(parse_join_flat "$cmd" \
    | sed -E 's/(^|[;&|[:space:]])git[[:space:]]+commit([^[:alnum:]_].*)?$/\1/')
  printf '%s' "$pre" | grep -qF '||' && return 1
  printf '%s' "$pre" | grep -qE \
    "(^|[;&|(])[[:space:]]*(\"([^\"]*/)?review-sentinel\"|'([^']*/)?review-sentinel'|([^[:space:];&|\"']*/)?review-sentinel)[[:space:]]+accept-state[[:space:]]*&&[[:space:]]*\$"
}

parse_extract_cd() {
  printf '%s' "$1" | sed -nE 's/^[[:space:]]*cd[[:space:]]+("([^"]+)"|'\''([^'\'']+)'\''|([^[:space:]&;|]+)).*/\2\3\4/p' | head -1
}

# The -C path of the command's single git-commit invocation; empty when
# absent or when the command holds more than one commit match — prose and
# the real invocation are indistinguishable then, so the caller must fall
# back to cd/cwd rather than let text pick the repo. Extracted only from
# the matched invocation (message text mentioning `git -C` sits after
# `commit` and never reaches this). Last -C wins, matching git's own
# semantics for repeated flags.
parse_extract_git_c() {
  local cmd="$1" seg
  [ "$(parse_commit_count "$cmd")" = "1" ] || return 0
  seg=$(parse_join_raw "$cmd" | LC_ALL=C grep -oE "$PARSE_GIT_COMMIT_RE" | head -1)
  printf '%s' "$seg" \
    | grep -oE -- "-C[[:space:]]+(\"[^\"]*\"|'[^']*'|[^[:space:];&|]+)" | tail -1 \
    | sed -E "s/^-C[[:space:]]+//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/"
}

# Candidates parsed out of command text may be relative — to the payload
# cwd, or for a -C following a leading cd, to the cd target.
parse_abs() {
  case "$1" in
    ''|/*) printf '%s' "$1" ;;
    *) if [ -n "$2" ]; then printf '%s/%s' "$2" "$1"; else printf '%s' "$1"; fi ;;
  esac
}
