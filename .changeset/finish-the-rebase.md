---
review-cycle: patch
---

"Finish the rebase", "continue the merge", "complete the cherry-pick" and "continue the revert" now count as asking for that operation's `--continue`. With your stop-before setting at `commit`, the agent runs the reviewed `--continue` you named instead of asking again whether to commit the resolution. The request covers only the operation you named: it allows no other `--continue`, no plain `git commit` and no push. A "merge" in "continue the merge" is no longer read as a mention of a pull request merge, so it no longer holds the steps after it.
