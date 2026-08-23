#!/usr/bin/env bats
# Guard for the execution receipt: every reviewer leg the cycle can dispatch
# must ask for it, and both skills must define the grades they weight legs by.
#
# The contract lives in eight prose files with nothing linking them, so it
# breaks silently: a seventh reviewer added later, or the paragraph lost in a
# rewrite, leaves the cycle grading that leg `unknown` with nothing saying why.
#
# This checks that the instruction is present, not that an agent emits the line
# at runtime — it catches a partial revert and an agent that never joined.
#
# `cleanup.md` is excluded by name: it edits the target and files no findings,
# so there is nothing to grade.

AGENT_ANCHOR='Open your report with the execution receipt'
# Both anchors quote the fenced template's own wording rather than the bare
# `execution:` / `attempted-but-failed:` tokens, which also appear in the
# surrounding prose: a bare grep would pass with the template line deleted.
FIRST_LINE='execution: <the heaviest verification that SUCCEEDED'
SECOND_LINE='and the project'"'"'s own build or test suite when you did not attempt it at all'
BOTH_REQUIRED='Both lines are required'
OUTPUT_NOTE='Emit the execution receipt above this'

# Six reviewers today. A floor, not a count: the per-file loop is what catches
# one dropping out, and this only catches the enumeration collapsing.
AGENT_FLOOR=6

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  # shellcheck source=/dev/null
  source "$REPO_ROOT/plugins/review-cycle/tests/helpers.bash"
}

# Returns 2 rather than empty output on every way the scan can break, so a
# broken scan and a clean tree never look alike.
list_reviewer_agents() {
  local root="${1:-$REPO_ROOT}" min="${2:-$AGENT_FLOOR}"
  local tmp="${BATS_TEST_TMPDIR:?needs BATS_TEST_TMPDIR}"
  local list="$tmp/agent-list" err="$tmp/agent-err"
  local files=() f

  git -C "$root" ls-files -z --cached --others --exclude-standard \
    -- 'plugins/review-cycle/agents/*.md' > "$list" 2>"$err" || {
    printf 'could not enumerate agents under %s: %s\n' "$root" "$(head -3 "$err")" >&2
    return 2
  }
  if [ -s "$err" ]; then
    printf 'enumeration under %s was incomplete: %s\n' "$root" "$(head -3 "$err")" >&2
    return 2
  fi
  while IFS= read -r -d '' f; do
    [ "$(basename "$f")" = "cleanup.md" ] && continue
    if [ ! -e "$root/$f" ]; then
      printf 'enumerated %s but it does not exist\n' "$f" >&2
      return 2
    fi
    files+=("$root/$f")
  done < "$list"

  if [ "${#files[@]}" -lt "$min" ]; then
    printf 'scan reached only %s reviewer agents (expected at least %s)\n' \
      "${#files[@]}" "$min" >&2
    return 2
  fi
  printf '%s\n' "${files[@]}"
  return 0
}

@test "every reviewer agent asks for the execution receipt" {
  run list_reviewer_agents
  [ "$status" -eq 0 ] || {
    printf 'enumeration failed (status %s):\n%s\n' "$status" "$output" >&2
    return 1
  }
  local missing=""
  while IFS= read -r f; do
    grep -qF "$AGENT_ANCHOR" "$f" || missing+="  $(basename "$f") — no receipt instruction"$'\n'
    grep -qF "$FIRST_LINE" "$f" || missing+="  $(basename "$f") — no execution: line"$'\n'
    grep -qF "$SECOND_LINE" "$f" || missing+="  $(basename "$f") — line two lost the unattempted-check clause"$'\n'
    grep -qF "$BOTH_REQUIRED" "$f" || missing+="  $(basename "$f") — no longer requires both lines"$'\n'
    grep -qF "$OUTPUT_NOTE" "$f" || missing+="  $(basename "$f") — output template does not place the receipt first"$'\n'
  done <<< "$output"
  [ -z "$missing" ] || {
    printf 'reviewer agents outside the execution-receipt contract:\n%s' "$missing" >&2
    return 1
  }
}

