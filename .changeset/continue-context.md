---
review-cycle: patch
---

More ways of asking to finish a rebase, cherry-pick or revert now count as asking for its `--continue`: "continue with the rebase", "finish up the rebase", "carry on with the cherry-pick", "continue rebasing" and "resume the revert" name the operation the way "finish the rebase" does. A merge still needs "finish the merge", "continue the merge" or "complete the merge", because "continue merging" or "resume the merge" usually means pull requests and keeps holding the steps after it. A short "continue", "ok continue", "go on", "carry on" or "keep going" answers the agent's offer to finish an operation and grants that `--continue` alone. After any other offer, or with no offer, it grants nothing, since it usually means keep working. A request or offer that names its branch ("Should I continue the rebase on `fix/x`?") can now be answered with a yes.
