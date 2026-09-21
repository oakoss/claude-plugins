#!/usr/bin/env bats

# `run --separate-stderr`, in the cells that assert on stderr.
bats_require_minimum_version 1.5.0
# bin/run-bats is the wrapper every other suite's results pass through, and
# until this file existed nothing exercised it -- most mutations to the merge
# produce byte-identical output. Every cell here was written against a mutation
# that survived without it.
#
# Most cells drive a fake `bats` on PATH replaying canned TAP, so they cost
# milliseconds. The cells that need it use real bats: process reaping, empty
# suites, the fd 3 race and parity with a direct run are not things a fake
# stands in for.
#
# Three guards in the wrapper stay unpinned, and say so rather than being
# quietly assumed. The merged-vs-reported count: correct code keeps it equal,
# and the truncation that once broke it is prevented upstream by LC_ALL=C. The
# tree walk in kill_tree: on bats 1.14.0 here it reaps nothing that `wait` does
# not already reap -- a review leg measured it load-bearing 3/3 against a
# hanging teardown_file, two attempts to reproduce that on this machine found
# zero orphans either way, so the code keeps the walk and this file does not
# claim to prove it. And the `| sort` on both discovery finds, which buys
# numbering that reproduces across machines rather than correctness: pinning it
# needs an order-dependent assertion, and `sort` treats a leading dot by
# locale, so such a cell would fail over collation and read as a discovery
# defect. The cells below assert membership and count instead.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  # shellcheck source=/dev/null
  source "$REPO_ROOT/plugins/review-cycle/tests/helpers.bash"
  RUN_BATS="$REPO_ROOT/bin/run-bats"
  FAKE_DIR="$BATS_TEST_TMPDIR/fake"
  FX="$BATS_TEST_TMPDIR/fx"
  mkdir -p "$FAKE_DIR" "$FX"
}

# Canned TAP is the only way to inject the malformed shapes the guards exist
# for; bats itself will not emit them. It honours --allow-empty-suite, because
# a cell claiming that flag matters has to fail when it is removed.
fake_bats() {
  {
    printf '#!/usr/bin/env bash\n'
    printf 'for a in "$@"; do last="$a"; done\n'
    printf 'tap="${last%%.bats}.tap"\n'
    printf 'if grep -q "^1\\.\\.0$" "$tap" 2>/dev/null; then\n'
    printf '  case " $* " in\n'
    printf '    *" --allow-empty-suite "*) cat "$tap"; exit 0 ;;\n'
    printf '    *) printf "ERROR: Found no tests."; cat "$tap"; exit 1 ;;\n'
    printf '  esac\n'
    printf 'fi\n'
    printf 'cat "$tap"\n'
  } > "$FAKE_DIR/bats"
  chmod +x "$FAKE_DIR/bats"
}

# The same, plus a record of how many copies were running at once -- the only
# way to see concurrency, which output shape is identical across.
fake_bats_counting() {
  fake_bats
  {
    printf '#!/usr/bin/env bash\n'
    printf 'echo running >> "%s/concurrent"\n' "$FAKE_DIR"
    printf 'n=$(wc -l < "%s/concurrent" | tr -d " ")\n' "$FAKE_DIR"
    printf 'peak=$(cat "%s/peak" 2>/dev/null || echo 0)\n' "$FAKE_DIR"
    printf 'if [ "$n" -gt "$peak" ]; then echo "$n" > "%s/peak"; fi\n' "$FAKE_DIR"
    printf 'sleep 0.3\n'
    printf 'for a in "$@"; do last="$a"; done\n'
    printf 'cat "${last%%.bats}.tap"\n'
    printf 'sed -e "$ d" "%s/concurrent" > "%s/c2" && mv "%s/c2" "%s/concurrent"\n' \
      "$FAKE_DIR" "$FAKE_DIR" "$FAKE_DIR" "$FAKE_DIR"
  } > "$FAKE_DIR/bats"
  chmod +x "$FAKE_DIR/bats"
  : > "$FAKE_DIR/concurrent"
  echo 0 > "$FAKE_DIR/peak"
}

canned() {
  : > "$FX/$1.bats"
  cat > "$FX/$1.tap"
}

run_wrapper() {
  PATH="$FAKE_DIR:$PATH" run "$RUN_BATS" "$@"
}

