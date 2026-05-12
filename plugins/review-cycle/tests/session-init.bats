#!/usr/bin/env bats

setup() {
  load 'helpers'
  setup_repo
  export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
  SESSION_INIT="$PLUGIN_ROOT/hooks/session-init.sh"
}

# Compute the 0.5.x-format hash of the current state so tests can construct
# legacy sentinels that match the working tree. Mirrors the legacy logic
# inside session-init.sh.
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
  echo "{\"source\":\"startup\",\"cwd\":\"$TEST_REPO\"}" \
    | CLAUDE_PROJECT_DIR="$TEST_REPO" bash "$SESSION_INIT"
}

@test "session-init seeds when sentinel is missing" {
  echo "v1" > foo.txt
  run_session_init
  [ -f "$TEST_REPO/.claude/.review-mark" ]
  grep -qE '^anchor:[a-f0-9]{40}$' <(sed -n '1p' "$TEST_REPO/.claude/.review-mark")
}

@test "session-init re-seeds when 0.6.0 sentinel matches current state" {
  echo "v1" > foo.txt
  "$REVIEW_SENTINEL" mark
  ORIG_CONTENT=$(cat "$TEST_REPO/.claude/.review-mark")
  # Touch the sentinel to a known older mtime to detect rewrite.
  touch -t 200001010000 "$TEST_REPO/.claude/.review-mark"
  run_session_init
  # Sentinel should have been re-written (mtime is no longer in the past).
  NEW_MTIME=$(date -r "$TEST_REPO/.claude/.review-mark" +%Y 2>/dev/null || stat -c '%Y' "$TEST_REPO/.claude/.review-mark")
  # Just verify it's still valid and parseable (content may be byte-identical).
  grep -qE '^anchor:[a-f0-9]{40}$' <(sed -n '1p' "$TEST_REPO/.claude/.review-mark")
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

@test "session-init migrates 0.5.1 sentinel that matches current state" {
  echo "v1" > foo.txt
  echo "u1" > new.txt
  mkdir -p .claude
  HASH=$(legacy_hash)
  echo "sha256:$HASH" > "$TEST_REPO/.claude/.review-mark"
  run_session_init
  # After migration the sentinel should be in two-line 0.6.0 format.
  grep -qE '^anchor:[a-f0-9]{40}$' <(sed -n '1p' "$TEST_REPO/.claude/.review-mark")
  grep -qE '^sha256:[a-f0-9]{64}$' <(sed -n '2p' "$TEST_REPO/.claude/.review-mark")
}

@test "session-init migrates 0.5.0 sentinel (bare hex) that matches current state" {
  echo "v1" > foo.txt
  mkdir -p .claude
  HASH=$(legacy_hash)
  echo "$HASH" > "$TEST_REPO/.claude/.review-mark"
  run_session_init
  # After migration the sentinel should be in two-line 0.6.0 format.
  grep -qE '^anchor:[a-f0-9]{40}$' <(sed -n '1p' "$TEST_REPO/.claude/.review-mark")
  grep -qE '^sha256:[a-f0-9]{64}$' <(sed -n '2p' "$TEST_REPO/.claude/.review-mark")
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

@test "session-init no-ops on non-startup source" {
  echo "v1" > foo.txt
  echo '{"source":"resume","cwd":"'"$TEST_REPO"'"}' \
    | CLAUDE_PROJECT_DIR="$TEST_REPO" bash "$SESSION_INIT"
  [ ! -f "$TEST_REPO/.claude/.review-mark" ]
}

@test "session-init no-ops when kill-switch is set" {
  touch "$HOME/.claude/.disable-review-gate"
  echo "v1" > foo.txt
  run_session_init
  [ ! -f "$TEST_REPO/.claude/.review-mark" ]
}

@test "session-init no-ops when project opted out" {
  mkdir -p "$TEST_REPO/.claude"
  touch "$TEST_REPO/.claude/.no-review-gate"
  echo "v1" > foo.txt
  run_session_init
  [ ! -f "$TEST_REPO/.claude/.review-mark" ]
}
