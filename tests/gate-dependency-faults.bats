#!/usr/bin/env bats
# Fault injection for the review-cycle commit gate and stop gate.
#
# A gate that cannot run must not be indistinguishable from a gate that ran and
# found nothing. Measured 2026-09-17 before the hardening, across the two gates
# that existed then and five fault modes each: twenty of fifty cells produced
# exit 0, no stdout and no stderr -- byte-identical to a genuine pass. jq and
# git were silent in all ten of their cells. That baseline is not reproducible
# here any more; one of the two gates has since been retired.
#
# The fault that prompted this was a jq resolving to a mise shim that could not
# find mise: it printed nothing and exited 0. So exit codes alone are not the
# test; a tool that answers wrongly at exit 0 is the case that matters.
#
# Each test asserts the weakest acceptable outcome: the gate either denies, or
# exits nonzero with stderr naming what broke. Silence is the failure, and
# stderr at exit 0 counts as silence -- it reaches the debug log, not the
# transcript. Which of the two a cell produces is deliberately not asserted:
# blocking is stronger, but fail-open with a visible diagnostic is
# policy-compliant (AGENTS.md: "Fail-open on any error"), and pinning the
# stronger one per cell would make a later safety improvement read as a
# regression.

REPO_ROOT=""
CG=""
CG_PLUGIN_ROOT=""
SG=""

# The ways a dependency breaks. `empty0` is the one that started this and the
# one exit-code checks miss; `liveonly` answers --version and nothing else,
# which is what a liveness probe alone would wave through.
FAULT_MODES=(empty0 exit1 exit127 sigterm absent liveonly)
# Faults that leave git healthy and break only what it says about one root.
# Every mode above breaks git globally, so the liveness branch rejects the shim
# and dep_probe_git's rooted branch never runs -- deleting that branch left the
# whole suite green while the commit gate silently passed an unreviewed tree.
GIT_ROOT_FAULTS=(refuseroot emptytoplevel)
ROOT_FAULT_FLOOR=2
MODE_FLOOR=6

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  CG="$REPO_ROOT/plugins/review-cycle/hooks/commit-gate.sh"
  CG_PLUGIN_ROOT="$REPO_ROOT/plugins/review-cycle"
  SG="$REPO_ROOT/plugins/review-cycle/hooks/stop-gate.sh"

  # HOME is not redirected: a mise-shimmed jq exits 0 with no stdout under an
  # untrusted HOME, injecting this suite's own fault into every cell.
  SHIM_DIR="$BATS_TEST_TMPDIR/shim"
  FIXTURE="$BATS_TEST_TMPDIR/fixture"
  DEP_CHECK="$REPO_ROOT/plugins/review-cycle/hooks/lib/dep-check.sh"
  REAL_GIT="$(command -v git)"
  REAL_GREP="$(command -v grep)"
}

# git answers every liveness question correctly and misanswers one scoped to
# $FIXTURE -- the safe.directory shape, and the only shape the rooted probe
# exists for.
make_git_root_shim() {
  local mode="$1"
  rm -rf "$SHIM_DIR"
  mkdir -p "$SHIM_DIR"
  {
    printf '#!/bin/sh\n'
    printf 'REAL=%s\n' "$REAL_GIT"
    # Both spellings: macOS resolves the fixture to /private/var/..., and root
    # discovery hands the gate that form, so a shim keyed on $FIXTURE alone
    # never intercepts and the cell silently tests real git.
    printf 'FIX=%s\n' "$FIXTURE"
    printf 'FIXP=%s\n' "$(cd "$FIXTURE" && pwd -P)"
    printf 'if [ "$1" = "-C" ] && case "$2" in "$FIX"*|"$FIXP"*) true ;; *) false ;; esac; then\n'
    printf '  for a in "$@"; do\n'
    case "$mode" in
      refuseroot)
        printf '    [ "$a" = "--is-inside-work-tree" ] && { echo false; exit 0; }\n' ;;
      emptytoplevel)
        printf '    [ "$a" = "--show-toplevel" ] && exit 0\n' ;;
      *) echo "unknown root fault: $mode" >&2; return 1 ;;
    esac
    printf '  done\n'
    printf 'fi\n'
    printf 'exec "$REAL" "$@"\n'
  } > "$SHIM_DIR/git"
  chmod +x "$SHIM_DIR/git"
}

# A repo with unreviewed drift and no sentinel mark: the commit gate must deny.
build_cg_fixture() {
  rm -rf "$FIXTURE"
  mkdir -p "$FIXTURE"
  (
    cd "$FIXTURE" || exit 1
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
    git init -q .
    printf 'one\n' > a.txt
    git -c user.name=T -c user.email=t@e.x add -A >/dev/null
    git -c user.name=T -c user.email=t@e.x commit -qm init
    printf 'two\n' > a.txt
  ) || return 1
}

