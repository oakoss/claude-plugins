---
pr-watch: patch
---

A pull request opened after a push now takes over the push's line in place. After `git push` then `gh pr create`, the `⟳ push <branch>` line and the new pull request's line had stacked until the push line's own next read found the pull request, up to about 10 seconds or longer; now the pull request's first read, about a second after it is watched, puts it in the push line's row and drops the push line, keeping what Claude was told of either. This applies within one repository; a push to a fork is still handed to its pull request upstream by the push's own next read.
