#!/usr/bin/env bash
# review-cycle: Stop hook
#
# Blocks Claude from finishing a turn if uncommitted-and-unreviewed changes
# exist. Tells Claude to invoke /review-cycle:review. Fail-open on any error.
#
# Two release valves keep the block from degrading into ceremony:
#
#   - A fresh .claude/review-cycle/in-progress marker (written by the review
#     cycle at fan-out) lets the turn end while background reviewers run,
#     so their completion notifications can re-wake the agent instead of
#     the agent burning wall-clock on sleep loops. A stale marker (crashed
#     cycle, older than the TTL) is removed and ignored.
#   - The gate blocks once per drift state. The state hash it blocked on
#     is recorded; a later stop on the identical state soft-passes with a
#     warning instead of re-blocking, so a user-directed "review later"
#     cannot hard-loop. The commit gate still blocks unreviewed commits —
#     this only relaxes WHEN review happens, never WHETHER.

GATE_NAME="review-cycle stop-gate"
# shellcheck disable=SC2034  # read by dep_report_broken in lib/dep-check.sh
DEP_CONSEQUENCE="this gate did NOT run, so unreviewed changes were not detected"

# Builtin redirection, not `cat`: one less PATH-resolved dependency ahead of
# every probe.
INPUT=$(</dev/stdin)

# Drain stdin before this: a gate that exits without reading leaves its writer's
# first write with no reader, and a writer that checks (jq does) reports a broken
# pipe where the caller sees it. Measured 5/5, at any payload size.
#
# Still ahead of the prefilter and the source loop, which can both fail loudly.
# gate_disabled repeats it once gate.sh is loaded.
[ -f "$HOME/.claude/.disable-review-gate" ] && exit 0

# An unreadable lib leaves gate_should_run undefined, which reads downstream as
# "no project to guard" and lets every turn end unreviewed.
for lib in gate.sh dep-check.sh; do
  # shellcheck source=/dev/null
  source "${CLAUDE_PLUGIN_ROOT}/hooks/lib/$lib" 2>/dev/null || {
    printf '%s: cannot load %s from %s — this gate did NOT run, so unreviewed changes were not detected.\n' \
      "$GATE_NAME" "$lib" "${CLAUDE_PLUGIN_ROOT}/hooks/lib" >&2
    exit 1
  }
done

# A truncated lib sources at exit 0 with its helpers undefined; the missing
# emitter then fails as a command-not-found and the final exit 0 runs. Sourcing
# cleanly is not the same as loading.
for fn in dep_require dep_exit_pass emit_checked gate_disabled gate_should_run \
          gate_marker_is_stale; do
  type "$fn" >/dev/null 2>&1 || {
    printf '%s: %s undefined after loading libs from %s — this gate did NOT run, so unreviewed changes were not detected.\n' \
      "$GATE_NAME" "$fn" "${CLAUDE_PLUGIN_ROOT}/hooks/lib" >&2
    exit 1
  }
done

gate_disabled && exit 0


DEPS_OK=1
# gate.sh reaches the clock through sed, tr and date; a dead date makes an
# in-progress marker look fresh forever. sort and grep decide this gate's
# verdict inside review-sentinel's staged_divergence, silently when misanswered.
dep_require "$GATE_NAME" git sed tr date sort grep || DEPS_OK=0

# Belt-and-suspenders reentrancy; the sentinel-based gate below is primary.
# Keyed on the answer, not on jq's status: a jq whose only defect is `-e`
# semantics passes every probe and stands this gate down in silence.
REENTRANT=$(echo "$INPUT" | jq -sRr '((try fromjson catch null) | if type == "object" then . else null end) as $o
  | "_probe_ok:" + (if $o == null then "notjson" else ($o.stop_hook_active? // false | tostring) end)' 2>/dev/null)
case "$REENTRANT" in
  _probe_ok:true) dep_exit_pass ;;
  _probe_ok:false) ;;
  _probe_ok:notjson) dep_report_bad_payload "$GATE_NAME"; DEPS_OK=0 ;;
  *) dep_report_broken "$GATE_NAME" jq "known-answer probe failed"; DEPS_OK=0 ;;
esac

PROJECT_ROOT=$(gate_should_run) || dep_exit_pass

