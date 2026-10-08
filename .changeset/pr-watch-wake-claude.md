---
pr-watch: minor
---

pr-watch now tells Claude what its line shows, so you no longer have to prompt it to check on a pull request. It submits a message to the session, which runs once Claude is idle, when GitHub reports a watched pull request ready to merge; when a run fails, in any workflow, as soon as its first job does, once per run and attempt; when the pull request has merge conflicts or a reviewer requests changes; when a merge's or a push's checks pass; and when someone other than you comments on or reviews it. Each is told once while it lasts, and the message says it is news, not a request to merge.

Two new settings in `/config` choose how much Claude hears. Wake Claude is `off`, `checks` or `checks and comments` (the default). Bots wake Claude is `never` (the default), `reviews`, which lets a review bot such as CodeRabbit or Copilot through but not plan or coverage comments, or `comments and reviews`. Changing either reports no history of comments, and whatever still lasts when waking is turned back on is told once.

After ten reads in a row whose only news was comments and reviews, those stop waking Claude until other news comes, so a chatty bot cannot keep it busy.
