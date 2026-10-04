---
pr-watch: patch
---

The band now reacts to Claude's own `git push` and `gh pr merge` within a second or two, rather than at its next slow poll. A pull request that had settled (failing, ready, or waiting on a review) was read only once a minute, so a fix Claude pushed could take up to a minute to show its new runs. After a push or a merge, every watched pull request is read at once and then every 5 seconds for a minute while GitHub starts the new runs. A push from your own terminal still shows at the next poll.
