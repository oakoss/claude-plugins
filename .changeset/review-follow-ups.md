---
review-cycle: minor
---

After `/review-cycle:review` commits, it now fixes the deferred findings whose fix is a sentence or a test, below the bar and pre-existing ones included, and commits them as one follow-up commit on the same branch once a confirmation review of those fixes is clean. If that review faults any follow-up fix, the whole follow-up is dropped and its findings listed, never patched again. Once the follow-up is pushed, an open pull request's Known issues are rewritten to match. The reply then lists what it fixed and what it left, each with its reason, and asks one question: whether to file any of the left ones. You no longer have to ask which findings to address. Nothing is filed without your yes; findings held at the round limit are left alone, and a cycle that stopped before committing ends as before.
