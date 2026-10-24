---
review-cycle: minor
---

The status tool's `droppedReviews` and `reviewerChanges` now start again at each commit the gate checks, rather than covering the whole session. Before, every status call repeated entries from earlier review cycles, such as a leg dropped on a branch merged hours ago, and the review skill could read an old "could not check" entry as part of the current cycle. A commit made while one of a review cycle's reviewers still runs leaves both lists alone, so the review skill's rule of noting the count at the snapshot still holds. `cappedReviews` already started again with each cycle.
