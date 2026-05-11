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

# Resolve project root. Try multiple signals in order:
#   1. A leading `cd <path>` in the command itself (Claude often runs
#      `cd PATH && git commit`)
#   2. The hook input's `cwd` field (set by Claude Code dispatcher)
#   3. The CLAUDE_PROJECT_DIR env var (when set by Claude Code)
#   4. The current shell's cwd as last resort
resolve_project_root() {
  local candidate root

  # Try a leading `cd <path>` from the command
  candidate=$(echo "$COMMAND" | sed -nE 's/^[[:space:]]*cd[[:space:]]+("([^"]+)"|'\''([^'\'']+)'\''|([^[:space:]&;|]+)).*/\2\3\4/p' | head -1)
  if [ -n "$candidate" ]; then
    # Expand leading ~ to $HOME (cd doesn't expand ~ inside double quotes)
    candidate="${candidate/#\~/$HOME}"
    if [ -d "$candidate" ]; then
      root=$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null || true)
      if [ -n "$root" ]; then echo "$root"; return; fi
    fi
  fi

  # Try the hook input's cwd field
  candidate=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
  if [ -n "$candidate" ]; then
    root=$(git -C "$candidate" rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$root" ]; then echo "$root"; return; fi
  fi

  # Try the CLAUDE_PROJECT_DIR env var
  if [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
    root=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$root" ]; then echo "$root"; return; fi
  fi

  # Last resort: current shell cwd
  git rev-parse --show-toplevel 2>/dev/null || true
}

PROJECT_ROOT=$(resolve_project_root)
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

# Block the commit. PreToolUse uses hookSpecificOutput.permissionDecision,
# NOT the deprecated top-level `decision`/`reason` fields.
jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: "Cannot commit unreviewed changes. Run /review-cycle:review first, or touch .claude/.no-review-gate in the project root to bypass for this project."
  }
}' 2>/dev/null || printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Cannot commit unreviewed changes. Run /review-cycle:review first."}}\n'

exit 0
