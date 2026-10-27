---
review-cycle: patch
---

The Monitor tool now refuses `gh stack rebase` and points it to the Bash tool, where the gate checks it. The command rewrites commits, and Monitor ran it with no check while the Bash tool judged it as history.
