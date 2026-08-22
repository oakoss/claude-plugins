#!/usr/bin/env bash
# command-parse.sh: lexical analysis of Bash command text for the
# review-cycle gates. Source, don't execute. No git or filesystem access —
# every function maps strings to strings/exit codes, so tests need no repo.
#
# Detection asks "is this the verb" and answers with PARSE_GIT_COMMIT_VERB_RE.
# Counting asks "could anything here be the verb" and answers with the looser
# PARSE_GIT_COMMIT_RE, deliberately, so ambiguity refuses rather than guesses.
# The repo-local version-bump gate in marketplace repos sources this file too;
# change the lexer here and both gates move together. Routing does not live
# here, so the two gates resolve a target differently.
#
# Functions:
#   parse_join_raw <cmd>        joined single-line view, every byte kept
#   parse_join_flat <cmd>       joined view with shell comments stripped
#   parse_strip_text <cmd>      per-line view with data regions blanked
#   parse_has_commit <cmd>      0 if the text runs a git-commit invocation
#   parse_commit_count <cmd>    print the number of git-commit invocations
#   parse_accept_chain_ok <cmd> 0 if the command is a sanctioned
#                               accept-state+commit chain
#   parse_extract_cd <cmd>      print leading `cd` argument, unquoted
#   parse_cd_count <cmd>        count `cd` invocations before the commit
#   parse_prefix_unsafe <cmd>   0 if a subshell or branch precedes the commit
#   parse_prefix_seps <cmd>     print the separators before the commit
#   parse_cd_chain <cmd>        print each `cd` target before the commit
#   parse_grep_verb             0 found, 1 a clean miss, 2 could not tell
#   parse_extract_git_c <cmd>   print the commit's -C path, unquoted
#   parse_abs <path> <base>     print path absolutized against base

# `git commit` with word boundary: path strings containing 'git commit' don't
# false-positive. Global options between `git` and `commit` are recognized in
# every real shape — `-C <path>`, `-c k='v with spaces'`, `--flag`,
# separate-argument `--git-dir <path>`, quoted whole or mid-token — as are
# subshell/backtick openers before `git`. An option's value is a sequence of
# quoted-or-bare chunks; a separate value token must not start with `-` so one
# option can never swallow the next.
PARSE_GIT_OPT_ARG="([^[:space:];&|\"']|\"[^\"]*\"|'[^']*')+"
PARSE_GIT_OPT_VAL="(\"[^\"]*\"|'[^']*'|[^-[:space:];&|\"'])([^[:space:];&|\"']|\"[^\"]*\"|'[^']*')*"
# A path-qualified `/usr/bin/git` is git; the trailing slash is what keeps
# `mygit` and `legit` out. The cost is that a bare path ending in `/git`
# followed by the word reads as an invocation, which blocks rather than passes.
PARSE_GIT_COMMIT_HEAD="(^|[;&|[:space:](\`])([^[:space:];&|\"'\`]*/)?git([[:space:]]+-${PARSE_GIT_OPT_ARG}([[:space:]]+${PARSE_GIT_OPT_VAL})?)*[[:space:]]+commit"

# Excluding the hyphenated plumbing verbs (`commit-tree` moves no ref, so it
# is not the gated verb) costs a consumed character, which ERE needs to
# express "not a hyphen". Counting cannot afford that: the consumed separator
# in `git commit;git commit` leaves the second match without the `;` it needs,
# reading two invocations as one. So parse_commit_count keeps the zero-width
# boundary and over-counts, which is its safe direction.
PARSE_GIT_COMMIT_RE="${PARSE_GIT_COMMIT_HEAD}\b"
PARSE_GIT_COMMIT_VERB_RE="${PARSE_GIT_COMMIT_HEAD}([^[:alnum:]_-]|\$)"

