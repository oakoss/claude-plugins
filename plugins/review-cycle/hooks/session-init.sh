#!/usr/bin/env bash
# review-cycle: SessionStart hook
#
# Re-seeds the sentinel on fresh session starts. The rule:
#
#   - Sentinel missing                  → seed (first install: treat WIP as
#                                         "already reviewed" to avoid gating
#                                         pre-existing changes)
#   - Sentinel matches current state    → seed (no-op, keeps it fresh)
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

# One-time migration from 0.5.0's bare-hex sentinel format. The old format
# can't compare against the new sha256:<hex> + content-aware hash, so without
# this path users upgrading mid-WIP would be gated until they ran /accept.
# This intentionally re-seeds even if the working tree is dirty — the user's
# 0.5.0 sentinel was their declared "reviewed" state, and we honor it once.
if [ -f "$SENTINEL_FILE" ] && \
   grep -qE '^[a-f0-9]{64}$' "$SENTINEL_FILE" 2>/dev/null; then
  "${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$PROJECT_ROOT" seed >/dev/null 2>&1 || true
  exit 0
fi

# Strict re-seed: only when sentinel exists AND its content exactly matches
# the current hash (idempotent refresh), or when the sentinel is missing
# (first install). Comparing exact content — not piggybacking on `check`'s
# clean-tree exit-0 — prevents transient `git stash` / `git checkout`
# states from absorbing prior drift.
if [ ! -f "$SENTINEL_FILE" ]; then
  "${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$PROJECT_ROOT" seed >/dev/null || true
else
  CURRENT=$("${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$PROJECT_ROOT" current-hash 2>/dev/null || true)
  STORED=$(tr -d '[:space:]' < "$SENTINEL_FILE" 2>/dev/null || true)
  if [ -n "$CURRENT" ] && [ "$CURRENT" = "$STORED" ]; then
    "${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$PROJECT_ROOT" seed >/dev/null || true
  fi
fi
exit 0
