---
pr-watch: patch
---

Each read of a pull request costs one point of GitHub's GraphQL quota instead of two: an open pull request is read for its head commit's runs and a merged one for its merge commit's, where every read asked for both. The 5,000 points an hour are shared with every `gh` call you and Claude make, so pr-watch now reads the quota left from each answer, and while fewer than a tenth remain it reads every watch on that host once a minute, after a push or merge too, until the quota recovers.
