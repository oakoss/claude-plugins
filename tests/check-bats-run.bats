#!/usr/bin/env bats
# bin/check-bats-run decides whether a bin/run-bats stream can be believed, and
# on a green run every one of its checks executes its false arm. Until this
# file existed the logic lived inline in a workflow `run:` block, where no test
# could reach it: no bats cell sees a workflow, and linting a `run:` block
# checks its shell syntax, not what it decides.
#
# Every cell was written against a mutation that survived without it. The
# fixtures come from a differential harness that ran HEAD's step and this
# script against the same 50 streams in matched fixtures, comparing exit codes
# and annotation sets: 49 of 50 identical, plus one declared rename -- the
# file-count message names the caller where the inline step said "this step".
# Step against step, not step against script: the step maps this script's
# fault status back to 1, so matching exit codes there say nothing about the
# status a caller should key on.
#
# The one divergence is a fix, not a restructuring. HEAD keeps the FIRST
# `bin/run-bats: N files` line it sees, and the genuine one is the LAST line
# matching that shape, so a forged line ahead of it wins. Measured against
# HEAD: a run that covered 1 file where the caller found 2, forging `2 files`,
# exits 0 with no annotation -- a lost suite reported as a pass. That is live
# on main today.
#
# Six surviving mutants are left alive on purpose, because each is equivalent
# or unreachable rather than uncovered:
#
#   - dropping LC_ALL=C changes suite-name ordering from byte order to locale
#     order, and every `.bats` path here is lowercase, where the two agree
#   - `numcmp` forcing its arguments to strings has no reachable caller: the
#     one call site already passes a `substr` result and a concatenation, so
#     the forcing defends a future caller rather than this one
#   - relaxing the plan rule's first-wins guard is unobservable, because
#     `planned` is read only inside the arm that requires exactly one plan
#   - running the suite sort unconditionally is a performance change only; its
#     result is read only when a test failed
#   - loosening the dispatch's `END)` arm to `END*)` matches nothing more: awk
#     prints four line shapes, and every value interpolated into an annotation
#     comes from one input record, so none can carry a newline
#   - dropping `pipefail` is unobservable; the only pipeline in the script is
#     the `tr` whose status is never read

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  # shellcheck source=/dev/null
  source "$REPO_ROOT/plugins/review-cycle/tests/helpers.bash"
  CHECK="$REPO_ROOT/bin/check-bats-run"
}

# Feeds a stream to the script: $1 is the file count the caller's own `find`
# produced, $2 is the stream.
check() {
  local expected="$1" stream="$2"
  printf '%s\n' "$stream" | "$CHECK" "$expected"
}

# Replaces `awk` for one cell by prepending a directory to PATH -- the script
# calls it by bare name, and prepending leaves `tr` and the rest reachable.
# The four branches that read the verdict stream fire only when `awk` itself
# misbehaves, which no TAP input can arrange.
stub_awk() {
  local dir="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$dir"
  printf '#!/bin/sh\n%s\n' "$1" > "$dir/awk"
  chmod 755 "$dir/awk"
  PATH="$dir:$PATH"
}

@test "a consistent stream is a quiet pass" {
  run check 3 "$(printf '1..3\nok 1 a\nok 2 b\nok 3 c\nbin/run-bats: 3 files\n')"
  [ "$status" -eq 0 ]
  refute_contains "$output" "::error::"
  assert_contains "$output" "3 tests reported from 3 files"
}

@test "a failing test is counted and its suite named" {
  run check 1 "$(printf '1..2\nok 1 a\nnot ok 2 b\n# (in test file tests/beta.bats, line 4)\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "1 failing test(s) in: tests/beta.bats"
  # The comma is stripped, not merely skipped: `assert_contains` alone cannot
  # tell `tests/beta.bats` from `tests/beta.bats,`.
  refute_contains "$output" "beta.bats,"
  # And nothing else is reported. A mutation that adds a false annotation to an
  # already-failing stream is invisible to `assert_contains`.
  [ "$(printf '%s\n' "$output" | grep -c '^::error::')" -eq 1 ]
}

# bats names the helper first when a failure comes from one; both shapes end in
# `in test file X, line N`, so one pattern reaches both.
@test "a helper failure names the test file, not the helper" {
  run check 1 "$(printf '1..1\nnot ok 1 a\n# (from function `boom%s in file tests/helpers.bash, line 1,\n#  in test file tests/alpha.bats, line 2)\nbin/run-bats: 1 files\n' "'")"
  [ "$status" -eq 3 ]
  assert_contains "$output" "in: tests/alpha.bats"
  refute_contains "$output" "helpers.bash"
}

