#!/usr/bin/env bats
# Repo-wide guard against assertion shapes that pass silently when they
# should fail. A bare [[ ]] or (( )) is exempt from `set -e` on bash 3.2
# (macOS); a leading `!` is exempt on every bash per POSIX. A mid-body
# assertion in any of those shapes is decoration. Use assert_contains,
# refute_contains, assert_matches, or refute from the shared helpers.
#
# No tail-position exception: a final bare statement is enforced through the
# test's return status, but the helpers serve it equally well and report what
# failed, so the rule stays a few greps rather than a parser.
#
# Deliberately uncovered, because closing them needs the quote- and
# heredoc-awareness this rule refuses to grow. Do not read the list as
# "harmless" — where noted, the shape is inert and nothing here catches it:
#   - a compound split across lines (`[[ "$a" = x &&` / `"$b" = y ]]`):
#     inert on bash 3.2, so only the Linux CI leg catches it at all
#   - an assertion in the left slot of an AND-list (`[[ 1 = 2 ]] && echo x`):
#     inert on EVERY bash, uncaught
#   - an assertion ending a `case` branch with `;;`, which the patterns'
#     single optional `;` does not match
#   - anything inside a nested repository or submodule, which `git ls-files`
#     does not descend into
#
# Legal shapes this guard rejects, with no suppression marker to escape it:
#   - `! cmd && guard` / `! cmd || recover`, which branch rather than assert
#   - `! cmd` as a negative-predicate function's whole body
#   - a continuation line of a multi-line `if` condition
#   - a bare assertion inside a heredoc that plants a shell fixture — the
#     likeliest to bite here, since several suites plant git shims that way
#   - `(( n++ ))` as an increment; the failure message names the alternative
# If one of those is ever needed, the answer is a suppression marker, not a
# weakened pattern.

BARE_TEST='^[[:space:]]*\[\[.*\]\][[:space:]]*;?[[:space:]]*(#.*)?$'
BARE_ARITH='^[[:space:]]*\(\(.*\)\)[[:space:]]*;?[[:space:]]*(#.*)?$'
# Deliberately blunt: no branch exclusion. `! cmd && guard` is a legal shape
# this rejects, but no leading-`!` line of any kind exists in the tree, so
# precision here buys nothing and every attempt at it has opened a hole —
# an operator inside a quoted argument is indistinguishable from a real one
# without parsing. If a real guard clause ever needs to live here, the answer
# is the suppression marker tracked as cpl-mqy, not a cleverer pattern.
LEADING_BANG='^[[:space:]]*![[:space:]]'

# A tripwire for "the enumeration collapsed", not a completeness check — the
# tree holds 14 matching files. The per-root test below is what catches a
# single directory dropping out, which a count cannot see.
FLOOR=10

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  # Sourced by absolute path: this suite lives outside the plugin, so `load`
  # cannot reach the helpers it points offenders at. Consolidating the
  # helper copies is tracked as cpl-fjs.
  # shellcheck source=/dev/null
  source "$REPO_ROOT/plugins/review-cycle/tests/helpers.bash"
}

# Prints "file:line:text" per match, and returns 2 rather than empty output
# on every way the scan can break — a broken scan and a clean repo must not
# look alike, which is the failure this suite exists to forbid.
scan_suites() {
  local pattern="$1" root="${2:-$REPO_ROOT}" min="${3:-$FLOOR}"
  local tmp="${BATS_TEST_TMPDIR:?scan_suites needs BATS_TEST_TMPDIR}"
  local list="$tmp/suite-list" err="$tmp/scan-err"
  local files=() f rc

  # git rather than find: the index cannot be half-walked, so an unreadable
  # directory cannot silently truncate the scan, and gitignored trees drop out
  # without hand-written prunes. A failed redirect fails this command too, so
  # an unusable scratch dir lands here rather than passing quietly.
  git -C "$root" ls-files -z --cached --others --exclude-standard \
    -- '*.bats' '*.bash' > "$list" 2>"$err" || {
    printf 'could not enumerate suites under %s: %s\n' "$root" "$(head -3 "$err" 2>/dev/null)" >&2
    return 2
  }
  # `--others` walks the worktree and only warns when it cannot open a
  # directory, dropping those files while exiting 0; only `--cached` is immune
  # to a half-walk. This is the guard the walk itself does not give us.
  if [ -s "$err" ]; then
    printf 'enumeration under %s was incomplete: %s\n' "$root" "$(head -3 "$err" 2>/dev/null)" >&2
    return 2
  fi
  while IFS= read -r -d '' f; do
    # `--cached` lists index entries whether or not they exist on disk, and
    # `--others` lists a dangling symlink: either would otherwise surface as
    # an unexplained grep failure.
    if [ ! -e "$root/$f" ]; then
      printf 'enumerated %s under %s but it does not exist\n' "$f" "$root" >&2
      return 2
    fi
    files+=("$root/$f")
  done < "$list"

  if [ "${#files[@]}" -lt "$min" ]; then
    printf 'scan reached only %s files under %s (expected at least %s)\n' \
      "${#files[@]}" "$root" "$min" >&2
    return 2
  fi

  # One invocation over every operand: grep already returns >= 2 when any file
  # cannot be read, including 128+N when it dies by signal, which writes no
  # stderr at all. The floor guarantees at least one operand, so grep never
  # falls back to reading stdin.
  LC_ALL=C grep -nHE "$pattern" -- "${files[@]}" || {
    rc=$?
    if [ "$rc" -gt 1 ]; then
      printf 'grep failed (status %s) scanning %s\n' "$rc" "$root" >&2
      return 2
    fi
  }
  return 0
}