# Drift plus a stale in-progress marker: epoch 1 is outside any TTL, so a
# working clock reaps it and the gate goes on to block.
build_sg_fixture() {
  rm -rf "$FIXTURE"
  mkdir -p "$FIXTURE/.claude/review-cycle"
  (
    cd "$FIXTURE" || exit 1
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
    git init -q .
    printf 'one\n' > a.txt
    git -c user.name=T -c user.email=t@e.x add -A >/dev/null
    git -c user.name=T -c user.email=t@e.x commit -qm init
    printf 'two\n' > a.txt
  ) || return 1
  printf '1\n' > "$FIXTURE/.claude/review-cycle/in-progress"
}

make_shim() {
  local tool="$1" mode="$2"
  rm -rf "$SHIM_DIR"
  mkdir -p "$SHIM_DIR"
  case "$mode" in
    empty0)  printf '#!/bin/sh\nexit 0\n' > "$SHIM_DIR/$tool" ;;
    exit1)   printf '#!/bin/sh\nexit 1\n' > "$SHIM_DIR/$tool" ;;
    exit127) printf '#!/bin/sh\nexit 127\n' > "$SHIM_DIR/$tool" ;;
    sigterm) printf '#!/bin/sh\nkill -TERM $$\n' > "$SHIM_DIR/$tool" ;;
    absent)  printf '#!/bin/sh\necho "%s: command not found" >&2\nexit 127\n' \
               "$tool" > "$SHIM_DIR/$tool" ;;
    liveonly) printf '#!/bin/sh\ncase "$1" in --version) echo "%s version 9.9.9"; exit 0 ;; esac\necho "fatal: refusing" >&2\nexit 128\n' \
               "$tool" > "$SHIM_DIR/$tool" ;;
    *) echo "unknown fault mode: $mode" >&2; return 1 ;;
  esac
  chmod +x "$SHIM_DIR/$tool"
}

clear_shim() { rm -rf "$SHIM_DIR"; }

# Three greps that pass dep_probe_grep and misanswer afterwards. The probe asks
# a five-byte BRE and a fixed absent pattern, so none of these is visible at
# startup: `uniform` reports no match for everything, `ere` misanswers only
# extended regexes -- the mode every verb decision uses -- and `fpat` misanswers
# one fixed pattern, the literal the prefilter asks about.
make_grep_late_shim() {
  local mode="$1"
  rm -rf "$SHIM_DIR"
  mkdir -p "$SHIM_DIR"
  {
    printf '#!/bin/sh\n'
    printf 'REAL=%s\n' "$REAL_GREP"
    # Drained in shell rather than left to close: the writer's broken-pipe
    # notice would take the one stderr line the transcript shows.
    printf 'drain() { while read -r _; do :; done; exit "$1"; }\n'
    printf 'for a in "$@"; do\n'
    printf '  case "$a" in probe|absent-pattern) exec "$REAL" "$@" ;; esac\n'
    case "$mode" in
      uniform) printf 'done\n'; printf 'drain 1\n' ;;
      # Keyed on the pattern, not on the mode: it answers the needle drawn
      # from the haystack correctly and misanswers the one literal the
      # prefilter actually asked about.
      fpat)    printf '  case "$a" in commit) drain 1 ;; esac\n'
               printf 'done\n'
               printf 'exec "$REAL" "$@"\n' ;;
      ere)     printf '  case "$a" in -*E*) drain 1 ;; esac\n'
               printf 'done\n'
               printf 'exec "$REAL" "$@"\n' ;;
      *) echo "unknown late-grep fault: $mode" >&2; return 1 ;;
    esac
  } > "$SHIM_DIR/grep"
  chmod +x "$SHIM_DIR/grep"
}

