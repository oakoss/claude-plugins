---
review-cycle: patch
---

When `/review-cycle:review` holds findings at the round limit and you answer that they should be deferred, the review now records them in the ledger before committing. The ledger was written in the summary, before your answer, so those findings were never recorded and a later review could raise them again.
