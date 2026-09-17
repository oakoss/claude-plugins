#!/usr/bin/env bats
# Prose anchors for the cleanup skill's rules. Five rules once diverged from
# the Google developer style guide or from each other, and the cleanup skill
# rewrote correct documents as a result — measured by pointing it at this
# plugin's own style guide. Nothing in this repository read these files, so a
# mutation run reverted each of the five in turn, and separately inverted two
# rules outright ("Exclamation points are encouraged", "Always run regex
# replacements"), with bin/run-bats, `claude plugin validate --strict`,
# markdownlint and `oakum check --strict` all staying green.
#
# Like containment-anchors.bats, this checks the rule text is present, not that
# a model obeys it. Two ceilings, both measured rather than assumed:
#
#   - An anchor kept verbatim while the prose below it says the opposite still
#     passes. Appending "Ignore the scope statement above" three lines later
#     leaves every test green.
#   - Byte-identity proves the three copies agree, not that they are right.
#     The same negating clause appended to all three satisfies it. Closing that
#     needs full-text anchoring, which would churn on every wording tweak.
#
# What it does catch is a revert, a partial revert reaching two of three
# copies, a divergent fourth copy added anywhere under the plugin, and a merge
# that resolves a conflict by keeping both sides.
#
# Every extraction fails loudly when it comes back empty, and each guard is its
# own statement. An assertion in the left slot of an && list is inert on every
# bash (tests/bats-assertion-idioms.bats), which would let an empty extraction
# pass while checking nothing — the failure this suite exists to prevent
# rather than reproduce.

STYLE="output-styles/prose.md"
SKILL="skills/cleanup/SKILL.md"
SNIPPET="reference/claude-md-snippet.md"
MECHANICS="skills/cleanup/references/docs-mechanics.md"

# The scope statement's declared homes. One test derives the real set from
# disk and compares, so a fourth copy added anywhere fails rather than hides.
SCOPE_FILES=("$STYLE" "$SKILL" "$SNIPPET")
SCOPE_FLOOR=3
LIST_RULE_FILES=("$STYLE" "$SKILL" "$MECHANICS")
LIST_RULE_FLOOR=3

# The plugin ships nine files; a floor, not a count.
FILE_FLOOR=6

HYPE_WORDS=(robust seamless powerful comprehensive cutting-edge game-changer
            delve tapestry landscape journey crucial vital)

setup() {
  PLUGIN_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
}

# Prints the first line matching a fixed string, or returns 2. Anchoring a word
# to one line matters: the hype words also appear in this plugin's own examples
# and prose, so a file-wide or section-wide grep passes on a gutted ban list.
only_line() {
  local f="$PLUGIN_ROOT/$1" needle="$2" line
  [ -f "$f" ] || { echo "missing file: $1" >&2; return 2; }
  [ -n "$needle" ] || { echo "only_line: empty needle for $1" >&2; return 2; }
  line="$(grep -m1 -F -- "$needle" "$f")" || {
    echo "no line containing '$needle' in $1" >&2
    return 2
  }
  [ -n "$line" ] || { echo "empty match for '$needle' in $1" >&2; return 2; }
  printf '%s\n' "$line"
}

# 1-indexed line number of a pattern's first match, or 2. The pipeline masks
# grep's own status, so the empty result is what gets checked.
line_of() {
  local f="$PLUGIN_ROOT/$1" pattern="$2" n
  [ -f "$f" ] || { echo "missing file: $1" >&2; return 2; }
  n="$(grep -n -m1 -E -- "$pattern" "$f" | cut -d: -f1)"
  [ -n "$n" ] || { echo "no match for '$pattern' in $1" >&2; return 2; }
  printf '%s\n' "$n"
}

# The first rule each copy states. The scope statement must precede it.
first_rule_pattern() {
  case "$1" in
    "$STYLE")   printf '%s\n' '^## Never write' ;;
    "$SKILL")   printf '%s\n' '^## Workflow' ;;
    "$SNIPPET") printf '%s\n' '^Never write:' ;;
    *) echo "no first-rule pattern for $1" >&2; return 2 ;;
  esac
}

# An empty needle would make grep -qF match anything, passing vacuously.
assert_file_contains() {
  local file="$1" needle="$2" path="$PLUGIN_ROOT/$1"
  if [ "$#" -ne 2 ] || [ -z "$needle" ]; then
    echo "assert_file_contains: empty or missing needle" >&2
    return 1
  fi
  [ -f "$path" ] || { echo "missing file: $file" >&2; return 1; }
  grep -qF -- "$needle" "$path" || {
    echo "$file is missing the anchor: $needle" >&2
    return 1
  }
}

# The words the canonical bullet actually bans, one per line, sorted. Quoted
# in the output style, bare and comma-separated in the skill's table row, so
# each is normalised to the same shape before comparison.
style_hype_words() {
  local bullet
  bullet="$(only_line "$STYLE" '- Hype and stock LLM vocabulary:')" || return 2
  printf '%s\n' "$bullet" | grep -o '"[^"]*"' | tr -d '"' | sort
}

