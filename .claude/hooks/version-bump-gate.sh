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
# Fail-open on any error — the commit proceeds. A gate that could not run
# says so by exiting 1, a non-blocking error whose first stderr line reaches
# the transcript; exit 0 is reserved for user-legible states.

GATE_NAME="version-bump-gate"
# shellcheck disable=SC2034  # read by dep_report_broken in lib/dep-check.sh
DEP_CONSEQUENCE="this gate did NOT run, so the commit was not checked for a version bump"

# Builtin redirection, not `cat`: the payload is read before the prefilter
# and before every probe, so an unprobed cat emptied INPUT and every gate
# exited 0 in silence. A PATH fault that breaks jq breaks cat first.
INPUT=$(</dev/stdin)

# Drain stdin before this: a gate that exits without reading leaves its writer's
# first write with no reader, and a writer that checks (jq does) reports a broken
# pipe where the caller sees it. Measured 5/5, at any payload size.
#
# Still ahead of the prefilter and the source loop, which can both fail loudly.
[ -f "$HOME/.claude/.disable-review-gate" ] && exit 0

# Fires on every Bash call, so a broken dependency must not be reported on
# commands it would never act on. parse_has_commit reads the JSON-DECODED
# command, so a backslash here may encode the verb (\u0063ommit) and cannot be
# ruled out from the raw bytes; only a payload with neither is provably not one.
case "$INPUT" in
  *commit*|*\\*) ;;
  *) exit 0 ;;
esac

# Shared with the review-cycle commit gate, so both move together. A path wrong
# at runtime is invisible to a CI check on the repo's own copy.
HOOK_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/plugins/review-cycle/hooks/lib"
for lib in command-parse.sh dep-check.sh; do
  # shellcheck source=/dev/null
  source "$HOOK_LIB/$lib" 2>/dev/null || {
    printf '%s: cannot load %s from %s — this gate did NOT run, so the commit was not checked for a version bump.\n' \
      "$GATE_NAME" "$lib" "$HOOK_LIB" >&2
    exit 1
  }
done

# A truncated lib sources at exit 0 with its helpers undefined; the missing
# emitter then fails as a command-not-found and the final exit 0 runs. Sourcing
# cleanly is not the same as loading.
for fn in dep_require dep_exit_pass emit_checked emit_deny parse_has_commit; do
  type "$fn" >/dev/null 2>&1 || {
    printf '%s: %s undefined after loading libs from %s — this gate did NOT run, so the commit was not checked for a version bump.\n' \
      "$GATE_NAME" "$fn" "$HOOK_LIB" >&2
    exit 1
  }
done

DEPS_OK=1
# command-parse.sh, which every decision routes through, is awk, sed, grep
# and tr; declaring only jq/grep/git left three real dependencies unprobed.
dep_require "$GATE_NAME" grep git awk sed tr || DEPS_OK=0

# jq answers a known question on the call that does the work: a separate probe
# says nothing about the next invocation, and this is the one the gate acts on.
# Saves a mise-shim exec per Bash call too (measured 107ms). -sR reads stdin as
# a raw string so the program always runs, which is what separates a broken jq
# (no token) from a payload that is not JSON (token, notjson) -- a jq that
# rejects bad input is working. cwd rides the token line, so only the command
# can span lines and the split below cannot shift. tostring keeps a non-string
# cwd from pretty-printing; a cwd containing a newline is discarded rather than
# truncated, which the gate already handles -- it drops any cwd that is not an
# absolute path.
JQ_OUT=$(echo "$INPUT" | jq -sRr '((try fromjson catch null) | if type == "object" then . else null end) as $o
  | (($o.cwd? // "") | tostring) as $c
  | "_probe_ok:" + (if $o == null then "notjson" else "json:" + (if ($c | index("\n")) then "" else $c end) end),
    ($o.tool_input?.command? // "")' 2>/dev/null)
COMMAND=""
INPUT_CWD=""
case "$JQ_OUT" in
  # Command substitution strips the trailing newline, so an empty command
  # leaves the token line alone. Treating that as a broken jq blamed a healthy
  # one and, in the commit gate, denied a call that was never a commit.
  "_probe_ok:json:"*)
    JQ_REST="${JQ_OUT#_probe_ok:json:}"
    case "$JQ_REST" in
      *$'\n'*) INPUT_CWD="${JQ_REST%%$'\n'*}"; COMMAND="${JQ_REST#*$'\n'}" ;;
      *)       INPUT_CWD="$JQ_REST" ;;
    esac
    ;;
  "_probe_ok:notjson"*) dep_report_bad_payload "$GATE_NAME"; DEPS_OK=0 ;;
  *) dep_report_broken "$GATE_NAME" jq "known-answer probe failed"; DEPS_OK=0 ;;