# The guard tests the whole line while a greedy sub() would anchor on the LAST
# occurrence, which may carry no comma -- then the comma strip does nothing and
# the rest of the line enters the annotation. Reachable from an ordinary test
# name, because bats echoes the name into the result line.
@test "a test name mentioning the phrase does not hijack the attribution" {
  run check 1 "$(printf '1..1\nnot ok 1 name says in test file q.bats, line 1 and also in test file r.bats\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "in: q.bats"
  refute_contains "$output" "r.bats"
}

# A space in the path is what separates the comma guard from a cheaper one
# that stops at whitespace: both extract the same name from every path in this
# repo, and only this shape tells them apart.
@test "a path containing a space is extracted whole" {
  run check 1 "$(printf '1..1\nnot ok 1 t\n# (in test file my file.bats, line 3)\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "in: my file.bats"
}

@test "a diagnostic with no comma is not read as an attribution" {
  run check 1 "$(printf '1..1\nnot ok 1 a\n# in test file tests/foo.bats\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "in: file not named"
}

@test "one suite named twice is listed once" {
  run check 1 "$(printf '1..2\nnot ok 1 a\n# (in test file tests/z.bats, line 1)\nnot ok 2 b\n# (in test file tests/z.bats, line 5)\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "in: tests/z.bats"
  refute_contains "$output" "tests/z.bats tests/z.bats"
}

@test "a short run is truncation and a long one is not" {
  run check 1 "$(printf '1..5\nok 1 a\nok 2 b\nok 3 c\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "truncated: planned 5, reported 3"

  # bats emits results past its own plan when setup_file or teardown_file
  # fails, so calling that truncation sends a reader hunting for tests that
  # were never lost.
  run check 1 "$(printf '1..3\nok 1 a\nok 2 b\nok 3 c\nnot ok 4 teardown_file failed\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "plan says 3 but 4 results were reported"
  refute_contains "$output" "truncated"
}

# The plan is compared as digits, not through a shell integer: `planned + 0`
# loses precision past 2^53, and a field-sourced value compares as a double and
# ties. Zero padding is stripped, and a plan too wide to be a number says so.
@test "plan comparison is exact across widths and padding" {
  run check 1 "$(printf '1..000000000000000001\nok 1 a\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 0 ]

  run check 1 "$(printf '1..10\nok 1 a\nok 2 b\nok 3 c\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "truncated: planned 10, reported 3"

  run check 1 "$(printf '1..1234567890123456789\nok 1 a\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "not a usable number"
}

@test "results out of sequence are reported, and a failing test is not" {
  run check 1 "$(printf '1..3\nok 1 a\nok 2 b\nok 2 c\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "not numbered contiguously"

  # `ok 2x` is not the number 2. Coercing it numerically would let it through,
  # and a digit-prefixed ordinal arrives only through output a suite forged
  # onto bats fd 3.
  run check 1 "$(printf '1..3\nok 1 a\nok 2x b\nok 3 c\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "not numbered contiguously"

  # Every test failing is not a numbering fault.
  run check 1 "$(printf '1..2\nnot ok 1 a\nnot ok 2 b\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  refute_contains "$output" "contiguously"
}

# The `not ok` rule carries its own ordinal check, on field 3 rather than field
# 2, and its own anchor. Both were unreachable while every failing fixture
# happened to be numbered correctly.
@test "a misnumbered failing result is reported" {
  run check 1 "$(printf '1..2\nnot ok 1 a\nnot ok 3 b\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "not numbered contiguously"
}

# Unanchored, this rule reads an ordinary diagnostic as a result and fails a
# green run: a plan mismatch, a phantom failure, and a numbering fault, none of
# them real.
@test "a diagnostic mentioning a result is not a result" {
  run check 1 "$(printf '1..1\nok 1 a\n# hint: the failure looked like not ok 1 foo\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 0 ]
  refute_contains "$output" "::error::"
}

# bats writes this on stdout when it executed a different number of tests than
# it planned. The rule that catches it must sit above every rule ending in
# `next`, or a line consumed by one of those never reaches it -- which made the
# check silently stop firing once.
@test "the short-execution warning is caught even riding a result line" {
  run check 1 "$(printf '1..2\nok 1 a\nok 2 t bats warning: Executed 1 instead of expected 2 tests\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "different number of tests than it planned"
}

@test "a stream with no results at all is a fault, not a vacuous pass" {
  run check 0 "$(printf '1..0\nbin/run-bats: 0 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "no test results in the output"

  run check 1 "$(printf 'bin/run-bats: no plan line\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "expected one TAP plan, found 0"
}

