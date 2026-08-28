#!/usr/bin/env bats
# Prose anchors for the review cycle's contracts. The containment contract is
# the largest: every measuring reviewer works in a private mktemp -d — never a
# shared session scratchpad — names that directory in its report, and no agent
# the cycle spawns may reshape a command to slip past a guard. Later tests
# anchor the effort argument, the settled-findings brief, and release-note
# verification the same way.
#
# Two measured incidents motivate the anchors: a reviewer's copy mutated
# mid-run by a sibling agent sharing the session scratchpad, and a reviewer
# that ran another agent's script by accident and received a results matrix it
# had not authored. Like execution-receipt.bats, this checks the instruction
# is present, not that an agent obeys it at runtime — it catches a partial
# revert and an agent that never joined the contract. An anchor kept verbatim
# but contradicted by surrounding prose still passes; that is the inherent
# limit of prose anchoring.
#
# `cleanup.md` edits the target by design, so it carries only the never-evade
# rule, not the private-workdir requirement.

PRIVATE_DIR_ANCHOR='mktemp -d'
SHARED_SCRATCHPAD_ANCHOR='never a shared session scratchpad'
NAME_DIR_ANCHOR='name that directory in your report'
WRITE_NOWHERE_ANCHOR='write nowhere outside it'
EVADE_ANCHOR='slip past a guard'

# Seven agents today, cleanup included. A floor, not a count: the per-file
# loop catches one dropping out; this only catches the enumeration collapsing.
AGENT_FLOOR=7

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  # shellcheck source=/dev/null
  source "$REPO_ROOT/plugins/review-cycle/tests/helpers.bash"
}

# Returns 2 rather than empty output on every way the scan can break, so a
# broken scan and a clean tree never look alike.
list_all_agents() {
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
    if [ ! -e "$root/$f" ]; then
      printf 'enumerated %s but it does not exist\n' "$f" >&2
      return 2
    fi
    files+=("$root/$f")
  done < "$list"

  if [ "${#files[@]}" -lt "$min" ]; then
    printf 'scan reached only %s agents (expected at least %s)\n' \
      "${#files[@]}" "$min" >&2
    return 2
  fi
  printf '%s\n' "${files[@]}"
  return 0
}

@test "every measuring agent requires a private mktemp -d it names in its report" {
  run list_all_agents
  [ "$status" -eq 0 ] || {
    printf 'enumeration failed (status %s):\n%s\n' "$status" "$output" >&2
    return 1
  }
  local missing=""
  while IFS= read -r f; do
    [ "$(basename "$f")" = "cleanup.md" ] && continue
    [ -r "$f" ] || { missing+="  $(basename "$f") — unreadable"$'\n'; continue; }
    grep -qF "$PRIVATE_DIR_ANCHOR" "$f" || missing+="  $(basename "$f") — no mktemp -d requirement"$'\n'
    grep -qF "$SHARED_SCRATCHPAD_ANCHOR" "$f" || missing+="  $(basename "$f") — shared-scratchpad ban lost"$'\n'
    grep -qiF "$NAME_DIR_ANCHOR" "$f" || missing+="  $(basename "$f") — measurements not traceable to a named directory"$'\n'
    grep -qiF "$WRITE_NOWHERE_ANCHOR" "$f" || missing+="  $(basename "$f") — write-nowhere clause lost"$'\n'
  done <<< "$output"
  [ -z "$missing" ] || {
    printf 'agents outside the private-workdir contract:\n%s' "$missing" >&2
    return 1
  }
}

@test "every agent, cleanup included, carries the never-evade rule" {
  run list_all_agents
  [ "$status" -eq 0 ] || {
    printf 'enumeration failed (status %s):\n%s\n' "$status" "$output" >&2
    return 1
  }
  local missing=""
  while IFS= read -r f; do
    [ -r "$f" ] || { missing+="  $(basename "$f") — unreadable"$'\n'; continue; }
    grep -qF "$EVADE_ANCHOR" "$f" || missing+="  $(basename "$f") — never-evade rule lost"$'\n'
  done <<< "$output"
  [ -z "$missing" ] || {
    printf 'agents without the never-evade rule:\n%s' "$missing" >&2
    return 1
  }
}

