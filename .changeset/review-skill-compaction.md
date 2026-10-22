---
review-cycle: patch
---

A review that is compacted partway now keeps its later phases. After a compaction Claude Code re-attaches the review skill cut to its first 20,000 characters, about a third of it, so a compacted review used to carry on from memory without Phases 3 to 10: the fan-out rules, aggregation, the loop check, the ledger record, the summary and the commit rules. From the time the review skill loads until a commit lands, the hooks module now appends the rest of the skill to the compacted conversation, starting at the section where that copy is cut. Nothing changes for a review that is never compacted, and the skill stays one file.
