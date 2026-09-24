---
review-cycle: patch
---

The commit gate no longer refuses three kinds of ordinary command.

- `git merge-base`, `git merge-tree` and `git merge-file` no longer count as a `git merge`. A command like `git diff $(git merge-base main HEAD)`, or a script that mentions one, used to be refused. None of them makes a commit.
- The settings guard no longer refuses a Bash command just because it writes something and names a switch key, such as `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test … > out.log`, or a Python heredoc that mentions `enabledPlugins`. The only case that rule covered was writing a switch into a shell rc file, which is a deliberate evasion outside what the gate guards against.
- The plugin-CLI check now reads only the verb after `claude plugin` or `claude plugin marketplace`. Before, `claude --plugin-dir ./plugins/review-cycle -p "remove the dead code"` was refused because the prompt contains "remove".

The gate still refuses `claude plugin disable`, `uninstall` or `remove`, a marketplace removal, and a write to a Claude `settings…` file.