# DIAGNOSTIC needs a nonzero exit as well as stderr: stderr from a hook exiting
# 0 reaches the debug log only, so it is still silence from the user's side.
#
# The decision is parsed, not grepped: a hook whose stdout is not valid JSON has
# its decision ignored at runtime, so a stray line before the payload loses the
# block while a grep for the token still reports one.
classify() {
  local out="$1" errfile="$2" rc="$3" decision errbytes
  [ -f "$errfile" ] || { echo "classify: missing stderr capture" >&2; return 2; }
  [ -n "$rc" ] || { echo "classify: missing exit status" >&2; return 2; }
  decision=$(printf '%s' "$out" \
    | jq -e -r '.hookSpecificOutput.permissionDecision // .decision // empty' 2>/dev/null) || decision=""
  case "$decision" in
    deny|block) ;;
    *) decision="" ;;
  esac
  errbytes=$(wc -c < "$errfile" | tr -d ' ')
  [ -n "$errbytes" ] || { echo "classify: could not size stderr" >&2; return 2; }
  if [ -n "$decision" ]; then
    printf 'BLOCK\n'
  elif [ "$rc" -ne 0 ] && [ "$errbytes" -gt 0 ]; then
    printf 'DIAGNOSTIC\n'
  elif [ "$rc" -ne 0 ]; then
    # Nonzero with nothing to say: the transcript shows a bare hook-error
    # notice. Not silent, but not usable either, and it fires on correct work.
    printf 'NOISY\n'
  else
    printf 'SILENT\n'
  fi
}

# Stop hooks carry their verdict in a top-level `decision`, not
# hookSpecificOutput, so BLOCK is recognised by a different token.
run_sg() {
  local errfile="$BATS_TEST_TMPDIR/sg.err" out rc=0
  : > "$errfile"
  out=$(printf '{"stop_hook_active":false,"cwd":"%s"}' "$FIXTURE" \
    | PATH="$SHIM_DIR:$PATH" CLAUDE_PROJECT_DIR="$FIXTURE" \
      CLAUDE_PLUGIN_ROOT="${CG_ROOT_OVERRIDE:-$CG_PLUGIN_ROOT}" bash "$SG" 2>"$errfile") || rc=$?
  classify "$out" "$errfile" "$rc"
}

run_cg() {
  local errfile="$BATS_TEST_TMPDIR/cg.err" out rc=0
  : > "$errfile"
  out=$(cd "${PAYLOAD_CWD:-$FIXTURE}" \
    && printf '{"tool_input":{"command":"%s"},"cwd":"%s"}' \
         "${PAYLOAD_CMD:-git commit -m x}" "${PAYLOAD_CWD:-$FIXTURE}" \
    | PATH="$SHIM_DIR:$PATH" CLAUDE_PROJECT_DIR="${CG_PROJECT_DIR-$FIXTURE}" \
      CLAUDE_PLUGIN_ROOT="${CG_ROOT_OVERRIDE:-$CG_PLUGIN_ROOT}" bash "$CG" 2>"$errfile") || rc=$?
  classify "$out" "$errfile" "$rc"
}

run_gate() {
  case "$1" in
    cg)  run_cg  ;;
    sg)  run_sg  ;;
    *) echo "unknown gate: $1" >&2; return 1 ;;
  esac
}

# The state each gate passes through in silence when nothing is wrong.
build_clean_fixture() {
  case "$1" in
    cg|sg)
      build_cg_fixture || return 1
      ( cd "$FIXTURE" && git checkout -q -- . ) || return 1
      ;;
    *) echo "unknown gate: $1" >&2; return 1 ;;
  esac
}

# <gate> <tool>: every fault mode must produce something a user can see.
# A drifting fixture cannot test a guard. The gate denies for drift whether or
# not the guard fired, and BLOCK is an accepted outcome, so the assertion is
# satisfied by the gate's ordinary answer. That was measured 2026-09-19: on a
# drifting fixture, five probes replaced by `return 0` produced zero failures
# and disabling dep_require produced nine. On the clean ground below, measured
# 2026-09-21 on the 31-cell suite, the same two mutations produce 8 and 14.
#
# assert_rooted_probe_bites already avoids this, and is the only fault helper
# that kills its mutant on every row. This follows it: a clean fixture, and a
# SILENT precondition so a run that proves nothing says so rather than passing.
#
# cat keeps the drift fixture. A gate reading an emptied payload on a clean
# tree is correctly silent, so a clean-fixture cat cell would fail on healthy
# code — the guard rejecting correct work, which is worse than no guard.
assert_never_silent() {
  local gate="$1" tool="$2" mode verdict failures="" ground=clean
  [ "${#FAULT_MODES[@]}" -ge "$MODE_FLOOR" ] || {
    echo "fault-mode list collapsed to ${#FAULT_MODES[@]}" >&2
    return 1
  }
  [ "$tool" = cat ] && ground=drift
  if [ "$ground" = clean ]; then
    clear_shim
    build_clean_fixture "$gate" || return 1
    verdict=$(run_gate "$gate")
    [ "$verdict" = "SILENT" ] || {
      echo "$gate: clean fixture is not a quiet pass ($verdict); the rows below prove nothing" >&2
      return 1
    }
  fi
  for mode in "${FAULT_MODES[@]}"; do
    make_shim "$tool" "$mode" || return 1
    if [ "$ground" = clean ]; then
      build_clean_fixture "$gate" || return 1
    else
      case "$gate" in
        cg)  build_cg_fixture  || return 1 ;;
        sg)  build_sg_fixture  || return 1 ;;
        *) echo "unknown gate: $gate" >&2; return 1 ;;
      esac
    fi
    verdict=$(run_gate "$gate")
    clear_shim
    [ -n "$verdict" ] || { echo "$gate/$tool/$mode: classifier returned nothing" >&2; return 1; }
    case "$verdict" in
      BLOCK|DIAGNOSTIC) ;;
      *) failures="$failures $mode=$verdict" ;;
    esac
  done
  if [ -n "$failures" ]; then
    echo "$gate gate gave no usable answer with a broken $tool:$failures" >&2
    return 1
  fi
}

