---
review-cycle: patch
---

### Aliases are checked from the first command of a session

The gate used to read your shell aliases only from Claude Code's shell snapshot, which Claude Code writes only once a session's first Bash command has run. Until then, an aliased commit or push (`gcam "msg"`, `gp`) went unchecked, and every session opened with a note saying the aliases could not be read.

The gate now reads the aliases itself when the session starts, the same way Claude Code builds its snapshot: `CLAUDE_CODE_SHELL`, else `$SHELL`, whichever names zsh or bash, else zsh, run as a login shell sourcing `~/.zshrc` or `~/.bashrc` with no input and `CLAUDECODE=1` set, then listing them with the same pipeline the snapshot uses; with no rc file there are no aliases, as in the snapshot. On a large zsh setup this took about 190 ms and returned the same 238 aliases as the snapshot. If the read fails, takes more than ten seconds, or the rc file never gets to the end of it, the gate falls back to the snapshot as before.

Reading alias values is also more exact: zsh's quoting of a value that ends in a quote, a tab inside a value, and a value bash prints across several lines are now read as the shell reads them.

### An alias after `time -p` is expanded

bash reads the word after `time -p` as a command, so an alias there runs. The gate now expands it too: `time -p gcam "msg"` is judged as the commit it is, where before it passed unchecked. A reserved word such as `time` or `then` now counts only where the shell reads it as one, so `echo time gcam` no longer expands `gcam`.
