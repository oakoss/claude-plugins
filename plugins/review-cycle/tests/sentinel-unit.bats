#!/usr/bin/env bats
# Direct unit tests for build_scratch_index, the scratch intent-to-add index
# that normalizes untracked-file hashing. The other suites drive the binary
# end-to-end; these source the script (the BASH_SOURCE guard suppresses the
# dispatch) and exercise the helper in isolation, since it is the part most
# likely to break under a future git/xargs version.

setup() {
  load 'helpers'
  setup_repo
  # shellcheck source=/dev/null
  source "$REVIEW_SENTINEL"
}

# The core invariant: an untracked new file, intent-to-added into the scratch
# index, diffs byte-identically to the same file's staged form. This is what
# makes untracked/staged/committed forms collapse to a single hash.
@test "build_scratch_index: untracked file diffs identically to its staged form" {
  printf 'l1\nl2\n' > new.txt
  build_excludes "$TEST_REPO"
  ANCHOR=$(git rev-parse HEAD)

  git add new.txt
  staged=$(git diff --cached --binary --no-prefix "$ANCHOR" -- new.txt)
  git reset -q new.txt

  scratch=$(mktemp); /bin/rm -f "$scratch"
  ( build_scratch_index "$TEST_REPO" "$scratch" )
  i2a=$(GIT_INDEX_FILE="$scratch" git diff --binary --no-prefix -- new.txt)
  /bin/rm -f "$scratch"

  [ "$staged" = "$i2a" ]
}

# A filename with spaces must survive the NUL-delimited ls-files | xargs -0
# path the helper uses.
@test "build_scratch_index: handles a filename with spaces" {
  printf 'x\n' > "my notes.md"
  build_excludes "$TEST_REPO"
  scratch=$(mktemp); /bin/rm -f "$scratch"
  ( build_scratch_index "$TEST_REPO" "$scratch" )
  names=$(GIT_INDEX_FILE="$scratch" git diff --name-only)
  /bin/rm -f "$scratch"
  [[ "$names" == *"my notes.md"* ]]
}

# Tracked-only / clean trees have no untracked files; the helper must skip the
# xargs intent-add entirely (GNU xargs would otherwise run `git add -N --` on
# empty input) and still produce a usable scratch index.
@test "build_scratch_index: succeeds with no untracked files" {
  echo base > foo.txt; git add foo.txt; git commit -q -m foo
  echo changed > foo.txt
  build_excludes "$TEST_REPO"
  scratch=$(mktemp); /bin/rm -f "$scratch"
  ( build_scratch_index "$TEST_REPO" "$scratch" ); rc=$?
  names=$(GIT_INDEX_FILE="$scratch" git diff --name-only)
  /bin/rm -f "$scratch"
  [ "$rc" -eq 0 ]
  [[ "$names" == *"foo.txt"* ]]
}

# A scratch index that cannot be written (cp fails on an unwritable target)
# must propagate as nonzero so the caller blocks rather than hashing a partial
# tree. setup_repo's initial commit guarantees a real index for cp to copy.
@test "build_scratch_index: returns nonzero when the scratch cannot be written" {
  build_excludes "$TEST_REPO"
  # `run` so the intentional cp failure is captured, not caught by bats' trap.
  run build_scratch_index "$TEST_REPO" "/nonexistent-dir-xyz123/scratch"
  [ "$status" -ne 0 ]
}

# Excluded untracked paths (.beads/ et al.) are never intent-added, while a
# normal untracked file is — the contrast is what proves the exclusion bites.
@test "build_scratch_index: excludes task-state dirs but includes normal files" {
  echo code > src.txt
  mkdir -p .beads; echo x > .beads/issues.jsonl
  build_excludes "$TEST_REPO"
  scratch=$(mktemp); /bin/rm -f "$scratch"
  ( build_scratch_index "$TEST_REPO" "$scratch" )
  names=$(GIT_INDEX_FILE="$scratch" git diff --name-only)
  /bin/rm -f "$scratch"
  [[ "$names" == *"src.txt"* ]]
  [[ "$names" != *".beads"* ]]
}