@test "the global kill-switch is not masking these tests" {
  # With it present every gate exits 0 and every test below would pass while
  # checking nothing.
  [ ! -f "$HOME/.claude/.disable-review-gate" ]
}

@test "the fault-mode enumeration has not collapsed" {
  [ "${#FAULT_MODES[@]}" -ge "$MODE_FLOOR" ]
  local mode
  for mode in "${FAULT_MODES[@]}"; do
    make_shim probe "$mode"
    [ -x "$SHIM_DIR/probe" ]
    clear_shim
  done
}

@test "commit gate denies when its condition is genuinely met" {
  clear_shim
  build_cg_fixture
  [ "$(run_cg)" = "BLOCK" ]
}

@test "the classifier reports SILENT when a gate says nothing" {
  # Guards the guard: a classifier that never returns SILENT would make every
  # test below pass while checking nothing.
  local errfile="$BATS_TEST_TMPDIR/empty.err"
  : > "$errfile"
  [ "$(classify "" "$errfile" 0)" = "SILENT" ]
  printf 'something\n' > "$errfile"
  # stderr alone is not visibility: only a nonzero exit surfaces it.
  [ "$(classify "" "$errfile" 0)" = "SILENT" ]
  [ "$(classify "" "$errfile" 1)" = "DIAGNOSTIC" ]
  : > "$errfile"
  # Nonzero with no stderr is its own failure: it fires on correct work.
  [ "$(classify "" "$errfile" 1)" = "NOISY" ]
  [ "$(classify '{"hookSpecificOutput":{"permissionDecision":"deny"}}' "$errfile" 0)" = "BLOCK" ]
  [ "$(classify '{"decision":"block"}' "$errfile" 0)" = "BLOCK" ]
  # Malformed stdout loses its decision at runtime, so it is not a block.
  [ "$(classify 'oops {"hookSpecificOutput":{"permissionDecision":"deny"}}' "$errfile" 0)" != "BLOCK" ]
}

@test "commit gate never allows silently with a broken cat" {
  assert_never_silent cg cat
}

@test "stop gate never allows silently with a broken cat" {
  assert_never_silent sg cat
}

@test "commit gate never allows silently with a broken jq" {
  assert_never_silent cg jq
}

@test "commit gate never allows silently with a broken git" {
  assert_never_silent cg git
}

@test "commit gate never allows silently with a broken grep" {
  assert_never_silent cg grep
}

@test "commit gate never allows silently with a broken sed" {
  assert_never_silent cg sed
}

@test "commit gate never allows silently with a broken awk" {
  assert_never_silent cg awk
}

@test "a JSON-escaped verb is gated exactly like the literal" {
  # \u0063ommit decodes to commit only after jq, so a prefilter reading raw
  # payload bytes would drop a real commit. The backslash is built here rather
  # than written inline because printf's format string would expand it.
  clear_shim
  local bs escaped errfile out rc=0
  bs='\'
  errfile="$BATS_TEST_TMPDIR/esc.err"

  build_cg_fixture
  escaped="{\"tool_input\":{\"command\":\"git ${bs}u0063ommit -m x\"},\"cwd\":\"$FIXTURE\"}"
  case "$escaped" in
    *commit*) echo "payload still carries the literal; test proves nothing" >&2; return 1 ;;
  esac
  : > "$errfile"
  out=$(printf '%s' "$escaped" \
    | CLAUDE_PROJECT_DIR="$FIXTURE" CLAUDE_PLUGIN_ROOT="$CG_PLUGIN_ROOT" \
      bash "$CG" 2>"$errfile") || rc=$?
  [ "$(classify "$out" "$errfile" "$rc")" = "BLOCK" ]

}

