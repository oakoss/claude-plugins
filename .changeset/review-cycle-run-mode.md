---
review-cycle: patch
---

Under a job started with "do epic <id>", `/review-cycle:review` no longer stops to ask, since you read the job's report rather than each turn. Scope creep against the spec becomes a question in the ledger and the summary, and the cycle runs on; findings held at the round limit are deferred with that reason, and the clean result commits. When those findings fall where an earlier round also fixed or came mostly from the cycle's own fixes, when paths stay unreviewed or a reviewer changed the tree, or when the gate would not admit the commit, the review shelves the bead: it commits nothing and ends with `Final state: shelved (<why>)`. Outside a job nothing changes.
