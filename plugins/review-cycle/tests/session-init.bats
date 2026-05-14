#!/usr/bin/env bats

setup() {
  load 'helpers'
  setup_repo
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  SESSION_INIT="$PLUGIN_ROOT/hooks/session-init.sh"
}

# Produces 0.5.x-format hashes for constructing legacy sentinel fixtures.
legacy_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    SHA="sha256sum"
  else
    SHA="shasum -a 256"
  fi
  {
    git status --porcelain --untracked-files=all \
      ':(exclude).claude/.review-mark' \
      ':(exclude).claude/.no-review-gate' 2>/dev/null
    git diff --cached --binary \
      ':(exclude).claude/.review-mark' \
      ':(exclude).claude/.no-review-gate' 2>/dev/null
    git diff --binary \
      ':(exclude).claude/.review-mark' \
      ':(exclude).claude/.no-review-gate' 2>/dev/null
    git ls-files --others --exclude-standard \
      ':(exclude).claude/.review-mark' \
      ':(exclude).claude/.no-review-gate' 2>/dev/null \
      | while IFS= read -r f; do
          printf '\n--UNTRACKED:%s--\n' "$f"
          [ -f "$f" ] && cat -- "$f" 2>/dev/null
        done
  } | $SHA | cut -d' ' -f1
}

run_session_init() {
  local source="${1:-startup}"
  echo "{\"source\":\"$source\",\"cwd\":\"$TEST_REPO\"}" \
    | CLAUDE_PROJECT_DIR="$TEST_REPO" bash "$SESSION_INIT"
}

@test "session-init seeds when sentinel is missing" {
  echo "v1" > foo.txt
  run_session_init
  [ -f "$TEST_REPO/.claude/.review-mark" ]
  grep -qE '^anchor:[a-f0-9]{40}$' <(sed -n '1p' "$TEST_REPO/.claude/.review-mark")
}

# When the 0.6.0 sentinel matches current state, session-init must re-seed so
# the anchor advances to current HEAD. This keeps the diff window small as
# work gets committed and reduces the chance the anchor becomes unreachable
# (rebase, branch delete). Asserting that the anchor literally advanced is
# the only way to distinguish a working hook from a no-op.
@test "session-init advances anchor to current HEAD on idempotent re-seed" {
  echo "original" > foo.txt
  git add foo.txt
  git commit -q -m "init"
  echo "v1" > foo.txt
  "$REVIEW_SENTINEL" mark
  OLD_ANCHOR=$(sed -n '1p' "$TEST_REPO/.claude/.review-mark" | sed 's/^anchor://')
  git add foo.txt
  git commit -q -m "commit reviewed change"
  NEW_HEAD=$(git rev-parse HEAD)
  run_session_init
  NEW_ANCHOR=$(sed -n '1p' "$TEST_REPO/.claude/.review-mark" | sed 's/^anchor://')
  [ "$NEW_ANCHOR" = "$NEW_HEAD" ]
  [ "$NEW_ANCHOR" != "$OLD_ANCHOR" ]
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

@test "session-init leaves 0.6.0 sentinel alone when it disagrees with current state" {
  echo "v1" > foo.txt
  "$REVIEW_SENTINEL" mark
  STORED_BEFORE=$(cat "$TEST_REPO/.claude/.review-mark")
  echo "v2" > foo.txt
  run_session_init
  STORED_AFTER=$(cat "$TEST_REPO/.claude/.review-mark")
  [ "$STORED_BEFORE" = "$STORED_AFTER" ]
}

@test "session-init migrates 0.5.1 sentinel and new gate passes against migrated state" {
  echo "v1" > foo.txt
  echo "u1" > new.txt
  mkdir -p .claude
  HASH=$(legacy_hash)
  echo "sha256:$HASH" > "$TEST_REPO/.claude/.review-mark"
  run_session_init
  grep -qE '^anchor:[a-f0-9]{40}$' <(sed -n '1p' "$TEST_REPO/.claude/.review-mark")
  grep -qE '^sha256:[a-f0-9]{64}$' <(sed -n '2p' "$TEST_REPO/.claude/.review-mark")
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
  echo "v2" > foo.txt
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 1 ]
}

