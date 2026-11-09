---
review-cycle: patch
---

`mcp__review-cycle__threads` now says, for each open review thread, whether a later push changed the lines it was left on (`outdated`) and who wrote its last comment (`lastBy`). Before, it showed only the first comment, so the agent could not tell a thread on code it had since rewritten, or one it had already answered, from one still waiting on it.
