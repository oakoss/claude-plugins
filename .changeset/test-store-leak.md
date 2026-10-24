---
review-cycle: none
---

review-cycle's hook tests answer the gate's first read of its kept record from the test itself. The test kit keeps one store for a file's tests, and a save an earlier test left running could land after the next one started. The load then took that stale record back at its first message and lost the reviews recorded before it.