skill_hype_words() {
  local row cell
  row="$(only_line "$SKILL" 'canonical list: the "Never write" section')" || return 2
  cell="${row#| }"
  cell="${cell%%(canonical list:*}"
  printf '%s\n' "$cell" | tr ',' '\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' \
    | grep -v '^$' | sort
}

@test "the enumerations have not collapsed" {
  [ "${#SCOPE_FILES[@]}" -ge "$SCOPE_FLOOR" ]
  [ "${#LIST_RULE_FILES[@]}" -ge "$LIST_RULE_FLOOR" ]
  [ "${#HYPE_WORDS[@]}" -ge 12 ]
  local f
  for f in "${SCOPE_FILES[@]}" "${LIST_RULE_FILES[@]}"; do
    [ -f "$PLUGIN_ROOT/$f" ] || { echo "missing file: $f" >&2; return 1; }
  done
}

@test "no file outside the declared set carries a scope statement" {
  # Divergence by addition is at least as likely as divergence by edit: it is
  # what happens when someone adds a reference page or a second snippet.
  #
  # Enumerated with git, not a filesystem walk: a gitignored *.md under the
  # plugin sits on disk without being part of it. Untracked files still count,
  # because a fourth copy is a divergence before it is committed -- but merge
  # artifacts are dropped, since .orig and .rej are copies by definition and
  # would report every conflicted merge as a divergent scope statement. The
  # floor is what stops a broken enumeration from reading as a clean tree.
  local count found expected
  count="$(cd "$PLUGIN_ROOT" && git ls-files --cached --others --exclude-standard | wc -l | tr -d ' ')"
  [ -n "$count" ] || { echo "could not enumerate files under $PLUGIN_ROOT" >&2; return 1; }
  [ "$count" -ge "$FILE_FLOOR" ] || {
    echo "enumeration reached $count files, expected at least $FILE_FLOOR" >&2
    return 1
  }
  found="$(cd "$PLUGIN_ROOT" && git ls-files -z --cached --others --exclude-standard \
    | xargs -0 grep -l '^Scope: prose only\.' \
    | grep -vE '\.(orig|rej|bak)$|~$' | sort)"
  [ -n "$found" ] || { echo "no scope statement found in any tracked file" >&2; return 1; }
  expected="$(printf '%s\n' "${SCOPE_FILES[@]}" | sort)"
  if [ "$found" != "$expected" ]; then
    echo "scope statements on disk do not match the declared set" >&2
    echo "  on disk:  $(echo $found)" >&2
    echo "  declared: $(echo $expected)" >&2
    return 1
  fi
}

@test "the scope statement is byte-identical in all three copies" {
  local first first_file f line
  first_file="${SCOPE_FILES[0]}"
  first="$(only_line "$first_file" "Scope: prose only.")"
  [ -n "$first" ]

  for f in "${SCOPE_FILES[@]:1}"; do
    line="$(only_line "$f" "Scope: prose only.")"
    [ -n "$line" ]
    if [ "$line" != "$first" ]; then
      echo "scope statement differs between $first_file and $f" >&2
      echo "  $first_file: $first" >&2
      echo "  $f: $line" >&2
      return 1
    fi
  done
}

@test "the scope statement governs generation, not only rewriting" {
  local f
  for f in "${SCOPE_FILES[@]}"; do
    assert_file_contains "$f" "prose you write and prose you rewrite"
    assert_file_contains "$f" "an example quoted to illustrate a rule"
  done
}

@test "the scope statement precedes the rules it governs in every copy" {
  local f pattern scope_at rules_at
  for f in "${SCOPE_FILES[@]}"; do
    pattern="$(first_rule_pattern "$f")"
    [ -n "$pattern" ]
    scope_at="$(line_of "$f" '^Scope: prose only\.')"
    [ -n "$scope_at" ]
    rules_at="$(line_of "$f" "$pattern")"
    [ -n "$rules_at" ]
    if [ "$scope_at" -ge "$rules_at" ]; then
      echo "$f states its scope at line $scope_at, below its first rule at $rules_at" >&2
      return 1
    fi
  done
}

@test "the register table sits below the scope statement" {
  # Its "Too chummy" column carries an exclamation point and a filler "just" on
  # purpose. The table has to sit below the scope statement, or the one block
  # the rules would condemn is the one they reach first.
  local scope_at table_at
  scope_at="$(line_of "$STYLE" '^Scope: prose only\.')"
  [ -n "$scope_at" ]
  table_at="$(line_of "$STYLE" '^The following table shows')"
  [ -n "$table_at" ]
  if [ "$scope_at" -ge "$table_at" ]; then
    echo "$STYLE states its scope at line $scope_at, below the register table at $table_at" >&2
    return 1
  fi
}

@test "the list rule carries Google's colon-or-period latitude" {
  local f
  for f in "${LIST_RULE_FILES[@]}"; do
    assert_file_contains "$f" "can end with a colon or a period"
    assert_file_contains "$f" "usually a colon immediately before the list"
  done
}

