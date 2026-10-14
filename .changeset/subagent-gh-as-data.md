---
review-cycle: patch
---

A subagent command that names `gh` without running it is no longer refused as a pull request step. The gate read `gh` followed by any word as a gh call, so `for c in none gh docs`, `which gh go` and `[ -x /usr/local/bin/gh ]` stopped review subagents with "subagents do not commit, push, open, merge…". Now `which`, `type`, `whereis`, `test` and `[` count as data for both the gh check and the commit check, so `type git commit` is no longer refused either. For the gh check, `[[` and a `for` or `select` loop's `in` list count as data too, and so does any of them after `if`, `while`, `!` or `do`, as in `if [ -x /usr/local/bin/gh ]; then`. A gh call in a loop's body, in zsh's `for x (a b) gh …` short form, or after `&&` is still judged.
