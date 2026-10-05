---
pr-watch: patch
---

A merged pull request's line now names the branch it merged into, `#140 merged into main · ● CI`, while that branch's checks run, pass or fail. Before, it read `#140 merged · ● CI`, which looked like the pull request's own checks still running; only the passed and waiting lines named the branch, and they now read `✓ checks passed` and `○ waiting on checks` after the same lead.
