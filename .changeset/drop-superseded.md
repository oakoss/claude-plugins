---
review-cycle: patch
---

A reviewer whose report counted is no longer listed as dropped. Before, an interim answer without the execution receipt, sent before the real report or after it, added a "did not open with the execution receipt" entry to `droppedReviews` that the counted report never cleared, so the status tool and a refusal's "reviews not counted" note showed the reviewer as uncounted. Each reviewer now keeps at most one entry, its latest; a counted report removes it, and an answer after a counted report adds none.
