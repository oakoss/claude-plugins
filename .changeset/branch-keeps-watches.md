---
pr-watch: patch
---

`/branch` keeps the pull requests pr-watch was watching. The branched session continues under a new session id with no saved watches, so its line above the prompt came up empty; pr-watch now copies the parent session's saved watches to the new id when the branch starts, and restores them as it does after `claude --resume`. The copy is the parent's last save, which pr-watch makes at most once a second, so a watch changed in the second before `/branch` may not carry. `/clear` still starts with none.