# The anchors must sit on each reviewer spawn-prompt line individually:
# a file-wide grep is satisfied by the Phase 7 sentence or by review-pr's
# worktree mktemp command, and a concatenated multi-prompt grep is satisfied
# by clauses parked on the cleanup prompt — both measured survivors.
# `prompt: "Review` matches the reviewer prompts and excludes cleanup's
# `prompt: "Run cleanup`, which intentionally carries no containment.
@test "every reviewer spawn prompt carries the containment clauses on its own line" {
  local skill missing=""
  for skill in review review-pr; do
    local path="$REPO_ROOT/plugins/review-cycle/skills/$skill/SKILL.md"
    [ -r "$path" ] || { missing+="  $skill: SKILL.md unreadable"$'\n'; continue; }
    # Each layer closes a measured survivor: paired-range awk fails open past
    # a renamed heading, a prose decoy defeats a file-wide or mid-line match,
    # and -eq on grep -c's empty exit-2 output silently skips the guard.
    # Residual: a verbatim line-start counterfeit inside Phase 3 still passes.
    local head section count line
    case "$skill" in
      review) head='prompt: "Review uncommitted changes in <PROJECT_ROOT>' ;;
      review-pr) head='prompt: "Review git diff' ;;
    esac
    section="$(awk '/^##+ Phase 3/{f=1} f{print} f && /^##+ Phase 4/{exit}' "$path")" || true
    if [ -z "$section" ]; then
      missing+="  $skill: Phase 3 section not found"$'\n'
      continue
    fi
    printf '%s\n' "$section" | tail -1 | grep -Eq '^##+ Phase 4' || {
      missing+="  $skill: Phase 3 section unterminated"$'\n'
      continue
    }
    count="$(printf '%s\n' "$section" | grep -E '^[[:space:]]*prompt: "' | grep -cF "$head")" || true
    if [ "$count" != 1 ]; then
      missing+="  $skill: reviewer spawn prompt head expected exactly once in Phase 3, found ${count:-unreadable}"$'\n'
      continue
    fi
    line="$(printf '%s\n' "$section" | grep -E '^[[:space:]]*prompt: "' | grep -F "$head")"
    printf '%s' "$line" | grep -qF "$PRIVATE_DIR_ANCHOR" || missing+="  $skill: the reviewer prompt lost mktemp -d"$'\n'
    printf '%s' "$line" | grep -qF 'never a shared scratchpad' || missing+="  $skill: the reviewer prompt lost the scratchpad ban"$'\n'
    printf '%s' "$line" | grep -qF 'never reshape a command to slip past a guard' || missing+="  $skill: the reviewer prompt lost the never-evade clause"$'\n'
    printf '%s' "$line" | grep -qiF "$NAME_DIR_ANCHOR" || missing+="  $skill: the reviewer prompt lost the name-directory clause"$'\n'
    printf '%s' "$line" | grep -qiF "$WRITE_NOWHERE_ANCHOR" || missing+="  $skill: the reviewer prompt lost the write-nowhere clause"$'\n'
  done
  [ -z "$missing" ] || {
    printf 'skills outside the containment contract:\n%s' "$missing" >&2
    return 1
  }
}

