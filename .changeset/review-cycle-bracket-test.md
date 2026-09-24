---
review-cycle: patch
---

### `[ … ]` beside a commit, push or pull no longer reads as a glob

The commit gate refused a command such as `git pull --ff-only && [ -z "$x" ]` as "a command name the shell would expand": it treated any `[` or `{` in a word as the start of a pattern. The shell starts a bracket or brace pattern only when an unquoted `]` or `}` closes it in the same word, so a lone `[`, the test command, is an ordinary word. The gate now reads it that way, and `[ … ]` is judged exactly like `test …`. Words such as `[g]it` or `{a,b}.ts` are still patterns and still refused where they were.

zsh's extended-glob characters now count as patterns too: `#`, `^`, and `~` inside a word. Under `setopt extendedglob`, `git{#` or `g#it` expands to `git`, so a command name or git subcommand using them is refused. Arguments such as `HEAD^` and `HEAD~1` are unaffected.
