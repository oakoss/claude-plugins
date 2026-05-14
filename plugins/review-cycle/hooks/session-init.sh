#!/usr/bin/env bash
# review-cycle: SessionStart hook
#
# Re-seeds the sentinel on fresh session starts. The rule:
#
#   - Sentinel missing                  → seed (first install: treat WIP as
#                                         "already reviewed" to avoid gating
#                                         pre-existing changes)
#   - Sentinel matches current state    → seed (idempotent; advances the
#                                         stored anchor forward to current
#                                         HEAD so the diff window stays small)
#   - Sentinel disagrees with current   → DO NOT seed (the previous session
#                                         left unreviewed work; let Stop/commit
#                                         gates do their job)
#
# `/clear`, `/compact`, and resume events are NOT `startup` and do not invoke
# this hook at all, so in-progress work in those flows always stays gated.

source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/gate.sh"

INPUT=$(cat 2>/dev/null || true)

SOURCE=$(echo "$INPUT" | jq -r '.source // "unknown"' 2>/dev/null || echo "unknown")
[ "$SOURCE" != "startup" ] && exit 0

PROJECT_ROOT=$(gate_should_run) || exit 0

SENTINEL_FILE="$PROJECT_ROOT/.claude/.review-mark"
REVIEW_SENTINEL="${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel"

# Computes the 0.5.x-format hash (bare 64-hex, no prefix) for migration only.
compute_legacy_hash() {
  local root="$1" sha
  if command -v sha256sum >/dev/null 2>&1; then
    sha="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    sha="shasum -a 256"
  else
    return 1
  fi
  (cd "$root" && {
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
  } | $sha 2>/dev/null | cut -d' ' -f1)
}

# One-time migration from any pre-0.6.0 sentinel format. Neither the 0.5.0
# (bare hex) nor the 0.5.1 (`sha256:`-prefixed) format carries an anchor SHA,
# so they can't be compared with the 0.6.0 anchor-aware check. Without this
# branch, every user upgrading mid-WIP would be gated on next session start.
#
# Lossless: if the legacy hash matches current state, re-seed in 0.6.0 format.
# If not, the user has unreviewed drift; leave the old sentinel so the gate
# fires (the new parser treats single-line sentinels as malformed = drift).
if [ -f "$SENTINEL_FILE" ]; then
  FIRST_LINE=$(sed -n '1p' "$SENTINEL_FILE" 2>/dev/null | tr -d '[:space:]')
  STORED_BARE=""
  if [[ "$FIRST_LINE" =~ ^sha256:([a-f0-9]{64})$ ]]; then
    STORED_BARE="${BASH_REMATCH[1]}"
  elif [[ "$FIRST_LINE" =~ ^([a-f0-9]{64})$ ]]; then
    STORED_BARE="${BASH_REMATCH[1]}"
  fi
  if [ -n "$STORED_BARE" ]; then
    CURRENT_BARE=$(compute_legacy_hash "$PROJECT_ROOT")
    if [ $? -ne 0 ] || [ -z "$CURRENT_BARE" ]; then
      echo "review-sentinel: legacy hash computation failed; skipping 0.5.x → 0.6.0 migration (no sha256sum/shasum?). Run /review-cycle:review or /review-cycle:accept to clear the gate." >&2
    elif [ "$CURRENT_BARE" = "$STORED_BARE" ]; then
      "$REVIEW_SENTINEL" --root "$PROJECT_ROOT" seed >/dev/null || true
    fi
    exit 0
  fi
fi

# Strict re-seed: only when sentinel is missing (first install, adopt WIP)
# or when the sentinel still matches current state (idempotent refresh, which
# advances the anchor to current HEAD so the diff window stays small).
# Uses `match` rather than `check` to bypass the clean-tree fast-path; a
# transient stash/checkout shouldn't absorb prior drift.
if [ ! -f "$SENTINEL_FILE" ]; then
  "$REVIEW_SENTINEL" --root "$PROJECT_ROOT" seed >/dev/null || true
elif "$REVIEW_SENTINEL" --root "$PROJECT_ROOT" match >/dev/null 2>&1; then
  "$REVIEW_SENTINEL" --root "$PROJECT_ROOT" seed >/dev/null || true
fi
exit 0
