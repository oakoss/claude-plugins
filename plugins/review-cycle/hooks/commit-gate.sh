#!/usr/bin/env bash
# review-cycle: PreToolUse hook (Bash matcher)
#
# Blocks `git commit` if uncommitted changes haven't been reviewed.
# Pass-through for any non-commit Bash command. Fail-open on any error.

# Global kill-switch
[ -f "$HOME/.claude/.disable-review-gate" ] && exit 0

INPUT=$(cat 2>/dev/null || true)

# Extract the bash command from the tool input
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Only act on git commit. Word-boundary match avoids false positives like
# `git commit-tree` (which we still want to block) or path strings.
if ! echo "$COMMAND" | grep -qE '(^|[;&|]|[[:space:]])git[[:space:]]+commit\b'; then
  exit 0
fi

# Resolve project root
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$PROJECT_ROOT" ]; then
  PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
fi
[ -z "$PROJECT_ROOT" ] && exit 0

# Per-project opt-out
[ -f "$PROJECT_ROOT/.claude/.no-review-gate" ] && exit 0

# Must be a git repo
git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Pick a sha256 tool
if command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_CMD="shasum -a 256"
else
  exit 0
fi

# Compute current state hash
CURRENT_HASH=$(cd "$PROJECT_ROOT" && git status --porcelain --untracked-files=all 2>/dev/null | $SHA_CMD 2>/dev/null | cut -d' ' -f1)

# Read sentinel, validate as 64-char hex
SENTINEL="$PROJECT_ROOT/.claude/.review-mark"
LAST_HASH=""
if [ -f "$SENTINEL" ]; then
  LAST_HASH=$(cat "$SENTINEL" 2>/dev/null | tr -d '[:space:]')
  echo "$LAST_HASH" | grep -qE '^[a-f0-9]{64}$' || LAST_HASH=""
fi

# Match means current state was reviewed → allow commit
[ "$CURRENT_HASH" = "$LAST_HASH" ] && exit 0

# Block the commit
jq -n '{
  decision: "block",
  reason: "Cannot commit unreviewed changes. Run /review-cycle:cycle first, or touch .claude/.no-review-gate in the project root to bypass for this project."
}' 2>/dev/null || printf '{"decision":"block","reason":"Cannot commit unreviewed changes. Run /review-cycle:cycle first."}\n'

exit 0