@test "the list rule carries Google's heading exemption" {
  assert_file_contains "$STYLE" "unless the heading directly above it already supplies the context"
  assert_file_contains "$SKILL" "needs no context beyond the heading"
  assert_file_contains "$MECHANICS" "needs no context beyond the heading"
}

@test "tables and code blocks still require an introduction, with its reason" {
  # Google states this one unconditionally; its single-table exemption covers
  # captions, not introductions. The rationale is what stops the rule being
  # re-softened, so it is anchored alongside the rule.
  assert_file_contains "$STYLE" "Introduce a table or code block with a complete sentence"
  assert_file_contains "$STYLE" "not all screen readers preannounce tables"
  assert_file_contains "$MECHANICS" 'Introduce with a complete sentence; say "the following table"'
}

@test "the future-tense swap covers will, and neither would nor could" {
  local row
  row="$(only_line "$SKILL" '| will (')"
  case "$row" in
    *'will ("the server will send")'*) ;;
    *) echo "the will row lost its example: $row" >&2; return 1 ;;
  esac
  # Matches only a row naming would or could as a swap TARGET -- the first
  # cell must open with one of the three. A bare 'would' anywhere would hit
  # the Pass 1 row 'Sentences that would fit unchanged', a correct subjunctive.
  # Scoped this way a merge that keeps both sides, adding a second row rather
  # than restoring the original, still fails.
  run grep -qE '^\|[[:space:]]*(will|would|could)\b[^|]*\b(would|could)\b' "$PLUGIN_ROOT/$SKILL"
  [ "$status" -eq 1 ]
  assert_file_contains "$SKILL" "keep it for a genuinely future event"
}

@test "the exception pass 3 grants survives the step 5 re-scan" {
  assert_file_contains "$SKILL" "Skip anything pass 3 or pass 4 deliberately licensed"
  assert_file_contains "$SKILL" "Reserve future tense for genuinely future events"
}

@test "all three copies carry the future-tense exception" {
  assert_file_contains "$STYLE" "Keep the future tense for a genuinely future event"
  assert_file_contains "$SKILL" "keep it for a genuinely future event"
  assert_file_contains "$SNIPPET" "future only for a genuinely future event"
}

@test "all three copies scope superlatives to claims about behavior" {
  assert_file_contains "$STYLE" "governs claims about behavior, not instructions"
  assert_file_contains "$SKILL" "in a claim about behavior"
  assert_file_contains "$SNIPPET" "in claims about behavior"
  # Without the exception the narrowing is decorative: the subject is scoped
  # while the remedy still says to delete every absolute.
  assert_file_contains "$STYLE" '"never bypass the gate" is a rule'
  assert_file_contains "$SKILL" 'an imperative ("never bypass hooks") is a rule, and stays'
  assert_file_contains "$SNIPPET" '"never bypass the gate") is a rule and stays'
}

@test "the canonical hype list is exactly the declared set" {
  # Set equality, not subset: adding a word to one copy and not the other is
  # the divergence this plugin was filed for, and a subset check passes on it.
  local found expected
  found="$(style_hype_words)"
  [ -n "$found" ] || { echo "no words in the canonical hype bullet" >&2; return 1; }
  expected="$(printf '%s\n' "${HYPE_WORDS[@]}" | sort)"
  if [ "$found" != "$expected" ]; then
    echo "$STYLE's hype bullet does not match the declared set" >&2
    echo "  in the bullet: $(echo $found)" >&2
    echo "  declared:      $(echo $expected)" >&2
    return 1
  fi
}

@test "the skill's hype list is the same set, restated rather than only cited" {
  # AGENTS.md, Skill conventions: the skill should be self-contained. A bare
  # cross-file link degrades to citing nothing if the target moves.
  # Measured: seamless and powerful also appear in the skill's "Not
  # recommended" example, delve and tapestry in its prose about the 2024 word
  # set, so a file-wide grep passed with four words dropped from the row.
  local found expected
  found="$(skill_hype_words)"
  [ -n "$found" ] || { echo "no words in the skill's hype row" >&2; return 1; }
  expected="$(printf '%s\n' "${HYPE_WORDS[@]}" | sort)"
  if [ "$found" != "$expected" ]; then
    echo "$SKILL's hype row does not match the declared set" >&2
    echo "  in the row: $(echo $found)" >&2
    echo "  declared:   $(echo $expected)" >&2
    return 1
  fi
}

@test "the skill's citation of the output style resolves on disk" {
  assert_file_contains "$SKILL" "../../output-styles/prose.md"
  local target
  target="$(cd "$PLUGIN_ROOT/skills/cleanup" && pwd)/../../output-styles/prose.md"
  [ -s "$target" ]
  # The citation names this heading; a rename would leave it pointing at
  # nothing while every check stayed green.
  grep -q '^## Never write' "$target"
}

@test "the two rules a mutation run inverted are anchored" {
  # Both inversions passed every check in this repository before this suite
  # existed, and the header names them as the motivating silent failures.
  assert_file_contains "$STYLE" "- Exclamation points."
  assert_file_contains "$SKILL" "Never run regex replacements"
}