@test "commit gate still passes quietly on a reviewed tree" {
  clear_shim
  build_cg_fixture
  (cd "$FIXTURE" && git checkout -q -- a.txt) || true
  [ "$(run_cg)" = "SILENT" ]
}

@test "stop gate never allows silently with a broken jq" {
  assert_never_silent sg jq
}

@test "stop gate never allows silently with a broken git" {
  assert_never_silent sg git
}

@test "stop gate never allows silently with a broken date" {
  # gate_marker_is_stale treats a missing clock as "marker still fresh", which
  # holds the gate open for as long as the marker exists.
  assert_never_silent sg date
}

@test "stop gate never allows silently with a broken tr" {
  assert_never_silent sg tr
}

@test "commit gate never allows silently with a broken tr" {
  assert_never_silent cg tr
}

@test "stop gate never allows silently with a broken sed" {
  assert_never_silent sg sed
}

@test "commit gate never allows silently with a broken sort" {
  assert_never_silent cg sort
}

@test "stop gate never allows silently with a broken sort" {
  assert_never_silent sg sort
}

@test "stop gate never allows silently with a broken grep" {
  assert_never_silent sg grep
}

# A clean fixture, deliberately: on a drifting tree the gate denies for drift
# and the rooted probe contributes nothing, so the cell would pass with the
# probe deleted. Here a healthy git must be SILENT, which is what makes the
# fault rows mean something.
assert_rooted_probe_bites() {
  local gate="$1" mode verdict failures=""
  [ "${#GIT_ROOT_FAULTS[@]}" -ge "$ROOT_FAULT_FLOOR" ] || {
    echo "root-fault list collapsed to ${#GIT_ROOT_FAULTS[@]}" >&2
    return 1
  }
  clear_shim
  build_clean_fixture "$gate" || return 1
  verdict=$(run_gate "$gate")
  [ "$verdict" = "SILENT" ] || {
    echo "$gate: clean fixture is not a quiet pass ($verdict); the rows below prove nothing" >&2
    return 1
  }
  local where
  for mode in "${GIT_ROOT_FAULTS[@]}"; do
    for where in root subdir; do
      make_git_root_shim "$mode" || return 1
      build_clean_fixture "$gate" || return 1
      mkdir -p "$FIXTURE/sub"
      case "$where" in
        root)   PAYLOAD_CWD="$FIXTURE" ;;
        subdir) PAYLOAD_CWD="$FIXTURE/sub" ;;
      esac
      # Empty, not unset: CLAUDE_PROJECT_DIR would hand the gate its root for
      # free, and root discovery through git is the path being tested.
      verdict=$(PAYLOAD_CWD="$PAYLOAD_CWD" CG_PROJECT_DIR="" run_gate "$gate")
      clear_shim
      unset PAYLOAD_CWD
      case "$verdict" in
        BLOCK|DIAGNOSTIC) ;;
        *) failures="$failures $mode/$where=$verdict" ;;
      esac
    done
  done
  [ -z "$failures" ] || {
    echo "$gate gave no usable answer when git refused the root:$failures" >&2
    return 1
  }
}

# review-sentinel decides both commit-time verdicts and is reached by absolute
# path, so the fault has to be planted in a copy of the plugin root rather than
# on PATH. Modes where it fails to RUN only; a sentinel that runs and lies needs
# a known-answer probe, which it has no verb for yet.
SENTINEL_FAULTS=(absent exit127 sigterm exit9)

make_sentinel_shim() {
  local mode="$1" bin
  rm -rf "$BATS_TEST_TMPDIR/pr"
  cp -R "$CG_PLUGIN_ROOT" "$BATS_TEST_TMPDIR/pr" || return 1
  bin="$BATS_TEST_TMPDIR/pr/bin/review-sentinel"
  case "$mode" in
    absent)  rm -f "$bin"; return 0 ;;
    exit127) printf '#!/bin/sh\nexit 127\n' > "$bin" ;;
    sigterm) printf '#!/bin/sh\nkill -TERM $$\n' > "$bin" ;;
    exit9)   printf '#!/bin/sh\nexit 9\n' > "$bin" ;;
    *) echo "unknown sentinel fault: $mode" >&2; return 1 ;;
  esac
  chmod +x "$bin"
}

