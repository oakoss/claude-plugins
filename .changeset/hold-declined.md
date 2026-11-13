---
review-cycle: patch
---

The hold the gate keeps across a reload no longer carries a `declined` flag. Only the model check read it, and that goes in this release. The kept record's shape changes with it, so the first reload after you update starts the gate fresh: a hold or a job in force at that moment is dropped once, and a change reviewed before it is reviewed again before its commit.
