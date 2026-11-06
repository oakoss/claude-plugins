---
review-cycle: minor
---

Review cycles are now measured. Each cycle's summary is kept per repository, and the status tool's new `cycles` field totals the newest 100: loop iterations, how each loop ended, the findings fixed and deferred by reviewer, by side of the fix bar and by iteration, and how many later findings the cycle's own fixes caused. The summary lists each fixed and deferred finding with its reviewer, `above` or `below` the bar, and the iteration that raised it, so a change to the loop, such as applying the bar from the first iteration, can be compared before and after.