assert_sentinel_faults_bite() {
  local gate="$1" mode verdict failures=""
  [ "${#SENTINEL_FAULTS[@]}" -ge 4 ] || {
    echo "sentinel-fault list collapsed to ${#SENTINEL_FAULTS[@]}" >&2
    return 1
  }
  clear_shim
  for mode in "${SENTINEL_FAULTS[@]}"; do
    build_cg_fixture || return 1
    make_sentinel_shim "$mode" || return 1
    verdict=$(CG_ROOT_OVERRIDE="$BATS_TEST_TMPDIR/pr" run_gate "$gate")
    case "$verdict" in
      BLOCK|DIAGNOSTIC) ;;
      *) failures="$failures $mode=$verdict" ;;
    esac
  done
  [ -z "$failures" ] || {
    echo "$gate gave no usable answer with a review-sentinel that cannot run:$failures" >&2
    return 1
  }
}

@test "commit gate reports a review-sentinel that cannot run" {
  assert_sentinel_faults_bite cg
}

# Only the commit gate reads a command; the Stop gate is handed no command
# to parse, so it has no exposure to this fault.
build_ground() {
  local gate="$1" ground="$2"
  [ "$ground" = clean ] && { build_clean_fixture "$gate"; return; }
  case "$gate" in
    cg)  build_cg_fixture  ;;
    *) echo "unknown gate: $gate" >&2; return 1 ;;
  esac
}

# \u0063ommit decodes to the verb only after jq, so the raw bytes carry no
# literal for a fallback to match. Built here rather than written inline
# because printf's format string would expand the escape.
escaped_verb_payload() {
  local bs='\'
  printf 'git %su0063ommit -m x' "$bs"
}

# A command the prefilter's backslash arm admits and that is not a commit. The
# doubled backslash is the JSON escape; it decodes to one.
backslash_noncommit_payload() {
  local bs='\'
  printf 'echo a%s%stb' "$bs" "$bs"
}

# fault:ground:payload. Clean ground wherever it works: a fault row can only
# mean something when the healthy verdict differs from the faulted one, and on
# a drifting tree both were BLOCK until the gate learned to stand down. Rows
# that killed no mutant are gone -- measured, an over-matching grep on drifting
# ground is unfalsifiable by construction, because it can turn a pass into a
# block but never a block into a pass.
#
# escaped rides the drifting row: it is the only coverage anywhere in the repo
# for the fallback's backslash arm, and there it is a real commit being waved
# through rather than a quiet pass that was correct anyway. backslash is its
# opposite number -- an ordinary command carrying a backslash, which the same
# arm admits and which must therefore become visibly noisy, not silently denied.
LATE_GREP_ROWS=(
  uniform:clean:literal
  uniform:clean:backslash
  uniform:drift:escaped
  ere:clean:literal
  ere:clean:unbalanced
  fpat:clean:literal
)
LATE_ROW_FLOOR=6

assert_late_grep_bites() {
  local gate="$1" row fault ground shape cmd verdict failures=""
  [ "${#LATE_GREP_ROWS[@]}" -ge "$LATE_ROW_FLOOR" ] || {
    echo "late-grep row list collapsed to ${#LATE_GREP_ROWS[@]}" >&2
    return 1
  }
  # The count protects the number of rows, not which ones. This row is the
  # repo's only coverage for the fallback prefilter's backslash arm, so an
  # edit that swaps it for another keeps the floor satisfied and drops it.
  case " ${LATE_GREP_ROWS[*]} " in
    *" uniform:drift:escaped "*) ;;
    *) echo "late-grep rows no longer cover uniform:drift:escaped" >&2; return 1 ;;
  esac
  for row in "${LATE_GREP_ROWS[@]}"; do
    fault="${row%%:*}"; shape="${row##*:}"
    ground="${row#*:}"; ground="${ground%%:*}"
    cmd=""
    case "$shape" in
      escaped) cmd=$(escaped_verb_payload) ;;
      backslash) cmd=$(backslash_noncommit_payload) ;;
      # An unterminated quote leaves the lexer unable to build a skeleton, so
      # the raw view answers alone -- a path that returns straight out of
      # parse_grep_verb, making its confirmation the only one on duty. An
      # unclosed subshell does not do this: measured, parse_strip_text still
      # exits 0 for it, and the shell-exec confirmation covers that route.
      unbalanced) cmd="git commit -m 'x" ;;
    esac

    clear_shim
    build_ground "$gate" "$ground" || return 1
    verdict=$(PAYLOAD_CMD="$cmd" run_gate "$gate")
    case "$ground/$verdict" in
      clean/SILENT|drift/BLOCK) ;;
      *)
        echo "$gate/$row: healthy grep gives $verdict; the row below proves nothing" >&2
        return 1 ;;
    esac

    make_grep_late_shim "$fault" || return 1
    # Without this the cell silently becomes a startup test: a shim that fails
    # the probe drops DEPS_OK at line one, and the diagnostic that follows has
    # nothing to do with the late failure the row is named for.
    PATH="$SHIM_DIR:$PATH" bash -c "source '$DEP_CHECK'; dep_probe_grep" </dev/null || {
      echo "$gate/$row: the shim fails dep_probe_grep, so this tests startup, not late failure" >&2
      clear_shim
      return 1
    }
    build_ground "$gate" "$ground" || return 1
    verdict=$(PAYLOAD_CMD="$cmd" run_gate "$gate")
    clear_shim
    # DIAGNOSTIC only. A BLOCK here would be the gate ruling on the very
    # question it just reported it could not answer.
    case "$verdict" in
      DIAGNOSTIC)
        # The one line the transcript shows has to send the user to the tool
        # that is actually broken; blaming another costs them the remedy.
        head -1 "$BATS_TEST_TMPDIR/$gate.err" | grep -q grep \
          || failures="$failures $row=diagnostic-does-not-name-grep" ;;
      *) failures="$failures $row=$verdict" ;;
    esac
  done
  [ -z "$failures" ] || {
    echo "$gate did not stand down on a grep that passed its probe and broke after:$failures" >&2
    return 1
  }
}