STOP_RECORD="$PROJECT_ROOT/$GATE_STATE_DIR/stop-block"

# Either cycle marker lets a turn end: /review's, and /review-pr's, which
# reviews a PR head in a throwaway worktree. Only the former licenses `mark`
# (see marker_for in bin/review-sentinel) — the Stop gate does not care which
# tree is under review, but the sentinel does.
for MARKER in in-progress pr-in-progress; do
  [ -f "$PROJECT_ROOT/$GATE_STATE_DIR/$MARKER" ] || continue
  MARKER_RC=0
  gate_marker_is_stale "$PROJECT_ROOT/$GATE_STATE_DIR/$MARKER" || MARKER_RC=$?
  if [ "$MARKER_RC" -eq 2 ]; then
    dep_report_broken "$GATE_NAME" date "clock unreadable while timing $MARKER"
    # shellcheck disable=SC2034  # read by dep_exit_pass in lib/dep-check.sh
    DEPS_OK=0
  fi
  [ "$MARKER_RC" -eq 0 ] || dep_exit_pass
  # Stale or unreadable marker: a crashed cycle must not hold the gate open.
  # A failed removal is deliberately ignored — the check above re-reaps on the
  # next stop regardless.
  /bin/rm -f "$PROJECT_ROOT/$GATE_STATE_DIR/$MARKER" 2>/dev/null
done

"${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$PROJECT_ROOT" check
RC=$?
if [ "$RC" -eq 0 ]; then
  # Clean or reviewed: the recorded blocked-state is resolved, so the next
  # drift gets a fresh block.
  /bin/rm -f "$STOP_RECORD" 2>/dev/null
  dep_exit_pass
fi
[ "$RC" -eq 2 ] && dep_exit_pass  # sentinel read error: fail-open

# RC=1 → drift.
CURRENT=$("${CLAUDE_PLUGIN_ROOT}/bin/review-sentinel" --root "$PROJECT_ROOT" current-hash 2>/dev/null)
# An empty CURRENT (near-impossible: the check computed the same hash) must
# not degrade block-once into the hard loop the reason text promises can't
# happen — a fallback token keeps the second stop soft-passing.
[ -n "$CURRENT" ] || CURRENT="unknown-state"
# Builtin redirection for the same reason the payload read uses it: a broken
# cat empties the record and the comparison never matches, degrading block-once
# the same way.
if [ -f "$STOP_RECORD" ] && [ "$(<"$STOP_RECORD")" = "$CURRENT" ]; then
  SOFT_JSON=$(jq -n '{systemMessage:"review-cycle: unreviewed changes (already prompted for this state; commit gate still active)"}' 2>/dev/null)
  emit_checked "$SOFT_JSON" '"systemMessage"' \
    '{"systemMessage":"review-cycle: unreviewed changes (already prompted for this state; commit gate still active)"}'
  exit 0
fi

# Record the state being blocked so the same state is not re-blocked. The
# one path that still re-blocks every stop is an unwritable state dir.
mkdir -p "$PROJECT_ROOT/$GATE_STATE_DIR" 2>/dev/null
printf '%s\n' "$CURRENT" > "$STOP_RECORD" 2>/dev/null || true

# Stop hook output schema does NOT support hookSpecificOutput — directive
# content goes in the top-level `reason` field.
BLOCK_JSON=$(jq -n '{
  decision: "block",
  reason: "BLOCKED: There are uncommitted changes that have not been reviewed. Invoke /review-cycle:review now (or /review-cycle:accept if the user already reviewed these changes themselves). This gate blocks once per state, so stopping again without reviewing is allowed in exactly two cases: the user explicitly asked to defer review, or you have just presented these changes with a review-or-accept choice and their answer is still pending — launching the cycle then preempts a decision that is theirs. The commit gate still prevents unreviewed commits. Do not commit; the user is the final reviewer.",
  systemMessage: "review-cycle: changes unreviewed"
}' 2>/dev/null)
emit_checked "$BLOCK_JSON" '"block"' \
  '{"decision":"block","reason":"Uncommitted changes have not been reviewed. Run /review-cycle:review.","systemMessage":"review-cycle: changes unreviewed"}'

exit 0
