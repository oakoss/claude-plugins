#!/usr/bin/env bats
# Guards the property cpl-lan is about: assertion helpers must FAIL the test
# on mismatch under bash 3.2, where a bare [[ ]] mid-body is inert.

setup() {
  load 'helpers'
}

@test "assert_contains passes on a substring match" {
  assert_contains "abc def" "c d"
}

@test "assert_contains returns nonzero and names both strings on mismatch" {
  run assert_contains "actual text" "missing needle"
  [ "$status" -eq 1 ]
  assert_contains "$output" "missing needle"
  assert_contains "$output" "actual text"
}

@test "assert_contains rejects an empty or missing needle instead of passing vacuously" {
  run assert_contains "anything" ""
  [ "$status" -eq 1 ]
  assert_contains "$output" "empty or missing needle"
  run assert_contains "anything"
  [ "$status" -eq 1 ]
}

@test "refute_contains passes when the substring is absent" {
  refute_contains "abc" "xyz"
}

@test "refute_contains returns nonzero and says so when the substring is present" {
  run refute_contains "abc def" "def"
  [ "$status" -eq 1 ]
  assert_contains "$output" "expected NOT to contain"
}

@test "refute_contains rejects an empty or missing needle" {
  run refute_contains "anything" ""
  [ "$status" -eq 1 ]
  assert_contains "$output" "empty or missing needle"
  run refute_contains "anything"
  [ "$status" -eq 1 ]
}

@test "assert_matches applies the pattern as a regex" {
  assert_matches "anchor:0123abcd" '^anchor:[0-9a-f]+$'
}

@test "assert_matches supports alternation with spaces (pattern must stay unquoted in [[ =~ ]])" {
  assert_matches "picked: Not a directory" 'cannot write|Not a directory|File exists'
}

@test "assert_matches returns nonzero and says so on mismatch" {
  run assert_matches "anchor:XYZ" '^anchor:[0-9a-f]+$'
  [ "$status" -eq 1 ]
  assert_contains "$output" "expected to match"
}

@test "assert_matches rejects an empty or missing pattern instead of diverging across bashes" {
  run assert_matches "any value" ""
  [ "$status" -eq 1 ]
  assert_contains "$output" "empty or missing pattern"
  run assert_matches "any value"
  [ "$status" -eq 1 ]
}

@test "assert_matches names an invalid regex instead of reporting a mismatch" {
  run assert_matches "value" '([invalid'
  [ "$status" -eq 1 ]
  assert_contains "$output" "invalid regex"
}

@test "a failing helper mid-body fails the test under /bin/bash" {
  # /bin/bash is 3.2 on macOS, where a bare [[ ]] under `set -e` would
  # reach REACHED; the helper must abort instead. The message pin proves
  # the helper itself — not a sourcing or invocation error — aborted.
  run /bin/bash -c "
    source '$BATS_TEST_DIRNAME/helpers.bash'
    set -e
    assert_contains 'haystack' 'absent'
    echo REACHED
  "
  [ "$status" -eq 1 ]
  refute_contains "$output" "REACHED"
  assert_contains "$output" "expected to contain"
}

@test "refute passes when the command fails, as expected" {
  refute false
}

@test "refute returns nonzero and names the input when the command succeeds" {
  run refute true unexpected-arg
  [ "$status" -eq 1 ]
  assert_contains "$output" "expected failure, but succeeded"
  assert_contains "$output" "unexpected-arg"
}

@test "refute fails loudly when the command could not be run at all" {
  run refute definitely_not_a_command_xyz
  [ "$status" -eq 1 ]
  assert_contains "$output" "could not be run"
}

@test "a failing refute mid-body fails the test under /bin/bash" {
  run /bin/bash -c "
    source '$BATS_TEST_DIRNAME/helpers.bash'
    set -e
    refute true
    echo REACHED
  "
  [ "$status" -eq 1 ]
  refute_contains "$output" "REACHED"
  assert_contains "$output" "expected failure, but succeeded"
}

# If Apple ever ships a newer /bin/bash, the macOS leg silently stops covering
# bash 3.2; this fails instead. On Linux /bin/bash is 5.x, covered directly.
@test "on macOS, /bin/bash is still the bash 3.2 the proof tests assume" {
  [ "$(uname -s)" = "Darwin" ] || skip "not macOS — /bin/bash here is bash 5"
  run /bin/bash -c 'echo "${BASH_VERSINFO[0]}"'
  [ "$status" -eq 0 ]
  [ "$output" = "3" ]
}

@test "refute fails loudly when the command exists but is not executable" {
  printf '#!/bin/sh\nexit 0\n' > "$BATS_TEST_TMPDIR/noexec"
  chmod 644 "$BATS_TEST_TMPDIR/noexec"
  run refute "$BATS_TEST_TMPDIR/noexec"
  [ "$status" -eq 1 ]
  assert_contains "$output" "could not be run"
  assert_contains "$output" "(exit 126)"
}

# grep exits 2 when it cannot read its operand. Accepting that as the expected
# failure would let `refute grep -q x missing-file` pass while proving nothing.
@test "refute rejects a nonzero exit that is not a clean false" {
  run refute grep -q pattern "$BATS_TEST_TMPDIR/definitely-absent"
  [ "$status" -eq 1 ]
  assert_contains "$output" "not a clean false"
}

@test "refute still passes on a genuine no-match from grep" {
  printf 'alpha\n' > "$BATS_TEST_TMPDIR/haystack"
  refute grep -q "absent-needle" "$BATS_TEST_TMPDIR/haystack"
}

@test "refute rejects a call with no command" {
  run refute
  [ "$status" -eq 1 ]
  assert_contains "$output" "no command given"
}

# A refute that word-split its arguments would still "pass" at every call
# site, since the command would fail for the wrong reason.
@test "refute passes arguments through without splitting or globbing" {
  probe() {
    [ "$#" -eq 1 ] || return 0
    [ "$1" = 'a b *' ] || return 0
    return 1
  }
  refute probe 'a b *'
}
