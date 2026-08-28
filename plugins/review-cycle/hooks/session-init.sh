#!/usr/bin/env bash
# review-cycle: SessionStart hook
#
# Re-seeds the sentinel on fresh session starts. The rule:
#
#   - Sentinel missing                  → seed (first install: treat WIP as
#                                         "already reviewed" to avoid gating
#                                         pre-existing changes)
#   - Sentinel matches current state    → seed (idempotent; advances the
#                                         stored anchor forward to current
#                                         HEAD so the diff window stays small)
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

SENTINEL_FILE="$PROJECT_ROOT/$GATE_STATE_DIR/mark"
REVIEW_SENTINEL="${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel"

# One-time move of pre-0.16 state files into the state directory, ahead of
# everything that reads them. When both layouts hold a file the directory
# wins and the stray legacy copy stays behind — harmless, both layouts sit
# in the sentinel's exclude list. Fail-open: a failed move leaves the gate
# reading the new layout, and the message says so.
for PAIR in ".review-mark:mark" ".review-in-progress:in-progress" \
            ".review-pr-in-progress:pr-in-progress" ".review-stop-block:stop-block"; do
  OLD="$PROJECT_ROOT/.claude/${PAIR%%:*}"
  NEW="$PROJECT_ROOT/$GATE_STATE_DIR/${PAIR##*:}"
  [ -f "$OLD" ] || continue
  [ -e "$NEW" ] && continue
  if ! mkdir -p "$PROJECT_ROOT/$GATE_STATE_DIR" 2>/dev/null; then
    echo "review-cycle: cannot create $GATE_STATE_DIR; pre-0.16 state files were not migrated. The gates read the new layout, so run /review-cycle:review or /review-cycle:accept if a gate result surprises the user this session."
    break
  fi
  mv "$OLD" "$NEW" 2>/dev/null \
    || echo "review-cycle: could not migrate .claude/${PAIR%%:*} to $GATE_STATE_DIR/${PAIR##*:}; if a gate result surprises the user this session, this is why."
done

# Revoke an abandoned cycle's marker. This sits above the re-seed decision
# because that decision skips seeding exactly when the sentinel disagrees — the
# unreviewed-drift case — and above the legacy branch's own exit for the same
# reason. Stale-only: `startup` also fires when a second session opens while
# the first is mid-cycle, and its Phase 8 still needs that marker.
for STALE_MARKER in in-progress pr-in-progress; do
  [ -f "$PROJECT_ROOT/$GATE_STATE_DIR/$STALE_MARKER" ] || continue
  gate_marker_is_stale "$PROJECT_ROOT/$GATE_STATE_DIR/$STALE_MARKER" || continue
  # The reason has to travel inline: this hook's stdout is what reaches the
  # model, while rm writes to stderr, which nothing here reads.
  RM_ERR=$(/bin/rm -f "$PROJECT_ROOT/$GATE_STATE_DIR/$STALE_MARKER" 2>&1)
  [ ! -e "$PROJECT_ROOT/$GATE_STATE_DIR/$STALE_MARKER" ] \
    || echo "review-cycle: a stale $GATE_STATE_DIR/$STALE_MARKER could not be removed (${RM_ERR:-no error reported}). While it exists it holds the Stop gate open, and in-progress additionally lets \`review-sentinel mark\` treat it as evidence of a review. Raise this only if the user hits an unexpected gate result this session."
done

