---
review-cycle: patch
---

Replies that pick among offered merges now work in two more shapes. A branch name in parentheses beside a pull request, as in "Merge #277 (`fix/x`) and #278 (`test/y`)?", is read as a label when it starts with a conventional prefix such as `fix/` or `feat/`, so "yes" or "merge both" covers both pull requests rather than only the first. A closing whose last line tells you what to type, such as 'Say "merge 277", "merge 278", or both.', offers its merges to a pick: "merge both", "merge them", "merge only 277" and "merge 277 but not 278" work, while a bare "yes" still names no option. A note that holds a pull request, such as "(do not merge yet)", still keeps a yes from granting it, and a menu with an option that is not a merge, or one inside an example the agent quotes or indents, offers nothing to pick.
