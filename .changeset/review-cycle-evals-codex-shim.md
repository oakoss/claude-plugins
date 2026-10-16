---
review-cycle: patch
---

The review cycle's final message now carries its summary block field by field, after any commit the cycle makes, with any prose around it explaining the block rather than replacing it. Eval runs caught one final message that retold the summary in prose, dropping fields such as the Codex leg's status, and another that printed it before the commit and ended with prose.

The eval suite's Codex shims now reach the session, so an eval run no longer launches the real Codex CLI, and its graders match what a correct cycle reports.
