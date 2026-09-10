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

# Lexical analysis (commit detection, cd/-C extraction) is shared with the
# review-cycle plugin's commit gate — one definition, both gates move
# together. The path is repo-relative because this hook only ships inside
# this marketplace repo. Fail-open if the lib moves; the bats suite pins
# behavior so that breaks loudly in CI, not silently here.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/plugins/review-cycle/hooks/lib/command-parse.sh" 2>/dev/null || exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
INPUT_CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

parse_has_commit "$COMMAND" || exit 0

[ -f "$HOME/.claude/.disable-review-gate" ] && exit 0

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$PROJECT_ROOT" ]; then
  PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
fi

CD_CANDIDATE=$(parse_extract_cd "$COMMAND")
CD_CANDIDATE="${CD_CANDIDATE/#\~/$HOME}"
CD_CANDIDATE=$(parse_abs "$CD_CANDIDATE" "$INPUT_CWD")
if [ -n "$CD_CANDIDATE" ] && [ -d "$CD_CANDIDATE" ]; then
  CD_ROOT=$(git -C "$CD_CANDIDATE" rev-parse --show-toplevel 2>/dev/null || true)
  [ -n "$CD_ROOT" ] && PROJECT_ROOT="$CD_ROOT"
fi

# An inline `git -C` overrides any cd — it decides where the commit lands.
# parse_extract_git_c is count-gated: prose or multi-commit ambiguity
# yields empty, keeping the cd/CLAUDE_PROJECT_DIR root.
GIT_C_CANDIDATE=$(parse_extract_git_c "$COMMAND")
GIT_C_CANDIDATE="${GIT_C_CANDIDATE/#\~/$HOME}"
GIT_C_CANDIDATE=$(parse_abs "$GIT_C_CANDIDATE" "${CD_CANDIDATE:-$INPUT_CWD}")
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
    plugins/"$plugin"/package.json) continue ;;
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
  # A staged bump file naming the plugin is the other valid shape: the bump
  # lands later in the version PR. Both directories count while bumpy and oakum
  # coexist. The frontmatter name may be bare, double-, or single-quoted; both
  # tools' `add` emit the bare form, and oakum rejects a quoted unscoped name.
  #
  # The excluded names are oakum's skip list for .changeset/: it ignores
  # README.md in any case and AGENTS/CLAUDE/GEMINI.md exactly, so a bump entry
  # written into one covers nothing — and it skips them silently, exit 0.
  # bumpy has no such list; .bumpy/AGENTS.md is a real bump file to it, and it
  # skips only the exact name README.md. :(glob) keeps `*` from crossing `/`:
  # oakum reads no nested change file, and bumpy reads one only under a
  # configured channel, which this repo does not declare.
  cs_covered=0
  if cd "$PROJECT_ROOT" && git diff --cached -- ':(glob).bumpy/*.md' ':(glob).changeset/*.md' \
       ':(exclude,icase).changeset/README.md' ':(exclude).changeset/AGENTS.md' \
       ':(exclude).changeset/CLAUDE.md' ':(exclude).changeset/GEMINI.md' \
       ':(exclude).bumpy/README.md' 2>/dev/null \
       | grep -qE "^\+[[:space:]]*[\"']?${plugin}[\"']?[[:space:]]*:"; then
    cs_covered=1
  fi
  if [ $cs_covered -eq 0 ] && { [ $pj_bumped -eq 0 ] || [ $mp_bumped -eq 0 ]; }; then
    MISSING+=("$plugin (plugin.json bumped: $pj_bumped, marketplace.json bumped: $mp_bumped, bump file staged: 0)")
  fi
done

[ ${#MISSING[@]} -eq 0 ] && exit 0

REASON="BLOCKED: plugin runtime changes need a version bump. Affected:"
for entry in "${MISSING[@]}"; do
  REASON="$REASON
  - $entry"
done
REASON="$REASON

Either stage a bump file (.bumpy/<name>.md or .changeset/<name>.md with <plugin>: patch|minor|major in its frontmatter — \`pnpm exec bumpy add\` or \`pnpm exec oakum add\` writes one) and let the version PR do the bump, or bump \"version\" in plugins/<name>/.claude-plugin/plugin.json AND the matching entry in .claude-plugin/marketplace.json with a CHANGELOG entry. Until the CI cutover, CI still runs bumpy, which cannot see .changeset/ — so \`bumpy add\` is the one that keeps CI green. To bypass this gate, touch .claude/.no-version-gate."

jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}' 2>/dev/null || printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Plugin runtime changes need a version bump in plugin.json AND marketplace.json."}}\n'

exit 0
