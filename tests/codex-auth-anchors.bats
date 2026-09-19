#!/usr/bin/env bats
# Prose anchors for the Codex auth vocabulary, which spans four files with
# nothing else linking them: both review skills, the init skill, and the
# plugin README.
#
# The incident: `codex login status` exits 0 and prints `Logged in using
# ChatGPT` whether the stored credential works, has been revoked server-side,
# or is an `auth.json` containing only `{}`. Its verdict is a pure function of
# whether that file exists and parses. The cycle recorded that as auth
# `confirmed`, spawned the Codex leg on it, and the leg died on a 401.
#
# These check that four named files use one label for the probe's exit-0
# outcome, that none reports it as confirmed auth by any wording seen so far,
# and that neither review skill has reverted to forbidding the read of the
# leg's output. They match phrases: a rewrite keeping every anchored phrase
# while changing what the surrounding rule means passes, and no grep closes
# that.
#
# Both banned-wording checks anchor the invariant as well as the stale
# literal, because banning only the old wording (`✓ authed`, and the refuted
# `crashed run and a clean run look alike`) lets the same defect return in the
# new vocabulary.

REVIEW="plugins/review-cycle/skills/review/SKILL.md"
REVIEW_PR="plugins/review-cycle/skills/review-pr/SKILL.md"
INIT="plugins/review-cycle/skills/init/SKILL.md"
README="plugins/review-cycle/README.md"

# Distinct surfaces, counted after dedup: a duplicated entry would otherwise
# hold the count while a surface silently left every loop below.
SURFACE_COUNT=4

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
}

auth_surfaces() {
  printf '%s\n' "$REVIEW" "$REVIEW_PR" "$INIT" "$README"
}

@test "the surface list has not collapsed" {
  local n
  n="$(auth_surfaces | sort -u | wc -l | tr -d ' ')"
  [ "$n" -eq "$SURFACE_COUNT" ] || {
    printf 'auth_surfaces lists %s distinct files, expected %s — a surface that leaves takes its coverage with it\n' \
      "$n" "$SURFACE_COUNT" >&2
    return 1
  }
}

@test "no surface reports the probe's exit 0 as confirmed auth" {
  local found=""
  while IFS= read -r rel; do
    local f="$REPO_ROOT/$rel"
    # -f, not -r: a readable directory makes every grep below return nonzero,
    # which a presence check would read as clean.
    [ -f "$f" ] || { found+="  $rel — missing or not a regular file"$'\n'; continue; }
    grep -qF 'auth `confirmed`' "$f" && found+="  $rel — reports auth confirmed"$'\n'
    grep -qF 'auth: confirmed' "$f" && found+="  $rel — summary enum offers confirmed"$'\n'
    grep -qF '✓ authed' "$f" && found+="  $rel — checkmark for an unexercised credential"$'\n'
  done < <(auth_surfaces)
  # The invariant, not just the old wording: the checkmark can return in the
  # new vocabulary without reusing the banned literal.
  grep -qF 'use the `-` glyph, not `✓`' "$REPO_ROOT/$INIT" \
    || found+="  $INIT — no rule keeping the exit-0 line off the checkmark"$'\n'
  [ -z "$found" ] || {
    printf 'the probe does not exercise the credential; these claim it does:\n%s' "$found" >&2
    return 1
  }
}

@test "all four surfaces name the exit-0 outcome the same way" {
  local missing=""
  while IFS= read -r rel; do
    local f="$REPO_ROOT/$rel"
    [ -f "$f" ] || { missing+="  $rel — missing or not a regular file"$'\n'; continue; }
    grep -qF 'stored session (not exercised)' "$f" \
      || missing+="  $rel — does not use the shared label"$'\n'
  done < <(auth_surfaces)
  [ -z "$missing" ] || {
    printf 'one vocabulary, or a user cannot match a summary to the docs:\n%s' "$missing" >&2
    return 1
  }
}

@test "neither review skill forbids reading the leg's own output" {
  local missing=""
  grep -qF 'Open the output file before composing the failure message' "$REPO_ROOT/$REVIEW" \
    || missing+="  $REVIEW — no imperative to open the leg's output"$'\n'
  grep -qF 'Open that file before filling' "$REPO_ROOT/$REVIEW_PR" \
    || missing+="  $REVIEW_PR — no imperative to open the leg's output"$'\n'
  for rel in "$REVIEW" "$REVIEW_PR"; do
    local f="$REPO_ROOT/$rel"
    [ -f "$f" ] || { missing+="  $rel — missing or not a regular file"$'\n'; continue; }
    # The justification was measured false: the file records
    # `[exited with code N]` on a clean and a crashed run alike. Matched
    # loosely so a paraphrase cannot slip it back in.
    grep -qEi 'crashed.*clean run|look alike' "$f" \
      && missing+="  $rel — the refuted 'look alike' justification is back"$'\n'
    grep -qF 'not from the output file' "$f" \
      && missing+="  $rel — the prohibition is back alongside the instruction"$'\n'
  done
  [ -z "$missing" ] || {
    printf 'exit 1 names no cause; only the output file does:\n%s' "$missing" >&2
    return 1
  }
}
