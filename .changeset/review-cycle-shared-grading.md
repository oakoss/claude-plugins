---
review-cycle: patch
---

`/review-cycle:review` and `/review-cycle:review-pr` now grade their review legs from one shared file, `reference/grading.md`, which each reads before grading the first leg. The two skills used to carry their own copies of the grading table and the Codex receipt rule, and the copies had already drifted. Grading itself is unchanged, except that the review cycle now also states two rules review-pr already had: why a claim a leg labels inferred keeps it out of `partial`, and that a leg that was skipped, failed, dropped or capped carries no execution label, which now names capped legs in both skills.