esac


# With a broken dependency the short-circuit below cannot be trusted: a dead jq
# empties COMMAND and a grep stuck at 1 reports no match, both of which read as
# "not a commit". Fall back to the raw payload -- but to the LITERAL only. The
# prefilter's other arm admits any command carrying a double quote, and gating
# on that denied ordinary Bash calls that were never commits, which a broken jq
# then made unclearable because /review and /accept need the same jq.
if [ "$DEPS_OK" -eq 1 ]; then
  parse_has_commit "$COMMAND" || exit 0
else
  case "$INPUT" in
    *commit*) ;;
    *) exit 0 ;;
  esac
fi

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

if [ -z "$PROJECT_ROOT" ]; then
  # Root discovery runs through git, so a git that will not answer empties this
  # exactly as a directory holding no repository would.
  dep_require_git_upward "$GATE_NAME" "$CD_CANDIDATE" "$INPUT_CWD" || DEPS_OK=0
  dep_exit_pass
fi
# A broken dependency can make this the wrong repository, so neither answer
# below is the user-legible state exit 0 is reserved for.
[ -f "$PROJECT_ROOT/.claude/.no-version-gate" ] && dep_exit_pass
[ -f "$PROJECT_ROOT/.claude-plugin/marketplace.json" ] || dep_exit_pass

# Skipped once a probe has already failed: its diagnostic is out, and only the
# first line of stderr reaches the transcript.
if [ "$DEPS_OK" -eq 1 ]; then
  dep_require "$GATE_NAME" "git:$PROJECT_ROOT" || exit 1
fi

# Empty means "nothing staged" when git answered. A locked or corrupt index,
# and a safe.directory refusal, produce the same empty string.
STAGED_RC=0
STAGED=$(cd "$PROJECT_ROOT" && git diff --cached --name-only) || STAGED_RC=$?
if [ "$STAGED_RC" -ne 0 ]; then
  printf '%s: git diff --cached failed (rc=%s) in %s — this gate did NOT run, so the commit was not checked for a version bump.\n' \
    "$GATE_NAME" "$STAGED_RC" "$PROJECT_ROOT" >&2
  exit 1
fi
if [ -z "$STAGED" ]; then
  # --quiet exits 1 when there ARE staged changes, so a git that emptied the
  # list at exit 0 contradicts itself here rather than reading as nothing.
  (cd "$PROJECT_ROOT" && git diff --cached --quiet) \
    || { dep_report_broken "$GATE_NAME" git "empty staged list while the index reports changes"; DEPS_OK=0; }
  dep_exit_pass
fi