# A second plan means results belonging to a plan nothing compared them
# against, and the first is the authoritative one.
@test "more than one plan line is a fault" {
  run check 1 "$(printf '1..9\nok 1 a\nok 2 b\nok 3 c\n1..3\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "expected one TAP plan, found 2"
}

# The discovery cross-check: a suite the wrapper never looks for is silent, and
# every count downstream of it stays consistent, so the only way to notice is
# an independent count from the caller.
@test "the file count is compared against the caller's own" {
  run check 5 "$(printf '1..1\nok 1 a\nbin/run-bats: 2 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "the run covered 2 files, the caller found 5"
  # The summary reports the caller's count, not the wrapper's -- reporting the
  # wrapper's would agree with the thing it exists to be independent of.
  assert_contains "$output" "1 tests reported from 5 files"

  run check 2 "$(printf '1..1\nok 1 a\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "<no count reported>"

  # The anchor matters: a line that merely begins that way is not the count.
  run check 2 "$(printf '1..1\nok 1 a\nbin/run-bats: 2 files in test file tests/x.bats, line 1\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "<no count reported>"
}

# The plan rule is anchored at both ends: a line that merely begins `1..N` is
# not a plan, and reading one as a plan would compare a count against a number
# that was never the plan.
@test "a plan line with trailing text is not a plan" {
  run check 1 "$(printf '1..3 \nok 1 a\nok 2 b\nok 3 c\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "expected one TAP plan, found 0"
}

# The wrapper emits this line shape once and prints nothing matching it
# afterwards, so the last match is the genuine count. Not the last line of the
# stream: on the single-file branch it is emitted before the plan checks, and
# an empty suite puts it at line 2 of 3. Anything matching earlier was forged,
# so taking the first hands the cross-check to the forgery every time.
@test "the last file count wins, and a second one is itself a fault" {
  run check 3 "$(printf '1..1\nbin/run-bats: 9 files\nok 1 a\nbin/run-bats: 3 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "carries 2 file-count lines"
  # 3 is the genuine count and matches the caller, so no mismatch is reported.
  refute_contains "$output" "the run covered"
}

# The wrapper prints its own follow-up messages after the count, and one of
# them carries a number in the same position: `bin/run-bats: N files
# contributed zero tests` (bin/run-bats:350). Under last-wins the anchor is
# what stops it displacing the genuine count.
@test "a later wrapper message carrying a number is not the count" {
  run check 1 "$(printf '1..1\nok 1 a\nbin/run-bats: 1 files\nbin/run-bats: 9 files contributed zero tests\n')"
  [ "$status" -eq 0 ]
}

# The swallow this rule exists to stop: a test forges the count the caller
# expects, the wrapper really covered fewer files, and the gate passes clean on
# a run that lost a whole suite. A test reaches this by writing the wrapper's
# line shape to bats fd 3, which the wrapper forwards unprefixed and ahead of
# its own count.
@test "a forged count matching the caller does not hide a lost suite" {
  run check 2 "$(printf '1..2\nbin/run-bats: 2 files\nok 1 a\nok 2 b\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "the run covered 1 files, the caller found 2"
}

# bats writes `ERROR: Found no tests.` with no trailing newline, so the `1..0`
# that follows never starts a line. Without the leading anchor the plan rule
# matches it mid-line and names the wrong fault, leaking the whole line into
# the annotation. Both versions exit 3, so only the annotation tells them
# apart -- which is this layer's entire job.
@test "a plan that does not start its line is not a plan" {
  run check 1 "$(printf 'ERROR: Found no tests. (Try `--allow-empty-suite`?)1..0\nbin/run-bats: 1 files\nbin/run-bats: bats found no tests in /x/empty.bats\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "expected one TAP plan, found 0"
  refute_contains "$output" "not a usable number"
}

@test "TAP directives and diagnostics are not mistaken for results" {
  run check 1 "$(printf '1..3\nok 1 a\nok 2 s # skip why\nok 3 b # TODO later\n# ok so far\nbin/run-bats: 1 files\n')"
  [ "$status" -eq 0 ]
  assert_contains "$output" "3 tests reported"
}

# Nothing else ties the script to its caller: delete the script and every cell
# here still passes while CI goes red with no explanation, because the suite
# tests the script and the workflow is out of its reach.
@test "the workflow invokes this script, and it is executable" {
  [ -x "$CHECK" ]
  run grep -c 'bin/check-bats-run "\$expected_files"' "$REPO_ROOT/.github/workflows/ci.yml"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]

  # Extensionless, so the ShellCheck job reaches it only by being named.
  run grep -c 'files+=(.*bin/check-bats-run' "$REPO_ROOT/.github/workflows/ci.yml"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]

  # The count must come from the caller's own walk. Derived from the wrapper's
  # output instead, the cross-check compares the run against itself, every
  # cell here still passes, and a lost suite goes green.
  run grep -c 'found="\$(find' "$REPO_ROOT/.github/workflows/ci.yml"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# Each of the next four holds a branch that only a misbehaving `awk` reaches.