@test "merged results are one contiguous sequence across files" {
  # Without a per-file offset every file's results restart at 1.
  fake_bats
  canned a <<'EOF'
1..2
ok 1 a one
ok 2 a two
EOF
  canned b <<'EOF'
1..2
ok 1 b one
ok 2 b two
EOF
  run_wrapper "$FX/a.bats" "$FX/b.bats"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "1..4" ]
  [ "${lines[3]}" = "ok 3 b one" ]
  [ "${lines[4]}" = "ok 4 b two" ]
}

@test "a line that counts but cannot be renumbered is reported" {
  # Reaches the numbering check specifically: the count matches the plan, so
  # neither the shortfall nor the plan check notices, but `ok leaked` carries
  # no number to renumber and the sequence skips a position.
  fake_bats
  canned leak <<'EOF'
1..3
ok 1 leak one
ok leaked
ok 2 leak two
EOF
  run_wrapper "$FX/leak.bats" "$FX/leak.bats"
  [ "$status" -eq 2 ]
  assert_contains "$output" "not numbered"
}

@test "a stray byte does not truncate the merge" {
  # The merge reads every file through awk, and BWK awk aborts mid-stream on
  # invalid UTF-8 unless the locale is C, dropping every later file's lines.
  fake_bats
  : > "$FX/junk.bats"
  printf '1..2\nok 1 junk one\nnot ok 2 junk \xff\xfe two\n' > "$FX/junk.tap"
  canned after <<'EOF'
1..2
ok 1 after one
ok 2 after two
EOF
  run_wrapper "$FX/junk.bats" "$FX/after.bats"
  [ "$status" -eq 1 ]
  [ "${lines[0]}" = "1..4" ]
  assert_contains "$output" "after two"
}

@test "a count that is not a number never reaches a comparison" {
  # Without -a, BSD grep answers "Binary file ... matches" instead of a count
  # when the stream carries a NUL, and the arithmetic then fails open.
  fake_bats
  : > "$FX/nul.bats"
  printf '1..2\nok 1 nul one\nok 2 nul \000 two\n' > "$FX/nul.tap"
  run_wrapper "$FX/nul.bats"
  refute_contains "$output" "integer expression expected"
  refute_contains "$output" "unbound variable"
}

@test "results past the plan are reported on the single-file path" {
  # Leaving this check to the merge gave one input two verdicts depending on
  # how the wrapper happened to be invoked.
  fake_bats
  canned over <<'EOF'
1..1
ok 1 over one
ok 2 over surplus
EOF
  run_wrapper "$FX/over.bats"
  [ "$status" -eq 2 ]
  assert_contains "$output" "plan says"
}

@test "results past the plan are reported on the merged path too" {
  # The two paths carry separate checks, so covering one leaves the other free
  # to be deleted -- which is how the single-file path came to be missing it.
  fake_bats
  canned over2 <<'EOF'
1..1
ok 1 over one
ok 2 over surplus
EOF
  run_wrapper "$FX/over2.bats" "$FX/over2.bats"
  [ "$status" -eq 2 ]
  assert_contains "$output" "plan says"
}

# Copies the real wrapper in, so the cells below exercise the real discovery
# rather than a stub.
plant_discovery_root() {
  local f
  DISC_ROOT="$BATS_TEST_TMPDIR/root"
  mkdir -p "$DISC_ROOT/bin" "$DISC_ROOT/tests" "$DISC_ROOT/.claude/hooks" \
           "$DISC_ROOT/plugins/p/tests" "$DISC_ROOT/plugins/p/hooks/tests" \
           "$DISC_ROOT/plugins/p/node_modules" "$DISC_ROOT/node_modules/dep" \
           "$DISC_ROOT/.git/hooks"
  cp "$RUN_BATS" "$DISC_ROOT/bin/run-bats"
  # .claude/hooks is the shape that matters most: `.git` is excluded by name,
  # not because it is hidden, and this repo keeps a 43-test release-gate suite
  # under an ordinary dot-directory. hooksuite sits a level deeper than
  # anything real, so matching it proves the walk is not depth-limited.
  # plugins/p/node_modules is the nested copy an exclusion anchored to the
  # root would leak.
  for f in tests/shallow .claude/hooks/dotdir plugins/p/tests/plugsuite \
           plugins/p/hooks/tests/hooksuite plugins/p/node_modules/nested \
           node_modules/dep/vendored .git/hooks/gitdir; do
    : > "$DISC_ROOT/$f.bats"
    printf '1..1\nok 1 %s\n' "${f##*/}" > "$DISC_ROOT/$f.tap"
  done
  # Not a suite. Pins `-name '*.bats'` against a widened `*.bats*`, which would
  # sweep up editor backups and merge leftovers.
  : > "$DISC_ROOT/tests/stale.bats.orig"
}