# Phase 7's report-only containment sentence is a separate site with its own
# drift history — a reverted copy left the file-wide form green, and a
# verbatim sentence relocated to unrelated prose survived a bare count guard.
# Binding to the paragraph marker line forces a decoy to counterfeit the
# whole paragraph header, and the marker is required exactly once. String
# compare, not -eq: grep -c exit 2 leaves count empty, and an arithmetic
# test reads that as false and asserts nothing (measured fail-open).
@test "the review skill's Phase 7 containment sentence stands on its own" {
  local path="$REPO_ROOT/plugins/review-cycle/skills/review/SKILL.md"
  local marker='Both report-only spawns carry the containment sentence'
  local missing="" section count line
  [ -r "$path" ] || { printf 'review SKILL.md unreadable\n' >&2; return 1; }
  section="$(awk '/^##+ Phase 7/{f=1} f{print} f && /^##+ Phase 8/{exit}' "$path")" || true
  if [ -z "$section" ]; then
    printf 'review: Phase 7 section not found\n' >&2; return 1
  fi
  printf '%s\n' "$section" | tail -1 | grep -Eq '^##+ Phase 8' || {
    printf 'review: Phase 7 section unterminated\n' >&2; return 1
  }
  count="$(printf '%s\n' "$section" | grep -cF "$marker")" || true
  if [ "$count" != 1 ]; then
    missing+="  review: Phase 7 containment paragraph expected exactly once in Phase 7, found ${count:-unreadable}"$'\n'
  else
    line="$(printf '%s\n' "$section" | grep -F "$marker")"
    printf '%s' "$line" | grep -qF 'work only on a copy in a private' || missing+="  review: Phase 7 sentence lost its private-workdir clause"$'\n'
    printf '%s' "$line" | grep -qF 'never a shared scratchpad' || missing+="  review: Phase 7 sentence lost the scratchpad ban"$'\n'
    printf '%s' "$line" | grep -qF 'reshape a command' || missing+="  review: Phase 7 sentence lost the never-evade clause"$'\n'
    printf '%s' "$line" | grep -qiF "$NAME_DIR_ANCHOR" || missing+="  review: Phase 7 sentence lost the name-directory clause"$'\n'
    printf '%s' "$line" | grep -qiF "$WRITE_NOWHERE_ANCHOR" || missing+="  review: Phase 7 sentence lost the write-nowhere clause"$'\n'
  fi
  [ -z "$missing" ] || {
    printf 'Phase 7 containment drifted:\n%s' "$missing" >&2
    return 1
  }
}

@test "both skills carry the effort-argument contract" {
  local skill missing=""
  for skill in review review-pr; do
    local path="$REPO_ROOT/plugins/review-cycle/skills/$skill/SKILL.md"
    [ -r "$path" ] || { missing+="  $skill: SKILL.md unreadable"$'\n'; continue; }
    grep -qF '`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`' "$path" \
      || missing+="  $skill: seven-literal effort set lost"$'\n'
    grep -qF 'name the invalid value, list the valid set, and stop' "$path" \
      || missing+="  $skill: invalid-effort stop rule lost"$'\n'
    grep -qF 'on either tier, raising included' "$path" \
      || missing+="  $skill: explicit-argument override lost"$'\n'
    grep -qF 'requested, unused]' "$path" \
      || missing+="  $skill: unused-effort template vocabulary lost"$'\n'
    grep -qF 'Carry the never-evade rule into the brief the same way: never reshape a command to slip past a guard' "$path" \
      || missing+="  $skill: never-evade lost its route to the Codex brief"$'\n'
  done
  grep -qF 'for reading, not measurement' "$REPO_ROOT/plugins/review-cycle/skills/review/SKILL.md" \
    || missing+="  review: reading-shaped Codex question rule lost"$'\n'
  [ -z "$missing" ] || {
    printf 'effort-argument contract drifted:\n%s' "$missing" >&2
    return 1
  }
}

@test "the scan fails instead of passing when enumeration reaches too few files" {
  local empty="$BATS_TEST_TMPDIR/empty"
  mkdir -p "$empty"
  git -C "$empty" init -q .
  run list_all_agents "$empty"
  [ "$status" -eq 2 ]
  assert_contains "$output" "scan reached only 0"
}

@test "the scan fails instead of passing outside a repository" {
  local bare="$BATS_TEST_TMPDIR/notarepo"
  mkdir -p "$bare"
  run list_all_agents "$bare"
  [ "$status" -eq 2 ]
  assert_contains "$output" "could not enumerate"
}

