---
review-cycle: patch
---

The review loop now grades each finding by what the change is for before deciding whether to fix it. A finding about another path than the one the change is for, a rare case, a small cost or extra compatibility is deferred as `below the bar (re-graded)`, whatever severity its reviewer gave it, unless it concerns security or data loss; it stays in the summary and the ledger. A finding that shows one of the review's own fixes is wrong, or that the change misses its spec, is never graded down. Before, a reviewer confident about an edge case had it fixed, and each such fix could draw the next round's findings. Fixes now prefer deleting or narrowing code to adding a guard, cache, helper or option, and the summary gains a `Growth` line with what the cycle's fixes added to the diff; when they grew it at all, the agent names those fixes so you can cut them.
