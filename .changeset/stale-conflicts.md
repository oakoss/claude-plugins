---
pr-watch: patch
---

Claude is no longer told of merge conflicts that are already gone. When a pull request conflicted briefly while Claude was working, such as between the base branch moving and the push that merged it in, pr-watch held the news for the end of the turn and told it then, though the conflict had been cleared: Claude went looking and found nothing to resolve. Conflicts held through a turn are now dropped when a later read shows them gone. A release tool's version pull request never tells its conflicts, since the tool rebuilds it on the next push to the base branch; its line still shows `⚠ conflicts` once its checks finish, while they last.
