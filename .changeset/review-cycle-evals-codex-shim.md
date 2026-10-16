---
review-cycle: patch
---

The review cycle's final message now carries its summary block field by field, with any prose around it explaining the block rather than replacing it. An eval run caught a final message that retold the summary in prose and dropped fields such as the Codex leg's status.

The eval suite's Codex shims also reach the session now, so an eval run no longer launches the real Codex CLI, and its graders match what a correct cycle reports.
