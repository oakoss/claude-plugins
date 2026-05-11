#!/usr/bin/env bash
# review-cycle: PostToolUse hook (Write|Edit|MultiEdit matcher)
#
# Scans the just-modified file for high-confidence comment-slop patterns
# (section markers, restate-the-code, AI phrasings, hedge prefixes, TODOs
# without ticket). When detected, returns additionalContext for Claude to
# address on the next turn. Does NOT block — the write already happened.
#
# Fail-open on any error. Silent when no slop detected.

source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/gate.sh"

gate_disabled && exit 0

INPUT=$(cat 2>/dev/null || true)

FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$FILE" ] && exit 0
[ ! -f "$FILE" ] && exit 0

# Scope to git-tracked projects (matches the other hooks). Skip orphan files.
PROJECT_ROOT=$(git -C "$(dirname "$FILE")" rev-parse --show-toplevel 2>/dev/null || true)
[ -z "$PROJECT_ROOT" ] && exit 0
gate_project_opted_out "$PROJECT_ROOT" && exit 0

# Skip non-text and uninteresting paths.
case "$FILE" in
  *.lock|*.lockb|*.png|*.jpg|*.jpeg|*.gif|*.webp|*.pdf|*.zip|*.tar|*.gz|*.bin|*.exe|*.so|*.dylib|*.dll|*.wasm)
    exit 0
    ;;
esac
case "$FILE" in
  */node_modules/*|*/.git/*|*/dist/*|*/build/*|*/target/*|*/.next/*|*/.venv/*)
    exit 0
    ;;
esac

# Skip very large files (over 1MB) to keep the hook fast.
FILE_SIZE=$(wc -c < "$FILE" 2>/dev/null | tr -d ' ')
if [ -n "$FILE_SIZE" ] && [ "$FILE_SIZE" -gt 1048576 ]; then
  exit 0
fi

# High-confidence patterns only; borderline cases are left for the cleanup subagent.
FINDINGS=""
add_finding() {
  local label="$1" matches="$2"
  if [ -n "$matches" ]; then
    [ -n "$FINDINGS" ] && FINDINGS+=$'\n\n'
    FINDINGS+="${label}:"$'\n'"${matches}"
  fi
}

add_finding "Section-marker comments (per policy: avoid)" \
  "$(grep -nE '^[[:space:]]*(//|#|--|/\*)[[:space:]]*={3,}' "$FILE" 2>/dev/null | head -3)"

add_finding "Likely restate-the-code comments" \
  "$(grep -nE '^[[:space:]]*(//|#|--)[[:space:]]+(initializes|fetches|creates|validates|downloads|sets|gets|returns|handles|processes|increments|decrements|iterates over)[[:space:]]+' "$FILE" 2>/dev/null | head -3)"

add_finding "AI-flavored comment phrasings" \
  "$(grep -nE '^[[:space:]]*(//|#|--)[[:space:]]+(Here we|Let'\''s|Let us|We can|This (function|method|class|component|module)( does| handles| simply| basically))' "$FILE" 2>/dev/null | head -3)"

add_finding "Hedge-prefix comments (consider rewording or removing)" \
  "$(grep -nE '^[[:space:]]*(//|#|--)[[:space:]]+(Note|Important|NB|FYI):' "$FILE" 2>/dev/null | head -3)"

add_finding "TODO/FIXME without ticket reference" \
  "$(grep -nE '^[[:space:]]*(//|#|--)[[:space:]]+(TODO|FIXME|HACK|XXX)([[:space:]]*:|[[:space:]]+[^#A-Z0-9h])' "$FILE" 2>/dev/null | grep -vE '#[0-9]+|[A-Z]{2,}-[0-9]+|https?://' | head -3)"

add_finding "Hedge words in comments (per policy: avoid 'obviously', 'basically', 'just')" \
  "$(grep -nE '^[[:space:]]*(//|#|--)[[:space:]].*(obviously|basically|essentially|simply|just |actually )' "$FILE" 2>/dev/null | head -3)"

[ -z "$FINDINGS" ] && exit 0

CTX="review-cycle: comment-slop patterns detected in ${FILE}. Per the comment policy, consider removing or rewriting these:"$'\n\n'"${FINDINGS}"

jq -n --arg ctx "$CTX" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}' 2>/dev/null || printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"review-cycle: comment-slop patterns detected; consider cleanup per policy."}}\n'

exit 0
