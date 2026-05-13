#!/usr/bin/env bash
# Repo-local PreToolUse hook for the oakoss/claude-plugins marketplace.
#
# Blocks `git commit` when files under plugins/<X>/ are staged for commit
# without a corresponding version bump in plugins/<X>/.claude-plugin/plugin.json
# AND .claude-plugin/marketplace.json.
#
# Registered in .claude/settings.json (committed at the repo root). This is
# repo-specific tooling, not part of any plugin — non-marketplace projects
# don't need or get this gate.
#
# Per-project opt-out: .claude/.no-version-gate
# Global kill-switch:  ~/.claude/.disable-review-gate (shared with the
#                      review-cycle plugin's gates so a single switch
#                      disables every commit-time gate at once).
#
# Fail-open on any error — exit 0 rather than trapping the user.

INPUT=$(cat 2>/dev/null || true)

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if ! echo "$COMMAND" | grep -qE '(^|[;&|]|[[:space:]])git[[:space:]]+commit\b'; then
  exit 0
fi

[ -f "$HOME/.claude/.disable-review-gate" ] && exit 0

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$PROJECT_ROOT" ]; then
  PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
fi

CD_CANDIDATE=$(echo "$COMMAND" | sed -nE 's/^[[:space:]]*cd[[:space:]]+("([^"]+)"|'\''([^'\'']+)'\''|([^[:space:]&;|]+)).*/\2\3\4/p' | head -1)
CD_CANDIDATE="${CD_CANDIDATE/#\~/$HOME}"
if [ -n "$CD_CANDIDATE" ] && [ -d "$CD_CANDIDATE" ]; then
  CD_ROOT=$(git -C "$CD_CANDIDATE" rev-parse --show-toplevel 2>/dev/null || true)
  [ -n "$CD_ROOT" ] && PROJECT_ROOT="$CD_ROOT"
fi

[ -n "$PROJECT_ROOT" ] || exit 0
[ -f "$PROJECT_ROOT/.claude/.no-version-gate" ] && exit 0
[ -f "$PROJECT_ROOT/.claude-plugin/marketplace.json" ] || exit 0

STAGED=$(cd "$PROJECT_ROOT" && git diff --cached --name-only 2>/dev/null)
[ -z "$STAGED" ] && exit 0

AFFECTED=()
while IFS= read -r path; do
  case "$path" in
    plugins/*/*) ;;
    *) continue ;;
  esac
  plugin=$(echo "$path" | sed -nE 's|^plugins/([^/]+)/.*$|\1|p')
  [ -z "$plugin" ] && continue
  case "$path" in
    plugins/"$plugin"/README.md) continue ;;
    plugins/"$plugin"/CHANGELOG.md) continue ;;
    plugins/"$plugin"/NOTICE) continue ;;
    plugins/"$plugin"/LICENSE) continue ;;
    plugins/"$plugin"/LICENSE-*) continue ;;
    plugins/"$plugin"/tests/*) continue ;;
    plugins/"$plugin"/test/*) continue ;;
    plugins/"$plugin"/.claude-plugin/plugin.json) continue ;;
  esac
  seen=0
  for p in "${AFFECTED[@]}"; do
    [ "$p" = "$plugin" ] && seen=1 && break
  done
  [ $seen -eq 0 ] && AFFECTED+=("$plugin")
done <<< "$STAGED"

[ ${#AFFECTED[@]} -eq 0 ] && exit 0

MISSING=()
for plugin in "${AFFECTED[@]}"; do
  pj_path="plugins/$plugin/.claude-plugin/plugin.json"
  pj_bumped=0
  if cd "$PROJECT_ROOT" && git diff --cached -- "$pj_path" 2>/dev/null \
       | grep -qE '^\+.*"version"[[:space:]]*:'; then
    pj_bumped=1
  fi
  mp_bumped=0
  if cd "$PROJECT_ROOT" && git diff --cached -- ".claude-plugin/marketplace.json" 2>/dev/null \
       | grep -qE '^\+.*"version"[[:space:]]*:'; then
    mp_bumped=1
  fi
  if [ $pj_bumped -eq 0 ] || [ $mp_bumped -eq 0 ]; then
    MISSING+=("$plugin (plugin.json bumped: $pj_bumped, marketplace.json bumped: $mp_bumped)")
  fi
done

[ ${#MISSING[@]} -eq 0 ] && exit 0

REASON="BLOCKED: plugin runtime changes need a version bump. Affected:"
for entry in "${MISSING[@]}"; do
  REASON="$REASON
  - $entry"
done
REASON="$REASON

Bump \"version\" in plugins/<name>/.claude-plugin/plugin.json AND the matching entry in .claude-plugin/marketplace.json. Add a CHANGELOG entry under the new version heading. To bypass this gate, touch .claude/.no-version-gate."

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}' 2>/dev/null || printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Plugin runtime changes need a version bump in plugin.json AND marketplace.json."}}\n'

exit 0
