---
review-cycle: minor
---

A review's cost is now counted by the gate rather than typed into the summary. The summary tool takes the spend of every reviewer leg that finished since the previous summary from the gate's own record, and the token totals of every finished Codex log `mcp__review-cycle__codex_log` read, and keeps them with the cycle; the status tool's `cycles.cost` and `recent` use them. The review skill no longer adds up each round's spend by hand, and the `Cost:` line drops its spend and Codex fields. No Codex token count had ever reached the stats before: the line asked for one, and none was typed. The counts include every phase, the maintainability and confirmation passes too, where the line's minutes and legs cover the fix loop alone.