@test "session-init migrates 0.5.0 sentinel (bare hex) and new gate passes against migrated state" {
  echo "v1" > foo.txt
  mkdir -p .claude
  HASH=$(legacy_hash)
  echo "$HASH" > "$TEST_REPO/.claude/.review-mark"
  run_session_init
  grep -qE '^anchor:[a-f0-9]{40}$' <(sed -n '1p' "$TEST_REPO/.claude/.review-mark")
  grep -qE '^sha256:[a-f0-9]{64}$' <(sed -n '2p' "$TEST_REPO/.claude/.review-mark")
  run "$REVIEW_SENTINEL" check
  [ "$status" -eq 0 ]
}

@test "session-init does NOT migrate 0.5.x sentinel when state has drifted" {
  echo "v1" > foo.txt
  mkdir -p .claude
  HASH=$(legacy_hash)
  echo "sha256:$HASH" > "$TEST_REPO/.claude/.review-mark"
  STORED_BEFORE=$(cat "$TEST_REPO/.claude/.review-mark")
  echo "v2" > foo.txt
  run_session_init
  STORED_AFTER=$(cat "$TEST_REPO/.claude/.review-mark")
  # Stale 0.5.x sentinel preserved so the gate fires as malformed → drift.
  [ "$STORED_BEFORE" = "$STORED_AFTER" ]
}

@test "session-init no-ops on resume source" {
  echo "v1" > foo.txt
  run_session_init "resume"
  [ ! -f "$TEST_REPO/.claude/.review-mark" ]
}

@test "session-init no-ops on clear source" {
  echo "v1" > foo.txt
  run_session_init "clear"
  [ ! -f "$TEST_REPO/.claude/.review-mark" ]
}

@test "session-init no-ops on compact source" {
  echo "v1" > foo.txt
  run_session_init "compact"
  [ ! -f "$TEST_REPO/.claude/.review-mark" ]
}

@test "session-init no-ops when kill-switch is set" {
  touch "$HOME/.claude/.disable-review-gate"
  echo "v1" > foo.txt
  run_session_init
  [ ! -f "$TEST_REPO/.claude/.review-mark" ]
}

@test "session-init no-ops when project opted out (legacy marker)" {
  mkdir -p "$TEST_REPO/.claude"
  touch "$TEST_REPO/.claude/.no-review-gate"
  echo "v1" > foo.txt
  run_session_init
  [ ! -f "$TEST_REPO/.claude/.review-mark" ]
}

@test "session-init no-ops when review-cycle.json sets disabled:true" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":true}\n' > "$TEST_REPO/.claude/review-cycle.json"
  echo "v1" > foo.txt
  run_session_init
  [ ! -f "$TEST_REPO/.claude/.review-mark" ]
}

# Legacy `.no-review-gate` is NOT auto-migrated. The old marker is
# typically gitignored (per the pre-0.6.2 README) and treating it as
# equivalent to a commit-worthy `disabled:true` config would risk
# accidentally publishing the opt-out to the team. session-init leaves
# the marker alone; gate.sh's fallback continues to honor it indefinitely.
@test "session-init does NOT auto-migrate legacy .no-review-gate" {
  mkdir -p "$TEST_REPO/.claude"
  touch "$TEST_REPO/.claude/.no-review-gate"
  run_session_init
  [ -f "$TEST_REPO/.claude/.no-review-gate" ]
  [ ! -f "$TEST_REPO/.claude/review-cycle.json" ]
}

# Regression guard: session-init must proceed (write sentinel) when an
# explicit disabled:false config is present with no legacy marker. A
# refactor that treated any config file as opt-out would skip the seed.
@test "session-init seeds when review-cycle.json has disabled:false" {
  mkdir -p "$TEST_REPO/.claude"
  printf '{"disabled":false}\n' > "$TEST_REPO/.claude/review-cycle.json"
  echo "v1" > foo.txt
  run_session_init
  [ -f "$TEST_REPO/.claude/.review-mark" ]
}