# Without them the whole verdict-stream contract can be reverted in silence:
# a mutation returning these paths to `exit 1` survived the rest of this file.

@test "a verdict stream cut short is not a pass" {
  stub_awk 'printf "COUNT 3\nFILES 3\n"'
  run check 3 "$(printf '1..3\nok 1 a\nok 2 b\nok 3 c\n')"
  [ "$status" -eq 3 ]
  # One line: a GitHub annotation that carries a newline is truncated at it,
  # so the verdict text has to arrive flattened.
  assert_contains "$output" "awk said: COUNT 3 FILES 3"
}

@test "a count the verdict pass did not produce as digits is a fault" {
  stub_awk 'printf "COUNT x\nFILES 3\nEND\n"'
  run check 3 "$(printf '1..3\nok 1 a\nok 2 b\nok 3 c\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "count that is not a number"
}

@test "the verdict pass failing is a fault even when it printed a verdict" {
  stub_awk 'printf "COUNT 3\nFILES 3\nEND\n"; exit 1'
  run check 3 "$(printf '1..3\nok 1 a\nok 2 b\nok 3 c\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "the verdict pass exited 1"
}

@test "an empty verdict is not reported as an unexpected line" {
  stub_awk 'exit 1'
  run check 1 "$(printf '1..1\nok 1 a\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "the verdict pass exited 1"
  refute_contains "$output" "unexpected line from the verdict pass"
}

@test "a line the dispatch does not recognise is annotated, not ignored" {
  stub_awk 'printf "COUNT 3\nFILES 3\nsurprise\nEND\n"'
  run check 3 "$(printf '1..3\nok 1 a\nok 2 b\nok 3 c\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "unexpected line from the verdict pass: surprise"
}

@test "a verdict carrying no file count fails the discovery cross-check" {
  stub_awk 'printf "COUNT 3\nEND\n"'
  run check 3 "$(printf '1..3\nok 1 a\nok 2 b\nok 3 c\n')"
  [ "$status" -eq 3 ]
  assert_contains "$output" "<no count reported>"
}

# The caller has to tell "the stream is bad" from "the gate never ran", and it
# has only the exit status to do it with. This measures the statuses a
# failure-to-run actually produces here rather than assuming which ones they
# are. The numbers move with errexit: a missing or non-executable path is 1
# under `bash -e` and 127 or 126 without it. A bad interpreter is 126 either
# way, which is why the loop asserts `!= verdict` rather than any number.
@test "the fault status is one no failure-to-run produces" {
  run check 1 "$(printf '1..2\nok 1 a\nbin/run-bats: 1 files\n')"
  local verdict="$status"
  [ "$verdict" -eq 3 ]

  local noexec="$BATS_TEST_TMPDIR/noexec" badinterp="$BATS_TEST_TMPDIR/badinterp"
  : > "$noexec"
  chmod 644 "$noexec"
  printf '#!/nonexistent/interp\n' > "$badinterp"
  chmod 755 "$badinterp"

  local rc
  for cmd in "$BATS_TEST_TMPDIR/missing" "$noexec" "$badinterp"; do
    rc=0
    printf 'x\n' | "$cmd" 1 2>/dev/null || rc=$?
    [ "$rc" -ne 0 ]
    [ "$rc" -ne "$verdict" ]
  done
}

# The two numbers are declared in different files, so nothing but this cell
# stops the workflow from keying on a status the script stopped returning --
# which reads as a clean run, not as a broken one.
@test "the workflow keys its dispatch on this script's fault status" {
  run check 1 "$(printf '1..2\nok 1 a\nbin/run-bats: 1 files\n')"
  local verdict="$status"
  [ "$verdict" -eq 3 ]

  run grep -c "gate_rc\" -eq $verdict " "$REPO_ROOT/.github/workflows/ci.yml"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# `-` is what the script prints when a stream carries no count. Accepting it as
# the expected count would make the two compare equal and pass the discovery
# cross-check on a stream that never reported one.
@test "the expected count must be digits" {
  run "$CHECK" -
  [ "$status" -eq 2 ]
  assert_contains "$output" "expected a count in digits"

  run "$CHECK" ""
  [ "$status" -eq 2 ]
}

@test "a wrong argument count is refused rather than assumed" {
  run "$CHECK"
  [ "$status" -eq 2 ]
  assert_contains "$output" "usage"

  run "$CHECK" 1 2
  [ "$status" -eq 2 ]
}