AFFECTED=()
while IFS= read -r path; do
  case "$path" in
    plugins/*/*) ;;
    *) continue ;;
  esac
  # Parameter expansion, not sed: a dead sed emptied every plugin name here,
  # and the loop below read that as "no plugin affected".
  plugin=${path#plugins/}
  plugin=${plugin%%/*}
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

[ ${#AFFECTED[@]} -eq 0 ] && dep_exit_pass

# The same question the greps below ask, answered without grep: one stuck at 0
# says yes to all three and waves the commit through, and merely being staged
# is not a version change -- a manifest staged for any other reason satisfied it.
version_line_added() {
  local diff_out line
  diff_out=$(cd "$PROJECT_ROOT" && git diff --cached -- "$1" 2>/dev/null) || return 1
  [ -n "$diff_out" ] || return 1
  while IFS= read -r line; do
    case "$line" in
      +*'"version"'*:*) return 0 ;;
    esac
  done <<< "$diff_out"
  return 1
}

# The grep below asks whether a staged bump file names THIS plugin; a confirmer
# that only asks whether some bump file is staged is a weaker question, so an
# unrelated changeset plus a stuck grep read as covered.
bump_file_names_plugin() {
  local diff_out line want="$1"
  diff_out=$(cd "$PROJECT_ROOT" && git diff --cached -- ':(glob).changeset/*.md' \
    ':(exclude,icase).changeset/README.md' ':(exclude).changeset/AGENTS.md' \
    ':(exclude).changeset/CLAUDE.md' ':(exclude).changeset/GEMINI.md' 2>/dev/null) || return 1
  [ -n "$diff_out" ] || return 1
  while IFS= read -r line; do
    case "$line" in
      +*"$want"*:*) return 0 ;;
    esac
  done <<< "$diff_out"
  return 1
}

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
  # lands later in the version PR. The frontmatter name is matched bare and
  # quoted even though only the bare form is valid — oakum refuses a quoted
  # unscoped name outright, so a quoted entry must read as covered here and
  # fail loudly at `oakum check` rather than be silently missed by this gate.
  #
  # The excluded names are oakum's own skip list: it ignores README.md in any
  # case and AGENTS/CLAUDE/GEMINI.md exactly, so a bump entry written into one
  # covers nothing — and it skips them silently, exit 0. :(glob) keeps `*` from
  # crossing `/`, because oakum reads no nested change file.
  cs_covered=0
  if cd "$PROJECT_ROOT" && git diff --cached -- ':(glob).changeset/*.md' \
       ':(exclude,icase).changeset/README.md' ':(exclude).changeset/AGENTS.md' \
       ':(exclude).changeset/CLAUDE.md' ':(exclude).changeset/GEMINI.md' 2>/dev/null \
       | grep -qE "^\+[[:space:]]*[\"']?${plugin}[\"']?[[:space:]]*:"; then
    cs_covered=1
  fi
  # All three answers above come from a grep; one stuck at 0 says yes to every
  # one and waves the commit through in silence. Each is re-confirmed below by
  # scanning the staged diff with bash patterns, no grep involved.
  version_line_added "$pj_path" || pj_bumped=0
  version_line_added ".claude-plugin/marketplace.json" || mp_bumped=0
  bump_file_names_plugin "$plugin" || cs_covered=0

  if [ $cs_covered -eq 0 ] && { [ $pj_bumped -eq 0 ] || [ $mp_bumped -eq 0 ]; }; then
    MISSING+=("$plugin (plugin.json bumped: $pj_bumped, marketplace.json bumped: $mp_bumped, bump file staged: 0)")
  fi
done

[ ${#MISSING[@]} -eq 0 ] && dep_exit_pass

REASON="BLOCKED: plugin runtime changes need a version bump. Affected:"
for entry in "${MISSING[@]}"; do
  REASON="$REASON
  - $entry"
done
REASON="$REASON

Either stage a bump file (.changeset/<name>.md with <plugin>: patch|minor|major in its frontmatter — \`pnpm exec oakum add\` writes one) and let the version PR do the bump, or bump \"version\" in plugins/<name>/.claude-plugin/plugin.json AND the matching entry in .claude-plugin/marketplace.json with a CHANGELOG entry. To bypass this gate, touch .claude/.no-version-gate."

DENY_JSON=$(jq -n --arg reason "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}' 2>/dev/null)
emit_deny "$DENY_JSON" 'Plugin runtime changes need a version bump in plugin.json AND marketplace.json.'

exit 0