@test "Phase 3 tells later iterations what earlier ones settled" {
  local path="$REPO_ROOT/plugins/review-cycle/skills/review/SKILL.md"
  local marker='already settled this cycle'
  local missing="" section count line
  [ -r "$path" ] || { printf 'review SKILL.md unreadable\n' >&2; return 1; }
  section="$(awk '/^##+ Phase 3/{f=1} f{print} f && /^##+ Phase 4/{exit}' "$path")" || true
  if [ -z "$section" ]; then
    printf 'review: Phase 3 section not found\n' >&2; return 1
  fi
  printf '%s\n' "$section" | tail -1 | grep -Eq '^##+ Phase 4' || {
    printf 'review: Phase 3 section unterminated\n' >&2; return 1
  }
  count="$(printf '%s\n' "$section" | grep -cF "$marker")" || true
  if [ "$count" != 1 ]; then
    missing+="  review: settled-findings block expected exactly once in Phase 3, found ${count:-unreadable}"$'\n'
  else
    # Anchors span enough words that a splice cutting THROUGH them breaks the
    # match — measured: 'not to be re-reported' alone stayed green under
    # "Nothing here says these are not to be re-reported"; the widened form
    # fails. Residual: a negation wrapped around an intact span still passes,
    # as does the paragraph relocated elsewhere within the same phase.
    line="$(printf '%s\n' "$section" | grep -F "$marker")"
    printf '%s' "$line" | grep -qF 'From iteration 2 on' || missing+="  review: settled block lost its iteration-2 trigger"$'\n'
    printf '%s' "$line" | grep -qF 'listing four things: what was fixed; what was deferred and why; what was rebutted and on what basis, whether a measurement, the documentation, or a deliberate design decision' || missing+="  review: settled block lost the four-item enumeration"$'\n'
    printf '%s' "$line" | grep -qF '; and what was examined and left alone on purpose. That last category is not optional' || missing+="  review: examined-and-left-alone demoted out of the mandated list"$'\n'
    printf '%s' "$line" | grep -qF 'these are settled and are not to be re-reported' || missing+="  review: settled block lost its do-not-re-report rule"$'\n'
    printf '%s' "$line" | grep -qF 'must say so with new evidence rather than restating' || missing+="  review: settled block lost the new-evidence escape"$'\n'
    printf '%s' "$line" | grep -qF 'Every leg gets it, Codex included,' || missing+="  review: settled block lost its route to the Codex brief"$'\n'
  fi
  [ -z "$missing" ] || {
    printf 'settled-findings contract drifted:\n%s' "$missing" >&2
    return 1
  }
}