@test "commit gate reports a grep that breaks after its probe" {
  assert_late_grep_bites cg
}

@test "the commit gate stays quiet on a non-commit that clears the payload prefilter" {
  # The arm that exits 0 on a confirmed miss. Deleting it once left every cell
  # green while turning each prefilter-clearing Bash call into a deny on a tree
  # with work pending.
  clear_shim
  local verdict
  build_cg_fixture || return 1
  verdict=$(PAYLOAD_CMD='git log -p commit' run_cg)
  [ "$verdict" = "SILENT" ] || { echo "cg answered $verdict" >&2; return 1; }
}

@test "commit gate reports a git that refuses its own root" {
  assert_rooted_probe_bites cg
}

# Every tool a gate declares must have a cell here, and every cell must name a
# tool the gate declares. The mode list has a floor; without this the COLUMNS
# had none -- which is how the Stop gate's sed went uncovered and how a probe
# that no caller passes went unnoticed.
# Tools reached through dep_require. Each needs a probe, and an unknown name
# there is not a stray to filter out: dep_require answers "no probe defined"
# and the gate then fails on every call.
dep_require_tools() {
  grep -oE 'dep_require "\$GATE_NAME"[^|]*' "$1" \
    | sed 's/dep_require "\$GATE_NAME"//' \
    | tr ' ' '\n' \
    | sed 's/"//g; s/:.*//' \
    | grep -E '^[a-z][a-z-]*$' \
    | sort -u
}

# Plus the tools a gate checks inline rather than through dep_require -- jq is
# verified on the call that does the work, and names itself in its own report.
declared_tools() {
  local src="$1"
  {
    dep_require_tools "$src"
    grep -oE 'dep_report_broken "\$GATE_NAME" [a-z][a-z-]*' "$src" | awk '{print $3}'
  } | grep -E '^[a-z][a-z-]*$' | sort -u
}

covered_tools() {
  local suite="$BATS_TEST_DIRNAME/gate-dependency-faults.bats"
  {
    grep -oE "assert_never_silent $1 [a-z][a-z-]*" "$suite" | awk '{print $3}'
    # Covered by its own test, because it is not reachable through PATH.
    grep -qE "assert_sentinel_faults_bite $1\$" "$suite" && echo review-sentinel
  } | sort -u
}

@test "every dependency a gate declares has a cell, and every cell a declaration" {
  local gate src declared covered missing extra tool floor
  for gate in cg sg; do
    case "$gate" in
      cg)  src="$CG" ;;
      sg)  src="$SG" ;;
    esac
    declared=$(declared_tools "$src")
    [ -n "$declared" ] || { echo "$gate: no dep_require declarations found" >&2; return 1; }
    # Wrapping a dep_require across lines, or renaming GATE_NAME, reduces the
    # parse to a handful of names. Without a floor that reads as cells gone
    # stray; with one it reads as what it is.
    floor=6
    [ "$(printf '%s\n' "$declared" | wc -l | tr -d ' ')" -ge "$floor" ] || {
      echo "$gate declares only $(printf '%s\n' "$declared" | tr '\n' ' ')— the source parse probably broke" >&2
      return 1
    }
    for tool in $(dep_require_tools "$src"); do
      grep -qE "^dep_probe_$tool\(\)" "$DEP_CHECK" || {
        echo "$gate declares $tool but dep-check.sh has no dep_probe_$tool" >&2
        return 1
      }
    done
    covered=$(covered_tools "$gate")
    [ -n "$covered" ] || { echo "$gate: no cells found" >&2; return 1; }

    # cat is read by builtin redirection rather than declared, but it precedes
    # every probe, so it is covered deliberately and is not a stray cell.
    missing=$(comm -23 <(printf '%s\n' "$declared") <(printf '%s\n' "$covered") | tr '\n' ' ')
    extra=$(comm -13 <(printf '%s\n' "$declared") <(printf '%s\n' "$covered") \
      | grep -v '^cat$' | tr '\n' ' ')
    if [ -n "${missing// /}" ]; then
      echo "$gate declares these with no cell: $missing" >&2
      return 1
    fi
    if [ -n "${extra// /}" ]; then
      echo "$gate has cells for tools it never declares: $extra" >&2
      return 1
    fi
  done
}

