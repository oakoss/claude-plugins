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

# Prose is the de-slopify/cleanup lens's job, and '#' is a heading there,
# not a comment — the pattern greps below would false-positive on it.
case "$FILE" in
  *.md|*.markdown|*.txt|*.rst|*.adoc)
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

# Comment-density check on the text just written. Narrating WHAT-comments
# mostly dodge the pattern greps (any verb, any phrasing), but they can't
# dodge arithmetic: a code edit where a third of the lines are comments is
# slop with rare exceptions. Comment-carried config formats are exempt —
# '#' is documentation there, not slop.
case "$FILE" in
  *.yml|*.yaml|*.toml|*.ini|*.cfg|*.conf) ;;
  *)
    # tr strips NUL bytes from payloads — bash >= 4.4 warns on NULs in
    # command substitution.
    NEW_TEXT=$(echo "$INPUT" | jq -r '
      .tool_input.content
      // .tool_input.new_string
      // ((.tool_input.edits // []) | map(.new_string // "") | join("\n"))' 2>/dev/null | tr -d '\0')
    # A Write payload is the whole file, not an edit — a legitimate header
    # comment block would read as slop density. Skip the shebang and the
    # leading run of comment/blank lines before counting, for the Write
    # shape only. The awk alternation must match the density grep below;
    # a looser pattern here strips real code (#include) from the
    # denominator and produces garbage ratios.
    if echo "$INPUT" | jq -e '.tool_input.content' >/dev/null 2>&1; then
      NEW_TEXT=$(printf '%s\n' "$NEW_TEXT" \
        | awk 'body {print; next}
               NR==1 && /^[[:space:]]*#!/ {next}
               $0 !~ /^[[:space:]]*(\/\/|#([[:space:]]|$)|--([[:space:]]|\[|$)|\/\*|\*([[:space:]]|\/|$))/ && NF {body=1; print}')
    fi
    if [ -n "$NEW_TEXT" ]; then
      # grep -c prints the 0 itself on no match (while exiting 1), so no
      # fallback echo; tr guards against a hard grep failure leaving junk.
      TOTAL_LINES=$(printf '%s\n' "$NEW_TEXT" | grep -c . 2>/dev/null | tr -cd '0-9')
      # The star, '#', and '--' alternatives require whitespace or EOL
      # after them ('/' too for star, '[' too for Lua's --[[), so comments
      # count but C dereferences (*p = 1;), #include directives,
      # #[attributes], shebangs, and --i; statements do not.
      COMMENT_LINES=$(printf '%s\n' "$NEW_TEXT" | grep -cE '^[[:space:]]*(//|#([[:space:]]|$)|--([[:space:]]|\[|$)|/\*|\*([[:space:]]|/|$))' 2>/dev/null | tr -cd '0-9')
      [ -n "$TOTAL_LINES" ] || TOTAL_LINES=0
      [ -n "$COMMENT_LINES" ] || COMMENT_LINES=0
      if [ "$COMMENT_LINES" -ge 4 ] && [ "$TOTAL_LINES" -gt 0 ] \
         && [ $((COMMENT_LINES * 100 / TOTAL_LINES)) -ge 30 ]; then
        add_finding "High comment density in this edit" \
          "${COMMENT_LINES} of ${TOTAL_LINES} written lines are comments. Per the comment policy most WHAT-comments must be removed; keep only those stating a non-obvious WHY."
      fi
    fi
    ;;
esac

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

add_finding "History-flavored comments (describe the current invariant; the before/after story belongs in the commit message)" \
  "$(grep -inE '^[[:space:]]*(//|#|--)[[:space:]].*(previously|formerly|used to be |no longer |renamed from |as it did (while|when|before)|after (the|this) (refactor|review|migration|change))' "$FILE" 2>/dev/null | head -3)"

[ -z "$FINDINGS" ] && exit 0

CTX="review-cycle: comment slop detected in ${FILE}. Fix it NOW with a follow-up Edit, before continuing with the task — the comment policy is mandatory, not advisory. Remove every comment that restates WHAT the code does; keep a comment only when it states a non-obvious WHY the code cannot express, and compress kept comments to one or two lines — consequences the reader can derive, backstory, and before/after history go in the commit message, not the code. Do not wait to be asked."$'\n\n'"${FINDINGS}"

jq -n --arg ctx "$CTX" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}' 2>/dev/null || printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"review-cycle: comment slop detected; remove WHAT-comments now per the comment policy."}}\n'

exit 0