# Shapes that hand a quoted string or a heredoc body to a shell, which
# executes it: `bash -c`, a combined cluster like `bash -lc`, a heredoc into a
# shell, and a pipe into one. parse_strip_text blanks exactly those regions, so
# detection falls back to the unstripped view whenever one is present.
# Best-effort by construction: a runner not named here that execs its argument
# — `python3 -c`, a task runner — is missed, and the commit it hides passes.
PARSE_SHELL="(bash|zsh|ksh|dash|fish|sh)"
PARSE_SHELL_EXEC_RE="(^|[;&|(\`{]|[[:space:]])((eval|exec|xargs|ssh)[[:space:]]|${PARSE_SHELL}[[:space:]]+(-[^[:space:]]+[[:space:]]+)*(-[[:alnum:]]*c[[:space:]]|<<))|\|[[:space:]]*${PARSE_SHELL}([[:space:]]|;|\$)"

# Each of these moves git, or moves `cd`, off the path routing computed —
# CDPATH silently redirects a relative hop — so the target is unresolvable.
# shellcheck disable=SC2034  # consumed by the sourcing hooks
PARSE_GIT_REDIRECT_RE="(--git-dir|--work-tree|GIT_DIR=|GIT_WORK_TREE=|CDPATH=)"

# Above this many bytes the skeleton is not built: the lexer is quadratic in
# the length of a line, and a hook that takes seconds is its own defect.
# Oversize input is treated exactly like a lexer failure — the raw view
# decides, which blocks rather than passes.
PARSE_MAX_LEX_BYTES=32768

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
#
# parse_accept_chain_ok needs this view and no other: it reads a sentinel path
# that is normally quoted, which the skeleton blanks away, while still needing
# comments gone so a `#` between the join and the commit cannot hide the pair.
parse_join_flat() {
  printf '%s\n' "$1" | awk '{
    sub(/^[[:space:]]*#.*$/, "")
    sub(/[[:space:]]#.*$/, "")
    if (sub(/\\$/, "") || $0 ~ /&&[[:space:]]*$/) printf "%s ", $0
    else printf "%s;", $0
  }'
}
# Blanks the regions bash treats as data rather than code — quoted strings,
# comments, and the body of a quoted-delimiter heredoc — leaving the command
# skeleton. An issue description or a script body that mentions a command is
# data, not a call.
#
# Command substitutions survive everywhere they expand, double quotes
# included, because bash runs them there. An unquoted heredoc delimiter also
# expands its body, so that body is kept whole rather than picked apart.
#
# Nonzero means the skeleton cannot be trusted — an unterminated quote,
# heredoc, or substitution, or input past the size cap — and callers must fall
# back to the raw view rather than read the output as "nothing here".
parse_strip_text() {
  [ "${#1}" -le "$PARSE_MAX_LEX_BYTES" ] || return 3
  printf '%s\n' "$1" | awk '
  BEGIN { q = 0; inhd = 0; delim = ""; hdcode = 0; depth = 0; tick = 0 }
  {
    line = $0; n = length(line)
    if (inhd) {
      t = line
      sub(/^[ \t]+/, "", t); sub(/[ \t]+$/, "", t)
      if (t == delim) { inhd = 0; delim = ""; print ""; next }
      if (!hdcode) { print ""; next }
      # An unquoted delimiter expands the body, but only its substitutions run;
      # the surrounding text is still data. Double-quote state blanks exactly
      # that much, since the substitution branches sit ahead of it.
      q = 2
    }
    out = ""; i = 1
    while (i <= n) {
      c = substr(line, i, 1)
      if (depth > 0 || tick) {
        if (tick) { if (c == "`") tick = 0 }
        else if (c == "(") depth++
        else if (c == ")") depth--
        out = out c; i++; continue
      }
      if (q == 1) {
        if (c == "\047") q = 0
        out = out " "; i++; continue
      }
      if (c == "$" && substr(line, i + 1, 1) == "(") {
        depth = 1; out = out "$("; i += 2; continue
      }
      if (c == "`") { tick = 1; out = out "`"; i++; continue }
      if (q == 2) {
        if (c == "\\") { out = out "  "; i += 2; continue }
        if (c == "\"") q = 0
        out = out " "; i++; continue
      }
      if (c == "\\") {
        # A trailing backslash is a line continuation, not an escape.
        if (i == n) { out = out "\\"; i++; continue }
        # Blanking an escaped space would split one path into two words and
        # hand the caller a truncated prefix that looks perfectly followable.
        # `?` is a character it already refuses.
        out = out "??"; i += 2; continue
      }
      if (c == "\047") { q = 1; out = out " "; i++; continue }
      if (c == "\"") { q = 2; out = out " "; i++; continue }
      if (c == "#" && (i == 1 || substr(line, i - 1, 1) ~ /[ \t]/)) break
      if (c == "<" && substr(line, i + 1, 1) == "<") {
        # `<<<` is a herestring: one word, no body on following lines.
        if (substr(line, i + 2, 1) == "<") { out = out "<<<"; i += 3; continue }
        j = i + 2
        if (substr(line, j, 1) == "-") j++
        while (j <= n && substr(line, j, 1) ~ /[ \t]/) j++
        d = ""; quoted = 0
        while (j <= n && substr(line, j, 1) !~ /[ \t;&|<>()]/) {
          ch = substr(line, j, 1)
          if (ch == "\047" || ch == "\"") quoted = 1
          else d = d ch
          j++
        }
        if (d != "") { inhd = 1; delim = d; hdcode = (quoted ? 0 : 1) }
        out = out "  "; i = j; continue
      }
      out = out c; i++
    }
    # A heredoc body borrowed double-quote state for the line; it ends there,
    # or the delimiter itself would be read as still inside a string.
    if (inhd) q = 0
    print out
  }
  END { if (q != 0 || inhd || depth > 0 || tick) exit 3 }'
}

# Answered on the code skeleton. A skeleton that could not be built decides
# nothing, so the raw view answers instead — as it does for the shapes that
# hand data to a shell to execute. Both fallbacks read quotes as separators,
# since in `bash -c "git commit"` that is exactly where one sits.
# 0 found, 1 a trustworthy miss, 2 could not tell. Every caller must keep
# those three apart: grep exits 2 on its own errors and 127 when it is absent,
# and reading either as "no commit here" switches the whole gate off.
parse_grep_verb() {
  local rc=0
  LC_ALL=C grep -qE "$PARSE_GIT_COMMIT_VERB_RE" || rc=$?
  [ "$rc" -le 1 ] && return "$rc"
  return 2
}

parse_has_commit() {
  local code raw rc=0 grc=0 vrc=0
  # Only a trustworthy miss short-circuits. A grep that errored, or is absent,
  # says nothing about the text and must not stand in for "no commit here".
  printf '%s' "$1" | LC_ALL=C grep -qF commit || grc=$?
  [ "$grc" -eq 1 ] && return 1
  raw=$(parse_join_raw "$1")
  # The word is in the text but no view can be built — every view is awk, so a
  # dead awk would otherwise answer "nothing here" for all of them.
  [ -n "$raw" ] || return 0
  code=$(parse_strip_text "$1") || rc=$?
  [ -n "$code" ] || rc=3
  if [ "$rc" -ne 0 ]; then
    vrc=0; printf '%s' "$raw" | tr "\"'" '  ' | parse_grep_verb || vrc=$?
    [ "$vrc" -eq 1 ] && return 1
    return 0
  fi
  vrc=0; parse_join_raw "$code" | parse_grep_verb || vrc=$?
  [ "$vrc" -ne 1 ] && return 0
  # A substitution joins the shell-exec shapes here because the lexer tracks
  # its nesting by counting parentheses, which `case` patterns and quoted
  # parens throw off; the raw view is the backstop when it does.
  printf '%s\n' "$1" \
    | LC_ALL=C grep -qE "$PARSE_SHELL_EXEC_RE"'|\$\(|`' || grc=$?
  [ "$grc" -eq 1 ] && return 1
  printf '%s' "$raw" | tr "\"'" '  ' | LC_ALL=C grep -qE "$PARSE_GIT_COMMIT_VERB_RE"
}

# Raw view deliberately: callers refuse when the count exceeds one, so an
# inflated count denies and a deflated one would sanction.
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

# The first hop only, and only where it leads the command. Used by the
# marketplace version-bump gate, which needs one directory to inspect rather
# than the whole walk; anything routing on where a commit lands wants
# parse_cd_chain.
parse_extract_cd() {
  printf '%s' "$1" | sed -nE 's/^[[:space:]]*cd[[:space:]]+("([^"]+)"|'\''([^'\'']+)'\''|([^[:space:]&;|]+)).*/\2\3\4/p' | head -1
}