# Every other cell names the files it runs, so nothing else pins discovery --
# and a bare run is what CI and most developers invoke. A `find` that quietly
# stopped matching a directory would look like a repo with fewer tests in it.
@test "whole-repo discovery takes every .bats file, minus node_modules and .git" {
  plant_discovery_root
  fake_bats
  PATH="$FAKE_DIR:$PATH" run --separate-stderr "$DISC_ROOT/bin/run-bats"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "1..4" ]
  assert_contains "$output" "dotdir"
  assert_contains "$output" "hooksuite"
  assert_contains "$output" "plugsuite"
  assert_contains "$output" "shallow"
  refute_contains "$output" "vendored"
  refute_contains "$output" "nested"
  refute_contains "$output" "gitdir"
  refute_contains "$output" "stale"
  # CI parses this line, so its exact text is the contract -- and it belongs on
  # stderr, where it cannot be read as a TAP result.
  [ "$stderr" = "bin/run-bats: 4 files" ]
  refute_contains "$output" "4 files"
}

# `bin/run-bats plugins/review-cycle/tests/` is the invocation AGENTS.md
# documents, and it runs a second `find` carrying its own copy of the
# exclusions. Replacing that one with `true` leaves the documented command
# exiting 2 while every other cell here still passes.
@test "a directory target expands with the same exclusions" {
  plant_discovery_root
  fake_bats
  PATH="$FAKE_DIR:$PATH" run --separate-stderr \
    "$DISC_ROOT/bin/run-bats" "$DISC_ROOT/plugins"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "1..2" ]
  assert_contains "$output" "hooksuite"
  assert_contains "$output" "plugsuite"
  refute_contains "$output" "nested"
  refute_contains "$output" "shallow"
  [ "$stderr" = "bin/run-bats: 2 files" ]
}

@test "a path that does not exist is named, not swept into a whole-repo run" {
  # An unknown argument used to fall through to auto-discovery, so a typo
  # beside a real suite ran neither and reported exit 1.
  : > "$FX/real.bats"
  run "$RUN_BATS" "$FX/real.bats" definitely-not-here
  [ "$status" -eq 2 ]
  assert_contains "$output" "no such file"
  refute_contains "$output" "1.."
}

@test "a flag's value is never mistaken for a target" {
  # `-f tests` is a filter, not the tests directory; reading it as one leaves
  # the flag dangling and bats consumes the real path as its regex.
  fake_bats
  canned t1 <<'EOF'
1..1
ok 1 t one
EOF
  run_wrapper -f tests "$FX/t1.bats"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "1..1" ]

  run "$RUN_BATS" -f
  [ "$status" -eq 2 ]
  assert_contains "$output" "needs a value"
}

@test "a flag that replaces the TAP output is refused, not misdiagnosed" {
  # These make bats emit no plan, which the wrapper would otherwise report as
  # lost results for a run in which nothing was lost.
  : > "$FX/real.bats"
  run "$RUN_BATS" -p "$FX/real.bats"
  [ "$status" -eq 2 ]
  assert_contains "$output" "replaces the TAP output"
}

@test "missing results outrank a failing test, and are always named" {
  # Exit 2 outranks exit 1: a run that lost results answers nothing, whether
  # or not something also failed.
  fake_bats
  canned bad <<'EOF'
1..2
ok 1 bad one
not ok 2 bad two
EOF
  canned short <<'EOF'
1..3
ok 1 short one
EOF
  run_wrapper "$FX/bad.bats" "$FX/short.bats"
  [ "$status" -eq 2 ]
  assert_contains "$output" "results are missing"
  assert_contains "$output" "short.bats"
}

