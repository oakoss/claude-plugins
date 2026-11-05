---
review-cycle: minor
---

The new `mcp__review-cycle__offer` tool gives the agent the one question to ask for a held step it is about to offer ("Merge #316?", "Release #289?", "Push `fix/x` to `origin`?"), a question the consent grammar reads a yes to exactly. The agent ends its answer on that question, so a plain yes to its offer is not held by a rewording the grammar misreads. Your reply is still read against the whole answer, so a condition the answer states still holds it.
