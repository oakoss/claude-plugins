---
pr-watch: patch
---

A running workflow's estimated length is now the median of its last 10 successful runs, leaving out re-runs, instead of its single latest one. A short run off a release branch or a re-run of a few jobs no longer sets the bar: one pull request showed `~2m13s` while its CI took about four minutes. The estimate is also learned again once each run of that workflow finishes, so it follows the workflow as it gets faster or slower instead of keeping the first length pr-watch saw. A known estimate stays when that lookup fails.
