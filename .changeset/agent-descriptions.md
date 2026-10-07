---
review-cycle: patch
---

The code-reviewer, pr-test-analyzer, silent-failure-hunter and type-design-analyzer descriptions no longer carry `<example>` blocks. Claude Code puts every agent's description in each session's agent listing, so the examples cost context in every session whether or not a review ran; together the four descriptions drop from 6,370 to 2,644 bytes. The scenarios they described now sit in a "When to invoke" section in each agent's body, as pr-review-toolkit did upstream for three of them. Nothing changes in how the review cycle runs these agents.