assert_scan_clean() {
  local label="$1" pattern="$2"
  run scan_suites "$pattern"
  [ "$status" -eq 0 ] || {
    printf 'scan did not run (status %s):\n%s\n' "$status" "$output" >&2
    return 1
  }
  [ -z "$output" ] || {
    printf '%s:\n%s\n' "$label" "$output" >&2
    return 1
  }
}

# Fixtures are their own git repos so the scan enumerates them the same way it
# enumerates the real tree, and carry enough files to clear the floor.
plant_fixture() {
  local dir="$1" i=0
  mkdir -p "$dir"
  git -C "$dir" init -q
  while [ "$i" -lt "$FLOOR" ]; do
    printf '@test "pad %s" {\n  [ 1 = 1 ]\n}\n' "$i" > "$dir/pad$i.bats"
    i=$((i + 1))
  done
}

@test "no bare [[ ]] assertions in any suite" {
  assert_scan_clean 'Inert on bash 3.2 — use assert_contains/assert_matches' "$BARE_TEST"
}

@test "no bare (( )) assertions in any suite" {
  assert_scan_clean 'Inert on bash 3.2 — use [ ] to compare, n=$((n + 1)) to mutate' "$BARE_ARITH"
}

@test "no leading-! assertions in any suite" {
  assert_scan_clean 'Inert on every bash — use refute' "$LEADING_BANG"
}

# Positive control: without it, every silent-pass mode below is
# indistinguishable from a clean repo.
@test "the scan reports each forbidden shape when one is present" {
  local dir="$BATS_TEST_TMPDIR/fixture"
  plant_fixture "$dir"
  printf '@test "planted" {\n  [[ 1 = 1 ]]\n  [[ 1 = 1 ]] # trailing comment\n  [[ 1 = 1 ]];\n  (( 1 == 1 ))\n  ! false\n  ! grep -q x file 2>&1\n  ! producer | consumer\n  ! backgrounded &\n}\n' \
    > "$dir/violations.bats"

  run scan_suites "$BARE_TEST" "$dir"
  [ "$status" -eq 0 ]
  assert_contains "$output" "violations.bats:2"
  assert_contains "$output" "violations.bats:3"
  assert_contains "$output" "violations.bats:4"
  refute_contains "$output" "pad0.bats"

  run scan_suites "$BARE_ARITH" "$dir"
  [ "$status" -eq 0 ]
  assert_contains "$output" "violations.bats:5"

  run scan_suites "$LEADING_BANG" "$dir"
  [ "$status" -eq 0 ]
  assert_contains "$output" "violations.bats:6"
  # A redirection, a pipeline, and a backgrounded command are not branches:
  # none of them consumes the negated status, so all three stay inert.
  assert_contains "$output" "violations.bats:7"
  assert_contains "$output" "violations.bats:8"
  assert_contains "$output" "violations.bats:9"
}

@test "the scan fails instead of passing when it reaches too few files" {
  local dir="$BATS_TEST_TMPDIR/empty"
  mkdir -p "$dir"
  git -C "$dir" init -q
  run scan_suites "$BARE_TEST" "$dir"
  [ "$status" -eq 2 ]
  assert_contains "$output" "scan reached only 0 files"
}

# The untracked half of enumeration walks the worktree, so it can be
# truncated exactly the way find could. Fixtures are unstaged, so this plants
# the violation on the live path.
# chmod cannot stop root, so this and the stale-entry control fail loudly
# rather than vacuously if the suite is ever run in a root container.
@test "the scan fails instead of passing when the worktree walk is truncated" {
  local dir="$BATS_TEST_TMPDIR/truncated"
  plant_fixture "$dir"
  mkdir -p "$dir/deep"
  printf '@test "hidden" {\n  [[ 1 = 1 ]]\n}\n' > "$dir/deep/hidden.bats"
  chmod 000 "$dir/deep"
  run scan_suites "$BARE_TEST" "$dir"
  chmod 755 "$dir/deep"
  [ "$status" -eq 2 ]
  assert_contains "$output" "incomplete"
}

