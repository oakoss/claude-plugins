---
review-cycle: patch
---

A yes no longer grants a step the agent's offer put off or left to a choice:

- An offer that puts a step off ("Should I push later, then merge #3?", "Merge #3 and #4 later?") grants nothing from that question, where a yes used to grant the merge of #3.
- An offer that sets a force push against a plain one ("Force-push `fix/x` with a lease, or push?") grants neither, where a yes used to grant the lease.

When such a yes grants nothing, the refusal says why, so the agent asks again for what to do now, or offers one push.
