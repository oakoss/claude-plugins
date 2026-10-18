---
review-cycle: patch
---

The review cycle aims to converge in fewer rounds. Every reviewer brief in `/review-cycle:review` and `/review-cycle:review-pr`, Codex's included, now asks a leg whose findings share a cause to report the cause and the change that removes it, to tag a finding that reproduces on the base as `pre-existing`, and to report within 10 minutes, settling its question first. The code reviewer now reports a pre-existing issue tagged, scored on its own merits, where it used to score it as noise. A confirmed pre-existing finding is deferred to the ledger rather than fixed in the loop, whatever its severity, and the summary lists `pre-existing` as its reason. When findings held at the iteration ceiling fall in an area an earlier iteration also fixed, the cycle first offers to reconsider the approach, naming the smaller design, before asking whether to apply or defer them.