@test "the scan fails instead of passing on an index entry that is not on disk" {
  local dir="$BATS_TEST_TMPDIR/stale"
  plant_fixture "$dir"
  git -C "$dir" add -A
  mv "$dir/pad3.bats" "$dir/renamed.bats"
  run scan_suites "$BARE_TEST" "$dir"
  [ "$status" -eq 2 ]
  assert_contains "$output" "does not exist"
}

# A count cannot see one directory dropping out — a broadened .gitignore or a
# global excludesFile would silently remove a whole suite root.
@test "enumeration reaches every directory that holds suites" {
  run git -C "$REPO_ROOT" ls-files --cached --others --exclude-standard \
    -- '*.bats' '*.bash'
  [ "$status" -eq 0 ]
  assert_contains "$output" "tests/bats-assertion-idioms.bats"
  assert_contains "$output" "plugins/review-cycle/tests/helpers.bash"
  assert_contains "$output" ".claude/hooks/version-bump-gate.bats"
}

@test "the scan fails instead of passing when enumeration is impossible" {
  local dir="$BATS_TEST_TMPDIR/notarepo"
  mkdir -p "$dir"
  run scan_suites "$BARE_TEST" "$dir"
  [ "$status" -eq 2 ]
  assert_contains "$output" "could not enumerate"
}

@test "the scan fails instead of passing when grep itself errors" {
  run scan_suites '[[:bogus:]' "$REPO_ROOT"
  [ "$status" -eq 2 ]
  assert_contains "$output" "grep failed"
}

# grep dying by signal exits 137 and writes nothing to stderr — bash reports
# the kill on the script's own stderr. Without the status check this scan
# returns clean over a planted violation.
@test "the scan fails instead of passing when grep dies without writing stderr" {
  local dir="$BATS_TEST_TMPDIR/killed" shim="$BATS_TEST_TMPDIR/shim"
  plant_fixture "$dir"
  printf '@test "planted" {\n  [[ 1 = 1 ]]\n}\n' > "$dir/violations.bats"
  mkdir -p "$shim"
  printf '#!/bin/sh\nkill -9 $$\n' > "$shim/grep"
  chmod +x "$shim/grep"
  PATH="$shim:$PATH" run scan_suites "$BARE_TEST" "$dir"
  [ "$status" -eq 2 ]
  assert_contains "$output" "grep failed"
}

# A newline in a filename splits line-oriented enumeration into fragments; if
# a fragment happens to name a readable file, the real one goes unscanned.
# Under a UTF-8 locale, grep treats a file with an invalid byte as binary and
# reports no match — exit 1, no error, indistinguishable from clean.
@test "a non-UTF-8 byte on a violating line does not hide it" {
  local dir="$BATS_TEST_TMPDIR/latin1"
  plant_fixture "$dir"
  printf '@test "planted" {\n  [[ 1 = 1 ]] # caf\xe9\n}\n' > "$dir/latin1.bats"
  run scan_suites "$BARE_TEST" "$dir"
  [ "$status" -eq 0 ]
  assert_contains "$output" "latin1.bats:2"
}

@test "the scan reads a filename containing a newline as one file" {
  local dir="$BATS_TEST_TMPDIR/weird"
  plant_fixture "$dir"
  local weird="$dir/two"$'\n'"line.bats"
  printf '@test "hidden" {\n  [[ 1 = 1 ]]\n}\n' > "$weird"
  run scan_suites "$BARE_TEST" "$dir"
  [ "$status" -eq 0 ]
  assert_contains "$output" "line.bats:2"
}

# The wrapper's broken-scan branch is the one line that turns "the scan
# failed" into a failing test rather than a misleading style complaint.
@test "a broken scan fails the wrapper with the right explanation" {
  REPO_ROOT="$BATS_TEST_TMPDIR/nonrepo"
  mkdir -p "$REPO_ROOT"
  run assert_scan_clean 'style label' "$BARE_TEST"
  [ "$status" -eq 1 ]
  assert_contains "$output" "scan did not run"
  refute_contains "$output" "style label"
}

@test "live code is not flagged by any of the patterns" {
  local dir="$BATS_TEST_TMPDIR/legal"
  plant_fixture "$dir"
  {
    printf 'f() {\n'
    printf '  [[ "$1" == *"$2"* ]] && return 0\n'
    printf '  if [[ -n "$1" ]]; then return 1; fi\n'
    printf '  [[ "$1" =~ $2 ]] || rc=$?\n'
    printf '  n=$((n + 1))\n'
    printf '}\n'
  } > "$dir/lib.bash"

  local p
  for p in "$BARE_TEST" "$BARE_ARITH" "$LEADING_BANG"; do
    run scan_suites "$p" "$dir"
    [ "$status" -eq 0 ]
    [ -z "$output" ]
  done
}
