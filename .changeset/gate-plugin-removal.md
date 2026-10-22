---
review-cycle: patch
---

The commit gate now refuses only a `claude plugin` removal that reaches review-cycle: one naming `review-cycle` (in any `@marketplace` form and any letter case, as the CLI matches it), the marketplace it was installed from, no plugin or `--all`, or a name only the shell resolves, such as a variable or a glob. It used to refuse every `claude plugin disable`, `uninstall`, `remove` or `rm`, and every marketplace removal, whatever plugin they named, and `--help` too, all with the same "switched on and off only by the user" answer. Removing another plugin and asking for a removal command's help now run. The check reads the command both as typed and through your shell aliases, so an alias for `claude plugin uninstall` is caught and an alias renaming a command the check knows (`sed=gsed`) does not slip past it. When review-cycle runs from a directory (`--plugin-dir`), so its marketplace is unknown, every marketplace removal is still refused.