@test "a failing test in a later file keeps its renumbered position" {
  # Exit 1 is a complete answer; exit 2 is no answer at all. The failure sits
  # in the second file so the not-ok renumbering has to be right too.
  fake_bats
  canned first <<'EOF'
1..2
ok 1 first one
ok 2 first two
EOF
  canned second <<'EOF'
1..1
not ok 1 second fails
EOF
  run_wrapper "$FX/first.bats" "$FX/second.bats"
  [ "$status" -eq 1 ]
  [ "${lines[0]}" = "1..3" ]
  assert_contains "$output" "not ok 3 second fails"
}

@test "RUN_BATS_JOBS=1 serialises, and a bad value is refused" {
  # An escape hatch that silently does the opposite is worse than none, so
  # concurrency is observed rather than inferred from output shape.
  local i v
  fake_bats_counting
  for i in 1 2 3 4; do
    canned "j$i" <<EOF
1..1
ok 1 j$i
EOF
  done
  RUN_BATS_JOBS=1 run_wrapper "$FX/j1.bats" "$FX/j2.bats" "$FX/j3.bats" "$FX/j4.bats"
  [ "$status" -eq 0 ]
  [ "$(cat "$FAKE_DIR/peak")" = "1" ]

  fake_bats_counting
  run_wrapper "$FX/j1.bats" "$FX/j2.bats" "$FX/j3.bats" "$FX/j4.bats"
  [ "$status" -eq 0 ]
  [ "$(cat "$FAKE_DIR/peak")" -gt 1 ]

  for v in 0 00 nonsense; do
    RUN_BATS_JOBS="$v" run_wrapper "$FX/j1.bats" "$FX/j2.bats"
    [ "$status" -eq 2 ]
    assert_contains "$output" "positive integer"
  done
}

@test "per-file --allow-empty-suite is what lets a partial filter through" {
  # Without the flag bats errors on the file the filter misses, and the run
  # reads as lost results rather than as zero tests there.
  fake_bats
  canned hit <<'EOF'
1..1
ok 1 hit one
EOF
  canned miss <<'EOF'
1..0
EOF
  run_wrapper -f hit "$FX/hit.bats" "$FX/miss.bats"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "1..1" ]
}

# Anything a suite writes to bats's fd 3 -- its documented progress channel --
# arrives in the TAP stream unprefixed, and the stall watchdog counts those
# lines to decide bats has finished. Measured against real bats 1.14.0: a
# setup_file writing `ok 99 phantom` to fd 3 made a three-test file report four
# results, SIGKILLed the last test before it ran, and exited 0 with the count
# agreeing with the plan. The ordinals are the only surviving evidence, and the
# merge renumbers them away.
@test "a suite's own TAP-shaped output is not counted as a result" {
  fake_bats
  canned phantom <<'EOF'
1..3
ok 99 phantom
ok 1 real one
ok 2 real two
EOF
  # Correctly numbered, and failing. The ordinal sits in field 3 on a `not ok`
  # line and field 2 on an `ok` one; reading field 2 for both yields the word
  # "ok" here and would name this file on every run that has a failure.
  canned neighbour <<'EOF'
1..2
not ok 1 neighbour fails
ok 2 neighbour passes
EOF
  run_wrapper "$FX/phantom.bats" "$FX/neighbour.bats"
  [ "$status" -eq 2 ]
  assert_contains "$output" "TAP-shaped output of their own"
  assert_contains "$output" "phantom.bats"
  refute_contains "$output" "neighbour.bats"
}

# The cell above proves the guard fires on a stream shaped like the fault.
# This proves the fault is real on this bats: `--tap` passes fd 3 through
# unprefixed and the wrapper's watchdog counts what arrives. Real bats,
# because a fake cannot stand in for the race.
@test "a phantom TAP line from fd 3 is caught with real bats" {
  cat > "$FX/ghost.bats" <<'EOF'
setup_file() { echo "ok 9 phantom" >&3; }
@test "quick one" { true; }
@test "slow one" { sleep 3; }
EOF
  cat > "$FX/company.bats" <<'EOF'
@test "company one" { true; }
EOF
  run "$RUN_BATS" "$FX/ghost.bats" "$FX/company.bats"
  [ "$status" -eq 2 ]
  assert_contains "$output" "TAP-shaped output of their own"
  assert_contains "$output" "ghost.bats"
  # The stream itself stays self-consistent -- no shortfall, no plan
  # disagreement -- which is why the ordinals are the only evidence.
  refute_contains "$output" "tests reported"

  # One file never reaches the merge, so the check has to exist on both paths.
  run "$RUN_BATS" "$FX/ghost.bats"
  [ "$status" -eq 2 ]
  assert_contains "$output" "emitted TAP-shaped output of its own"

  # And a clean suite on that path still passes.
  run "$RUN_BATS" "$FX/company.bats"
  [ "$status" -eq 0 ]
  refute_contains "$output" "TAP-shaped"
}

