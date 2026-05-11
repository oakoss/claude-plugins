#!/usr/bin/env bash
# review-cycle: SessionStart hook
#
# Seeds the sentinel once at session startup so pre-existing uncommitted
# changes don't trigger the gate. Idempotent — only seeds if sentinel doesn't
# already exist. Fail-open on any error (never trap the user).

# Global kill-switch
[ -f "$HOME/.claude/.disable-review-gate" ] && exit 0

# Read stdin (don't fail if empty)
INPUT=$(cat 2>/dev/null || true)

# Only act on fresh session startups, not resume/clear/compact
SOURCE=$(echo "$INPUT" | jq -r '.source // "unknown"' 2>/dev/null || echo "unknown")
[ "$SOURCE" != "startup" ] && exit 0

# Resolve project root: prefer CLAUDE_PROJECT_DIR, fall back to git rev-parse.
# Plugin hooks can see an empty CLAUDE_PROJECT_DIR in some cases (see issue #6023).
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$PROJECT_ROOT" ]; then
  PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
fi
[ -z "$PROJECT_ROOT" ] && exit 0

# Per-project opt-out
[ -f "$PROJECT_ROOT/.claude/.no-review-gate" ] && exit 0

# Must be a git repo
git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

SENTINEL="$PROJECT_ROOT/.claude/.review-mark"

# Skip if already seeded — preserves "unreviewed changes" state across sessions
[ -f "$SENTINEL" ] && exit 0

# Pick a sha256 tool (cross-platform: sha256sum on Linux, shasum on macOS)
if command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_CMD="shasum -a 256"
else
  exit 0
fi

# Compute state hash
HASH=$(cd "$PROJECT_ROOT" && git status --porcelain --untracked-files=all 2>/dev/null | $SHA_CMD 2>/dev/null | cut -d' ' -f1)
[ -z "$HASH" ] && exit 0

# Atomic write
mkdir -p "$PROJECT_ROOT/.claude" 2>/dev/null
TMP="${SENTINEL}.tmp.$$"
echo "$HASH" > "$TMP" 2>/dev/null && mv "$TMP" "$SENTINEL" 2>/dev/null

exit 0
