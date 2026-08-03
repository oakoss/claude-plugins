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
INPUT_CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Joined view: backslash and `&&` line-ends continue (bash semantics),
# remaining newlines act as `;`. Detection runs on this, not the raw text,
# so a backslash-split `git \<newline>commit` is still seen.
RAW=$(printf '%s\n' "$COMMAND" \
  | awk '{
      if (sub(/\\$/, "") || $0 ~ /&&[[:space:]]*$/) printf "%s ", $0
      else printf "%s;", $0
    }')

# Commit detection: keep in sync with the twin definition in
# plugins/review-cycle/hooks/commit-gate.sh. Recognizes global options in
# every real shape (`-C <path>`, `-c k='v with spaces'`, separate-argument
# `--git-dir <path>`) and subshell/backtick openers, so none of those forms
# slip past the gate.
GIT_OPT_ARG="([^[:space:];&|\"']|\"[^\"]*\"|'[^']*')+"
GIT_OPT_VAL="(\"[^\"]*\"|'[^']*'|[^-[:space:];&|\"'])([^[:space:];&|\"']|\"[^\"]*\"|'[^']*')*"
GIT_COMMIT_RE="(^|[;&|[:space:](\`])git([[:space:]]+-${GIT_OPT_ARG}([[:space:]]+${GIT_OPT_VAL})?)*[[:space:]]+commit\b"
if ! printf '%s' "$RAW" | LC_ALL=C grep -qE "$GIT_COMMIT_RE"; then
  exit 0
fi

[ -f "$HOME/.claude/.disable-review-gate" ] && exit 0

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$PROJECT_ROOT" ]; then
  PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
fi

# Candidates parsed out of the command text may be relative — to the
# payload cwd, or for a -C following a leading cd, to the cd target.
abs_candidate() {
  case "$1" in
    ''|/*) printf '%s' "$1" ;;
    *) if [ -n "$2" ]; then printf '%s/%s' "$2" "$1"; else printf '%s' "$1"; fi ;;
  esac
}

CD_CANDIDATE=$(echo "$COMMAND" | sed -nE 's/^[[:space:]]*cd[[:space:]]+("([^"]+)"|'\''([^'\'']+)'\''|([^[:space:]&;|]+)).*/\2\3\4/p' | head -1)
CD_CANDIDATE="${CD_CANDIDATE/#\~/$HOME}"
CD_CANDIDATE=$(abs_candidate "$CD_CANDIDATE" "$INPUT_CWD")
if [ -n "$CD_CANDIDATE" ] && [ -d "$CD_CANDIDATE" ]; then
  CD_ROOT=$(git -C "$CD_CANDIDATE" rev-parse --show-toplevel 2>/dev/null || true)
  [ -n "$CD_ROOT" ] && PROJECT_ROOT="$CD_ROOT"
fi

# `git -C <path> commit` names its repo inline and overrides any cd.
# Trust an inline -C only when the command holds a single commit match —
# with more than one, prose and the real invocation are indistinguishable
# here, so keep the cd/CLAUDE_PROJECT_DIR root rather than let text pick
# the repo. Within the match the last -C wins, like git.
COMMIT_COUNT=$(printf '%s' "$RAW" | LC_ALL=C grep -oE "$GIT_COMMIT_RE" \
  | wc -l | tr -d '[:space:]')
GIT_SEG=""
[ "$COMMIT_COUNT" = "1" ] \
  && GIT_SEG=$(printf '%s' "$RAW" | LC_ALL=C grep -oE "$GIT_COMMIT_RE" | head -1)
GIT_C_CANDIDATE=$(printf '%s' "$GIT_SEG" \
  | grep -oE -- "-C[[:space:]]+(\"[^\"]*\"|'[^']*'|[^[:space:];&|]+)" | tail -1 \
  | sed -E "s/^-C[[:space:]]+//; s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/")
GIT_C_CANDIDATE="${GIT_C_CANDIDATE/#\~/$HOME}"
GIT_C_CANDIDATE=$(abs_candidate "$GIT_C_CANDIDATE" "${CD_CANDIDATE:-$INPUT_CWD}")
if [ -n "$GIT_C_CANDIDATE" ] && [ -d "$GIT_C_CANDIDATE" ]; then
  C_ROOT=$(git -C "$GIT_C_CANDIDATE" rev-parse --show-toplevel 2>/dev/null || true)
  [ -n "$C_ROOT" ] && PROJECT_ROOT="$C_ROOT"
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
