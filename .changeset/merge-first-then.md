---
review-cycle: patch
---

A request that ends its step with "first" now asks for that step: "merge 168 first then start on the docs", "push it first" and "release it first please" grant the merge, push or release, where before the word "first" made the gate read the message as only mentioning the step and hold it. "first" counts only at the end of the step, before courtesies like "please", and not after "the": "merge the first" and "merge the first PR" still ask for nothing. A yes to an agent's offer that ends in "first" ("Should I merge #168 first?") still grants nothing, so the agent asks without it.