# SessionStart stdout lands in the model's context, not in front of the
# user, so this is capability information for the model — explicitly not a
# nag to relay. "Installed" needs evidence of wiring, not merely the helper
# file: on the pre-commit/simple-git-hooks paths install-hook only prints a
# snippet, so an un-referenced helper enforces nothing and must not silence
# the note. Called on every startup exit path, including legacy-sentinel
# migration.
emit_install_hook_note() {
  local wired=0 hooks_dir cfg
  hooks_dir=$(git -C "$PROJECT_ROOT" rev-parse --git-path hooks 2>/dev/null)
  case "$hooks_dir" in
    /*) ;;
    *) hooks_dir="$PROJECT_ROOT/$hooks_dir" ;;
  esac
  grep -qsF '>>> review-cycle gate >>>' "$hooks_dir/pre-commit" && wired=1
  if [ "$wired" -eq 0 ] && [ -f "$PROJECT_ROOT/.claude/review-cycle-pre-commit.sh" ]; then
    for cfg in lefthook.yml lefthook.yaml .lefthook.yml .lefthook.yaml .pre-commit-config.yaml package.json; do
      if grep -qsF 'review-cycle-pre-commit.sh' "$PROJECT_ROOT/$cfg"; then
        wired=1
        break
      fi
    done
  fi
  if [ "$wired" -eq 0 ]; then
    echo "review-cycle: commit-time git hook not installed in this repo. If the user asks for deeper enforcement, \"\${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel\" install-hook adds an agent-only pre-commit check (humans are never gated). Do not suggest it unprompted."
  fi
}

# Report rather than swallow: a failed re-seed leaves the previous session's
# mark in place, so the gate's verdict this session is not the one the rest of
# the startup path assumes.
run_seed() {
  "$REVIEW_SENTINEL" --root "$PROJECT_ROOT" seed >/dev/null && return 0
  echo "review-cycle: re-seeding the sentinel failed (exit $?); the previous session's mark is unchanged. Diagnose with \"\${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel\" status. Raise this only if the user hits an unexpected gate result this session."
}

# Computes the 0.5.x-format hash (bare 64-hex, no prefix) for migration only.
compute_legacy_hash() {
  local root="$1" sha
  if command -v sha256sum >/dev/null 2>&1; then
    sha="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    sha="shasum -a 256"
  else
    return 1
  fi
  (cd "$root" && {
    git status --porcelain --untracked-files=all \
      ':(exclude).claude/.review-mark' \
      ':(exclude,glob).claude/review-cycle/**' \
      ':(exclude).claude/.no-review-gate' 2>/dev/null
    git diff --cached --binary \
      ':(exclude).claude/.review-mark' \
      ':(exclude,glob).claude/review-cycle/**' \
      ':(exclude).claude/.no-review-gate' 2>/dev/null
    git diff --binary \
      ':(exclude).claude/.review-mark' \
      ':(exclude,glob).claude/review-cycle/**' \
      ':(exclude).claude/.no-review-gate' 2>/dev/null
    git ls-files --others --exclude-standard \
      ':(exclude).claude/.review-mark' \
      ':(exclude,glob).claude/review-cycle/**' \
      ':(exclude).claude/.no-review-gate' 2>/dev/null \
      | while IFS= read -r f; do
          printf '\n--UNTRACKED:%s--\n' "$f"
          [ -f "$f" ] && cat -- "$f" 2>/dev/null
        done
  } | $sha 2>/dev/null | cut -d' ' -f1)
}

# One-time migration from any pre-0.6.0 sentinel format. Neither the 0.5.0
# (bare hex) nor the 0.5.1 (`sha256:`-prefixed) format carries an anchor SHA,
# so they can't be compared with the 0.6.0 anchor-aware check. Without this
# branch, every user upgrading mid-WIP would be gated on next session start.
#
# Lossless: if the legacy hash matches current state, re-seed in 0.6.0 format.
# If not, the user has unreviewed drift; leave the old sentinel so the gate
# fires (the new parser treats single-line sentinels as malformed = drift).
if [ -f "$SENTINEL_FILE" ]; then
  FIRST_LINE=$(sed -n '1p' "$SENTINEL_FILE" 2>/dev/null | tr -d '[:space:]')
  STORED_BARE=""
  if [[ "$FIRST_LINE" =~ ^sha256:([a-f0-9]{64})$ ]]; then
    STORED_BARE="${BASH_REMATCH[1]}"
  elif [[ "$FIRST_LINE" =~ ^([a-f0-9]{64})$ ]]; then
    STORED_BARE="${BASH_REMATCH[1]}"
  fi
  if [ -n "$STORED_BARE" ]; then
    CURRENT_BARE=$(compute_legacy_hash "$PROJECT_ROOT")
    if [ $? -ne 0 ] || [ -z "$CURRENT_BARE" ]; then
      echo "review-sentinel: legacy hash computation failed; skipping 0.5.x → 0.6.0 migration (no sha256sum/shasum?). Run /review-cycle:review or /review-cycle:accept to clear the gate." >&2
    elif [ "$CURRENT_BARE" = "$STORED_BARE" ]; then
      run_seed
    fi
    emit_install_hook_note
    exit 0
  fi
fi

# Strict re-seed: only when sentinel is missing (first install, adopt WIP)
# or when the sentinel still matches current state (idempotent refresh, which
# advances the anchor to current HEAD so the diff window stays small).
# Uses `match` rather than `check` to bypass the clean-tree fast-path; a
# transient stash/checkout shouldn't absorb prior drift.
if [ ! -f "$SENTINEL_FILE" ]; then
  run_seed
elif "$REVIEW_SENTINEL" --root "$PROJECT_ROOT" match >/dev/null 2>&1; then
  run_seed
fi

emit_install_hook_note
exit 0
