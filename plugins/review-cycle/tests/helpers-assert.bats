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