# Every `cd` target at command position ahead of the commit, in order, read
# off the raw text so a quoted path survives with its spaces. A token only
# partly quoted comes back empty and is refused rather than guessed at.
parse_cd_chain() {
  parse_join_raw "$1" | awk -v re="${PARSE_GIT_COMMIT_HEAD}[^[:alnum:]_-]" '
  {
    line = $0
    if (match(line, re)) line = substr(line, 1, RSTART)
    n = split(line, seg, /[;&|(`{]/)
    for (k = 1; k <= n; k++) {
      s = seg[k]
      sub(/^[ \t]+/, "", s)
      if (s !~ /^cd([ \t]|$)/) continue
      sub(/^cd[ \t]*/, "", s)
      qc = substr(s, 1, 1)
      if (qc == "\"" || qc == "\047") {
        j = index(substr(s, 2), qc)
        # A token that resumes after the closing quote — `"/a"/b*` — would
        # otherwise be reported as the quoted part alone, which is a real
        # directory somewhere else entirely.
        rest = (j > 0 ? substr(s, j + 2, 1) : "x")
        print ((j > 0 && (rest == "" || rest == " " || rest == "\t")) ? substr(s, 2, j - 1) : "")
        continue
      }
      sub(/[ \t].*$/, "", s)
      # Same reasoning in reverse: a quote inside a bare token means the token
      # was only partly quoted, so what survives here is a fragment.
      print (s ~ /["\047]/ ? "" : s)
    }
  }'
}

# Counted on both views so the caller can compare them: a hop the skeleton
# does not also produce came from text the command carries, and steers nothing.
parse_cd_count() {
  parse_join_raw "$1" \
    | awk -v re="${PARSE_GIT_COMMIT_HEAD}[^[:alnum:]_-]" \
      '{ if (match($0, re)) $0 = substr($0, 1, RSTART); print }' \
    | LC_ALL=C grep -oE "(^|[;&|(\`{])[[:space:]]*cd([[:space:]]|\$)" \
    | wc -l | tr -d '[:space:]'
}

# 0 when something ahead of the commit puts a `cd` beyond reach of plain
# reading: a substitution or backtick, whose `cd` runs in a subshell, or a
# control keyword, whose branch may never be taken. Either way the text no
# longer says where bash stands when the commit runs.
parse_prefix_unsafe() {
  parse_join_raw "$1" \
    | awk -v re="${PARSE_GIT_COMMIT_HEAD}[^[:alnum:]_-]" \
      '{ if (match($0, re)) $0 = substr($0, 1, RSTART); print }' \
    | LC_ALL=C grep -qE '[`]|\$\(|(^|[;&|( ])(if|then|elif|else|fi|for|while|until|do|done|case|esac|function)([;&|) ]|$)'
}

parse_prefix_seps() {
  parse_join_raw "$1" | awk -v re="${PARSE_GIT_COMMIT_HEAD}[^[:alnum:]_-]" '
  {
    line = $0
    if (match(line, re)) line = substr(line, 1, RSTART)   # keep the separator the match consumed
    n = length(line); i = 1
    while (i <= n) {
      two = substr(line, i, 2)
      if (two == "&&" || two == "||") { seen[two] = 1; i += 2; continue }
      c = substr(line, i, 1)
      if (index(";|&(){}", c) > 0) seen[c] = 1
      i++
    }
    for (s in seen) print s
  }' | LC_ALL=C sort
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
  seg=$(parse_join_raw "$cmd" | LC_ALL=C grep -oE "$PARSE_GIT_COMMIT_VERB_RE" | head -1)
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
