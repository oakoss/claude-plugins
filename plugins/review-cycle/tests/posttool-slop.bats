#!/usr/bin/env bats
# posttool-slop hook: pattern greps, comment-density arithmetic across the
# three tool payload shapes, prose exemption, and the silent exit paths.

setup() {
  load 'helpers'
  setup_repo
}

# Runs the hook with a payload for $1 (file path). Payload content defaults
# to the file's bytes (the Write shape); pass explicit JSON as $2 to test
# the Edit/MultiEdit shapes.
run_slop_hook() {
  local file="$1" payload="${2:-}"
  if [ -z "$payload" ]; then
    payload=$(jq -n --arg fp "$file" --rawfile c "$file" '{tool_input:{file_path:$fp, content:$c}}')
  fi
  CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$PLUGIN_ROOT/hooks/posttool-slop.sh" <<< "$payload"
}

write_lines() {
  local file="$1"; shift
  printf '%s\n' "$@" > "$file"
}

# --- silent exit paths ---

@test "silent on a clean code file" {
  write_lines f.ts "const a = 1;" "export function f() {" "  return a;" "}"
  run run_slop_hook "$TEST_REPO/f.ts"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "silent when payload has no file_path" {
  run bash -c "CLAUDE_PLUGIN_ROOT='$PLUGIN_ROOT' bash '$PLUGIN_ROOT/hooks/posttool-slop.sh' <<< '{}'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "silent when kill-switch active" {
  touch "$HOME/.claude/.disable-review-gate"
  write_lines f.ts "// ===== HELPERS ====="
  run run_slop_hook "$TEST_REPO/f.ts"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "silent when project opted out" {
  mkdir -p "$TEST_REPO/.claude"
  touch "$TEST_REPO/.claude/.no-review-gate"
  write_lines f.ts "// ===== HELPERS ====="
  run run_slop_hook "$TEST_REPO/f.ts"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "silent for a file outside any git repo" {
  mkdir -p "$BATS_TEST_TMPDIR/notarepo"
  write_lines "$BATS_TEST_TMPDIR/notarepo/f.ts" "// ===== HELPERS ====="
  run run_slop_hook "$BATS_TEST_TMPDIR/notarepo/f.ts"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "silent for excluded paths (node_modules)" {
  mkdir -p "$TEST_REPO/node_modules/pkg"
  write_lines "$TEST_REPO/node_modules/pkg/f.ts" "// ===== HELPERS ====="
  run run_slop_hook "$TEST_REPO/node_modules/pkg/f.ts"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "prose files are skipped entirely (a '# Note:' heading is not slop)" {
  write_lines doc.md "# Note: installation" "Some text." "## Previously released" "More text." "# TODO list" "text" "text" "text"
  run run_slop_hook "$TEST_REPO/doc.md"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# --- pattern greps ---

@test "flags section-marker comments" {
  write_lines f.ts "// ===== HELPERS =====" "const a = 1;"
  run run_slop_hook "$TEST_REPO/f.ts"
  [[ "$output" == *"Section-marker"* ]]
}

@test "flags restate-the-code comments" {
  write_lines f.ts "// fetches the user record" "const u = get();"
  run run_slop_hook "$TEST_REPO/f.ts"
  [[ "$output" == *"restate-the-code"* ]]
}

@test "flags AI-flavored phrasings" {
  write_lines f.ts "// Here we set up the listener" "listen();"
  run run_slop_hook "$TEST_REPO/f.ts"
  [[ "$output" == *"AI-flavored"* ]]
}

@test "flags Note:-prefix comments" {
  write_lines f.ts "// Note: this is called twice" "f();"
  run run_slop_hook "$TEST_REPO/f.ts"
  [[ "$output" == *"Hedge-prefix"* ]]
}

@test "flags ticketless TODOs but not ticketed ones" {
  write_lines f.ts "// TODO: tighten this later" "const a = 1;"
  run run_slop_hook "$TEST_REPO/f.ts"
  [[ "$output" == *"TODO/FIXME without ticket"* ]]
  write_lines g.ts "// TODO(ABC-123): tighten this later" "const a = 1;"
  run run_slop_hook "$TEST_REPO/g.ts"
  [[ "$output" != *"TODO/FIXME without ticket"* ]]
}

@test "flags history-flavored comments, capitalized included" {
  write_lines f.ts "// failing loudly as it did while the value was sensitive" "const a = 1;"
  run run_slop_hook "$TEST_REPO/f.ts"
  [[ "$output" == *"History-flavored"* ]]
  write_lines g.ts "// this field is no longer read by the client" "const a = 1;"
  run run_slop_hook "$TEST_REPO/g.ts"
  [[ "$output" == *"History-flavored"* ]]
  write_lines h.ts "// Previously this used a lock." "const a = 1;"
  run run_slop_hook "$TEST_REPO/h.ts"
  [[ "$output" == *"History-flavored"* ]]
  write_lines i.ts "// This map is used to store open handles" "const a = 1;"
  run run_slop_hook "$TEST_REPO/i.ts"
  [[ "$output" != *"History-flavored"* ]]
}

# --- density check ---
# Density comments use neutral wording so no pattern grep also fires.

@test "density fires on interleaved narration after the first code line (Write)" {
  write_lines f.ts \
    "const a = 1;" "// alpha beta" "const b = 2;" \
    "// gamma delta" "const c = 3;" "const d = 4;" \
    "// epsilon zeta" "const e = 5;" "const g = 6;" \
    "// eta theta" "const h = 7;" "const i = 8;"
  run run_slop_hook "$TEST_REPO/f.ts"
  [ "$status" -eq 0 ]
  [[ "$output" == *"High comment density"* ]]
  [[ "$output" == *"4 of 12"* ]]
}

@test "a leading header comment block on a Write does not trigger density" {
  write_lines f.ts \
    "// module overview alpha" "// beta gamma constraints" "// delta epsilon" "// zeta eta" \
    "const a = 1;" "const b = 2;" "const c = 3;" "const d = 4;"
  run run_slop_hook "$TEST_REPO/f.ts"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "density silent below the line-count floor (3 comments of 6)" {
  write_lines f.ts "// alpha" "const a = 1;" "// beta" "const b = 2;" "// gamma" "const c = 3;"
  run run_slop_hook "$TEST_REPO/f.ts"
  [ -z "$output" ]
}

@test "density silent below the ratio floor (4 comments of 20)" {
  {
    printf '%s\n' "// alpha" "// beta" "// gamma" "// delta"
    for i in $(seq 1 16); do echo "const v$i = $i;"; done
  } > "$TEST_REPO/f.ts"
  run run_slop_hook "$TEST_REPO/f.ts"
  [ -z "$output" ]
}

@test "density reads the Edit payload's new_string, not the file" {
  write_lines f.ts "const a = 1;"
  NEW=$'// alpha\n// beta\n// gamma\n// delta\nconst a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;'
  PAYLOAD=$(jq -n --arg fp "$TEST_REPO/f.ts" --arg ns "$NEW" '{tool_input:{file_path:$fp, new_string:$ns}}')
  run run_slop_hook "$TEST_REPO/f.ts" "$PAYLOAD"
  [[ "$output" == *"High comment density"* ]]
  [[ "$output" == *"4 of 8"* ]]
}

@test "density aggregates MultiEdit edits[].new_string" {
  write_lines f.ts "const a = 1;"
  PAYLOAD=$(jq -n --arg fp "$TEST_REPO/f.ts" '{tool_input:{file_path:$fp, edits:[
    {new_string:"// alpha\n// beta\nconst a = 1;\nconst b = 2;"},
    {new_string:"// gamma\n// delta\nconst c = 3;\nconst d = 4;"}
  ]}}')
  run run_slop_hook "$TEST_REPO/f.ts" "$PAYLOAD"
  [[ "$output" == *"High comment density"* ]]
  [[ "$output" == *"4 of 8"* ]]
}

@test "density does not count pointer-dereference lines as comments" {
  write_lines f.c "*p = 1;" "*q = 2;" "*r = 3;" "*s = 4;" "int a = 1;" "int b = 2;" "int c = 3;" "int d = 4;"
  run run_slop_hook "$TEST_REPO/f.c"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "density counts block-comment continuation lines when not a leading header" {
  write_lines f.c "int x;" "/* doc" " * alpha" " * beta" " */" "int a;" "int b;" "int c;"
  run run_slop_hook "$TEST_REPO/f.c"
  [[ "$output" == *"High comment density"* ]]
  [[ "$output" == *"4 of 8"* ]]
}

@test "density counts hash comments; shebang and directives do not count" {
  write_lines f.sh '#!/bin/sh' "cmd0" "# alpha" "# beta" "# gamma" "# delta" "cmd1" "cmd2" "cmd3"
  run run_slop_hook "$TEST_REPO/f.sh"
  [[ "$output" == *"High comment density"* ]]
  [[ "$output" == *"4 of 8"* ]]
}

@test "header exemption strips comments only, never preprocessor directives" {
  write_lines f2.c "#include <a.h>" "#include <b.h>" "#include <c.h>" "#include <d.h>" "#include <e.h>" "#include <f.h>" \
    "// alpha" "// beta" "// gamma" "// delta" \
    "int a;" "int b;" "int c;" "int d;" "int e;" "int f;" "int g;" "int h;"
  run run_slop_hook "$TEST_REPO/f2.c"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "preprocessor directives and Rust attributes do not count as comments" {
  write_lines f.c "#include <stdio.h>" "#include <stdlib.h>" "#include <string.h>" "#include <math.h>" \
    "int main(void) {" "  return 0;" "}"
  run run_slop_hook "$TEST_REPO/f.c"
  [ -z "$output" ]
  write_lines g.rs '#[derive(Debug)]' '#[serde(rename_all = "camelCase")]' '#[derive(Clone)]' '#[allow(dead_code)]' \
    "struct S {" "  a: u32," "}"
  run run_slop_hook "$TEST_REPO/g.rs"
  [ -z "$output" ]
}

@test "density exempts comment-carried config formats (yaml)" {
  write_lines conf.yml "# alpha" "# beta" "# gamma" "# delta" "key: 1" "other: 2"
  run run_slop_hook "$TEST_REPO/conf.yml"
  [ -z "$output" ]
}

# --- output contract ---

@test "output is valid hookSpecificOutput JSON with a directive" {
  write_lines f.ts "// ===== HELPERS =====" "const a = 1;"
  run run_slop_hook "$TEST_REPO/f.ts"
  CTX=$(echo "$output" | jq -r '.hookSpecificOutput.additionalContext')
  [ -n "$CTX" ]
  [[ "$CTX" == *"Fix it NOW"* ]]
  [ "$(echo "$output" | jq -r '.hookSpecificOutput.hookEventName')" = "PostToolUse" ]
}
