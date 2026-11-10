---
pr-watch: patch
---

A cancelled run now reads as cancelled, not failed: the line shows `✗ CI cancelled` and Claude is told "CI was cancelled". When a merge commit's run was cancelled because a later commit on the branch started its own run of the same workflow, as happens when a second pull request merges seconds after the first, the merged pull request's line follows that later run, running or finished, and Claude is told nothing of the cancellation; it reads `✓ checks passed on a later commit` once that run passes. Before, pr-watch reported the cancellation as "CI failed (cancelled)" and woke Claude about a failure that never happened. In a fail-fast matrix, where GitHub cancels a failed job's siblings, the line now names the job that failed rather than a cancelled sibling, and Claude's message links that job's log.
