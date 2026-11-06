---
review-cycle: patch
---

A later sentence declining a step now takes that step back. "Merge it. Do not merge it" grants nothing, "open a PR and merge it. But do not merge it yet." keeps only the pull request, "merge 130 and 131. Do not merge 130" merges only #131, and "release it. Do not release it" releases nothing; before, each still let the declined step run. Pushes and approvals are read the same way. A decline is read up to what it waits on, so "do not merge it until the push finishes" keeps the push, and a "do not" that asks a question ("do not merge it?") is read as before.
