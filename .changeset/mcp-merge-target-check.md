---
review-cycle: patch
---

A merge through the GitHub MCP tool now gets the same model check as `gh pr merge` when the answer offering the merge only mentioned another pull request. Before, after an answer that offered a merge and mentioned release PR #52 in passing, "ok, lets merge" let `gh pr merge` run but refused the same merge through the MCP tool.