@test "Phase 7 checks release-note files against the diff, and cleanup may not fake the check" {
  local skill="$REPO_ROOT/plugins/review-cycle/skills/review/SKILL.md"
  local agent="$REPO_ROOT/plugins/review-cycle/agents/cleanup.md"
  local marker='Check every release-note file in play against the diff itself'
  local missing="" section count line summary evidence
  [ -r "$skill" ] || { printf 'review SKILL.md unreadable\n' >&2; return 1; }
  [ -r "$agent" ] || { printf 'cleanup.md unreadable\n' >&2; return 1; }
  section="$(awk '/^##+ Phase 7/{f=1} f{print} f && /^##+ Phase 8/{exit}' "$skill")" || true
  if [ -z "$section" ]; then
    printf 'review: Phase 7 section not found\n' >&2; return 1
  fi
  printf '%s\n' "$section" | tail -1 | grep -Eq '^##+ Phase 8' || {
    printf 'review: Phase 7 section unterminated\n' >&2; return 1
  }
  count="$(printf '%s\n' "$section" | grep -cF "$marker")" || true
  if [ "$count" != 1 ]; then
    missing+="  review: release-note check expected exactly once in Phase 7, found ${count:-unreadable}"$'\n'
  else
    # Bound to the marker's own line: a clause parked in an unrelated Phase 7
    # bullet satisfied a section-wide grep (measured). Residuals, as in the
    # Phase 3 test: a negation wrapped around an intact span, and the
    # paragraph relocated within the section, both still pass.
    line="$(printf '%s\n' "$section" | grep -F "$marker")"
    printf '%s' "$line" | grep -qF 'plus any already staged before the cycle began' \
      || missing+="  review: release-note check no longer covers files staged in an earlier pass"$'\n'
    printf '%s' "$line" | grep -qF 'against the final post-fix state and correct it' \
      || missing+="  review: release-note check lost its final-state correct-or-report rule"$'\n'
    printf '%s' "$line" | grep -qF 'last, after cleanup has finished editing' \
      || missing+="  review: release-note check no longer runs after cleanup"$'\n'
    printf '%s' "$line" | grep -qF 'Do this yourself, whichever cleanup mode runs' \
      || missing+="  review: release-note check no longer binds both cleanup modes"$'\n'
    printf '%s' "$line" | grep -qF "the summary's release-note field, separately from wording changes" \
      || missing+="  review: release-note check lost its route to the Phase 9 field"$'\n'
    # A second directive elsewhere in Phase 7 restores the pre-fix order while
    # every anchor above still matches. Bold-lead lines only: an unscoped
    # count also fires on prose describing the step; bullet and indented
    # directives count too, being the form Phase 7 already uses. Residual:
    # splitting the
    # instruction into two bold directives trips this legitimately.
    [ "$(printf '%s\n' "$section" | grep -E '^[[:space:]]*(- )?\*\*' | grep -icE 'release[- ]note|changeset|bump file')" = 1 ] \
      || missing+="  review: Phase 7 mentions release notes off the marker line — a second, earlier check would undo the ordering"$'\n'
  fi
  summary="$(awk '/^##+ Phase 9/{f=1} f{print} f && /^##+ Phase 10/{exit}' "$skill")" || true
  if [ -z "$summary" ]; then
    printf 'review: Phase 9 section not found\n' >&2; return 1
  fi
  printf '%s\n' "$summary" | tail -1 | grep -Eq '^##+ Phase 10' || {
    printf 'review: Phase 9 section unterminated\n' >&2; return 1
  }
  # Whole line, not the label: 'Release-note corrections: N — <ignore; always
  # print none>' satisfied a label-only anchor.
  printf '%s\n' "$summary" | grep -qF 'Release-note corrections: N — <file, the claim that no longer matched the diff> | none | not checked (<reason>) | no release-note file in this diff' \
    || missing+="  review: Phase 9 lost the release-note corrections field"$'\n'
  evidence="$(awk '/^## Evidence/{f=1; next} f && /^## /{exit} f{print}' "$agent")" || true
  if [ -z "$evidence" ]; then
    printf 'cleanup: Evidence section not found\n' >&2; return 1
  fi
  printf '%s\n' "$evidence" | grep -qF 'Never report that prose matches the code unless you compared them line by line.' \
    || missing+="  cleanup: lost the ban on asserting an unverified match"$'\n'
  printf '%s\n' "$evidence" | grep -qF 'Either compare and say what you compared, or say you did not check' \
    || missing+="  cleanup: lost the sanctioned alternative to the ban"$'\n'
  [ -z "$missing" ] || {
    printf 'release-note verification drifted:\n%s' "$missing" >&2
    return 1
  }
}

@test "a planted agent without the contract is named" {
  # Planted in a sandbox rather than the repo: bin/run-bats kills the tree on a
  # stall and no RETURN trap survives SIGKILL, so a plant here would strand a
  # file that Claude Code then loads as a live plugin agent.
  local sandbox="$BATS_TEST_TMPDIR/sandbox"
  mkdir -p "$sandbox/plugins/review-cycle/agents"
  cp "$REPO_ROOT"/plugins/review-cycle/agents/*.md "$sandbox/plugins/review-cycle/agents/"
  printf -- '---\nname: zz-not-a-real-agent\n---\n\nNo containment here.\n' \
    > "$sandbox/plugins/review-cycle/agents/zz-not-a-real-agent.md"
  git -C "$sandbox" init -q .

  run list_all_agents "$sandbox"
  [ "$status" -eq 0 ]
  assert_contains "$output" "zz-not-a-real-agent.md"
  local missing=""
  while IFS= read -r f; do
    grep -qF "$EVADE_ANCHOR" "$f" || missing+="$(basename "$f") "
  done <<< "$output"
  assert_contains "$missing" "zz-not-a-real-agent.md"
}