@test "cleanup is excluded, and is the only agent that is" {
  run list_reviewer_agents
  [ "$status" -eq 0 ]
  refute_contains "$output" "cleanup.md"
  assert_contains "$output" "code-reviewer.md"
  assert_contains "$output" "spec-conformance-analyzer.md"
}

@test "both skills define every grade they weight legs by" {
  local skill missing=""
  for skill in review review-pr; do
    local path="$REPO_ROOT/plugins/review-cycle/skills/$skill/SKILL.md"
    local token
    # grep rather than assert_contains: these bodies run to hundreds of lines,
    # and a failure should name the missing token, not print the whole file.
    for token in 'execution:' 'attempted-but-failed:' 'static-analysis-only' \
                 'partial (<what was unreachable>)' '`executed`' \
                 'the leg is `unknown`' \
                 'are not verifications' \
                 'Leg execution:' \
                 '| yes | `none` | `executed` |' \
                 '| no | — | `static-analysis-only` |'; do
      grep -qF "$token" "$path" || missing+="  $skill/SKILL.md lacks: $token"$'\n'
    done
  done
  [ -z "$missing" ] || {
    printf 'skills missing grade definitions:\n%s' "$missing" >&2
    return 1
  }
}

@test "the scan fails instead of passing when enumeration reaches too few files" {
  local empty="$BATS_TEST_TMPDIR/empty"
  mkdir -p "$empty"
  git -C "$empty" init -q .
  run list_reviewer_agents "$empty"
  [ "$status" -eq 2 ]
  assert_contains "$output" "scan reached only 0"
}

@test "the scan fails instead of passing outside a repository" {
  local bare="$BATS_TEST_TMPDIR/notarepo"
  mkdir -p "$bare"
  run list_reviewer_agents "$bare"
  [ "$status" -eq 2 ]
  assert_contains "$output" "could not enumerate"
}

@test "a planted agent without the contract is named" {
  # Planted in a sandbox rather than the repo: bin/run-bats kills the tree on a
  # stall and no RETURN trap survives SIGKILL, so a plant here would strand a
  # file that Claude Code then loads as a live plugin agent.
  local sandbox="$BATS_TEST_TMPDIR/sandbox"
  mkdir -p "$sandbox/plugins/review-cycle/agents"
  cp "$REPO_ROOT"/plugins/review-cycle/agents/*.md "$sandbox/plugins/review-cycle/agents/"
  printf -- '---\nname: zz-not-a-real-agent\n---\n\nNo receipt here.\n' \
    > "$sandbox/plugins/review-cycle/agents/zz-not-a-real-agent.md"
  git -C "$sandbox" init -q .

  run list_reviewer_agents "$sandbox"
  [ "$status" -eq 0 ]
  assert_contains "$output" "zz-not-a-real-agent.md"
  local missing=""
  while IFS= read -r f; do
    grep -qF "$AGENT_ANCHOR" "$f" || missing+="$(basename "$f") "
  done <<< "$output"
  assert_contains "$missing" "zz-not-a-real-agent.md"
}

@test "each skill's brief carries the receipt ask that reaches Codex" {
  # Its own test, not a token in the grade list: the brief is the only channel
  # that reaches the Codex leg, and a guard that reports "a grade is missing"
  # when the whole channel was deleted sends the reader to the wrong file.
  local skill missing=""
  for skill in review review-pr; do
    local path="$REPO_ROOT/plugins/review-cycle/skills/$skill/SKILL.md"
    local brief
    brief="$(grep -A2 -iE 'the (only )?channel that reaches it|brief is (again )?the only channel' "$path" || true)"
    [ -n "$brief" ] || { missing+="  $skill: no brief paragraph naming the Codex channel"$'\n'; continue; }
    grep -qF 'attempted-but-failed:' "$path" || missing+="  $skill: brief omits line two"$'\n'
    grep -qF 'never attempted it' "$path" || missing+="  $skill: brief omits the unattempted-check clause"$'\n'
  done
  [ -z "$missing" ] || {
    printf 'Codex brief drifted from the agent bodies:\n%s' "$missing" >&2
    return 1
  }
}
