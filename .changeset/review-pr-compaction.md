---
review-cycle: patch
---

A compaction during `/review-cycle:review-pr` no longer drops its later phases. Claude Code re-attaches an invoked skill cut to its first 20,000 characters, and review-pr runs to about 26,000, so a run compacted partway lost the end of Phase 4 and Phases 5 to 7: the report, posting to the pull request, and removing the disposable worktree. The hooks module now hands those phases back after the compaction, as it already did for the review skill, until review-pr's Phase 7 sweep. Its brief also stops asking reviewers to settle a question it never posed: they report the most severe findings first.