@test "an emptied suite is named, not absorbed by the files beside it" {
  # Alone it exits 2, because bats refuses a file with no tests. Beside others
  # the wrapper passes --allow-empty-suite, which is what a filter needs, and
  # the emptied file used to disappear into their plan.
  fake_bats
  canned full <<'EOF'
1..1
ok 1 full one
EOF
  canned gutted <<'EOF'
1..0
EOF
  run_wrapper "$FX/full.bats" "$FX/gutted.bats"
  [ "$status" -eq 2 ]
  assert_contains "$output" "no tests"
  assert_contains "$output" "gutted.bats"
  refute_contains "$output" "full.bats"

  # With a filter, matching nothing in one file is ordinary.
  run_wrapper -f one "$FX/full.bats" "$FX/gutted.bats"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "1..1" ]
}

@test "a filter matching nothing anywhere is reported, not a quiet pass" {
  # Real bats: per-file --allow-empty-suite is right for a filter matching in
  # some files, which made a filter matching NOWHERE a silent green run.
  cat > "$FX/r1.bats" <<'EOF'
@test "alpha" { true; }
EOF
  cat > "$FX/r2.bats" <<'EOF'
@test "beta" { true; }
EOF
  run "$RUN_BATS" -f alpha "$FX/r1.bats" "$FX/r2.bats"
  [ "$status" -eq 0 ]
  [ "${lines[0]}" = "1..1" ]

  run "$RUN_BATS" -f no-such-test "$FX/r1.bats" "$FX/r2.bats"
  [ "$status" -eq 2 ]
  assert_contains "$output" "no test matched the filter"
}

@test "a stalled suite exits 2 and names the file" {
  cat > "$FX/stall.bats" <<'EOF'
@test "one reports" { true; }
@test "two hangs" { sleep 400; }
EOF
  cat > "$FX/quick.bats" <<'EOF'
@test "quick one" { true; }
EOF
  RUN_BATS_IDLE_TIMEOUT=5 run "$RUN_BATS" "$FX/stall.bats" "$FX/quick.bats"
  [ "$status" -eq 2 ]
  assert_contains "$output" "results are missing"
  assert_contains "$output" "stall.bats"
}

@test "a killed suite leaves no process behind" {
  # Orphan reaping is invisible in output, so only a process check sees it --
  # and it has to match something in a process's argv, which a marker written
  # inside the .bats body never is. The exit code is not the assertion here:
  # reaping the leaves lets bats report the killed test, so this run ends 1.
  local hang="$BATS_TEST_TMPDIR/hangbin$$"
  cp /bin/sleep "$hang"
  cat > "$FX/orphan.bats" <<EOF
@test "backgrounds a child" { "$hang" 400 & "$hang" 400; }
EOF
  RUN_BATS_IDLE_TIMEOUT=5 run "$RUN_BATS" "$FX/orphan.bats"
  [ "$status" -ne 0 ]

  run pgrep -f "hangbin$$"
  [ "$status" -ne 0 ]
  run pgrep -f "$FX/orphan.bats"
  [ "$status" -ne 0 ]
}

@test "single-file output matches a direct bats run" {
  # Iterating on a single suite is the wrapper's most common invocation, so
  # the no-merge path is a published interface. The direct bats call here is
  # the one place in the repo that warrants one: parity is the assertion.
  cat > "$FX/plain.bats" <<'EOF'
@test "p one" { true; }
@test "p two" { false; }
EOF
  run --separate-stderr bats --tap "$FX/plain.bats"
  local direct="$output" direct_status="$status"
  run --separate-stderr "$RUN_BATS" "$FX/plain.bats"
  [ "$output" = "$direct" ]
  [ "$status" -eq "$direct_status" ]
  # Parity is of the TAP stream. The wrapper adds one diagnostic of its own,
  # and the step that consumes it needs that line on a one-suite run too.
  [ "$stderr" = "bin/run-bats: 1 files" ]
}