@test "declared_tools reads a dep_require line the way the gates write one" {
  local snippet="$BATS_TEST_TMPDIR/snippet.sh"
  {
    printf 'GATE_NAME="x"\n'
    printf 'dep_require "$GATE_NAME" grep git awk sed tr sort || DEPS_OK=0\n'
    printf 'dep_require "$GATE_NAME" "git:$ROOT" || DEPS_OK=0\n'
    # date appears ONLY in rooted form: git does not isolate the `:` strip,
    # because the plain line above supplies it either way.
    printf 'dep_require "$GATE_NAME" "date:$ROOT" || DEPS_OK=0\n'
    printf 'dep_report_broken "$GATE_NAME" jq "known-answer probe failed"\n'
  } > "$snippet"
  [ "$(declared_tools "$snippet" | tr '\n' ' ')" = "awk date git grep jq sed sort tr " ]
  [ "$(dep_require_tools "$snippet" | tr '\n' ' ')" = "awk date git grep sed sort tr " ]
}

@test "a broken jq does not read as an opt-out" {
  # gate_project_opted_out used to trust `jq -e`'s status, so a jq stuck at
  # exit 0 answered yes to every test and stood every gate down on a project
  # that never opted out.
  clear_shim
  build_cg_fixture
  mkdir -p "$FIXTURE/.claude"
  printf '{"disabled": false}\n' > "$FIXTURE/.claude/review-cycle.json"
  make_shim jq empty0

  run env PATH="$SHIM_DIR:$PATH" bash -c \
    "set -e; . '$CG_PLUGIN_ROOT/hooks/lib/gate.sh'; gate_project_opted_out '$FIXTURE'"
  clear_shim
  # Nonzero means "not opted out", which is the truth here.
  [ "$status" -ne 0 ]
}

@test "the commit gate announces a lib it cannot load" {
  # The path can be wrong at runtime -- a plugin-cache install, a worktree, a
  # partial checkout -- where a CI check on the repo's own copy sees nothing.
  clear_shim
  build_cg_fixture
  local errfile="$BATS_TEST_TMPDIR/lib.err" out rc=0
  : > "$errfile"
  # The gate exits 1 here by design, which set -e would otherwise read as the
  # test failing rather than as the behaviour under test.
  out=$(printf '{"tool_input":{"command":"git commit -m x"},"cwd":"%s"}' "$FIXTURE" \
    | CLAUDE_PROJECT_DIR="$FIXTURE" CLAUDE_PLUGIN_ROOT="$BATS_TEST_TMPDIR/nonexistent" \
      bash "$CG" 2>"$errfile") || rc=$?
  [ "$rc" -ne 2 ]
  [ "$(classify "$out" "$errfile" "$rc")" != "SILENT" ]
}

@test "a broken dependency names itself in the diagnostic" {
  # Only the first line of stderr reaches the transcript, so the tool has to be
  # named there rather than in a later line.
  clear_shim
  build_cg_fixture
  make_shim git empty0
  local errfile="$BATS_TEST_TMPDIR/name.err" first rc=0
  : > "$errfile"
  printf '{"tool_input":{"command":"git commit -m x"},"cwd":"%s"}' "$FIXTURE" \
    | PATH="$SHIM_DIR:$PATH" CLAUDE_PROJECT_DIR="$FIXTURE" \
      CLAUDE_PLUGIN_ROOT="$CG_PLUGIN_ROOT" bash "$CG" >/dev/null 2>"$errfile" || rc=$?
  [ "$rc" -ne 2 ]
  clear_shim
  first=$(head -1 "$errfile")
  [ -n "$first" ]
  case "$first" in
    *git*) ;;
    *) echo "first stderr line does not name git: $first" >&2; return 1 ;;
  esac
}
