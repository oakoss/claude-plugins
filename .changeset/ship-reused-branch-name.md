---
pr-kit: patch
---

`ship` no longer stops to ask when the branch's name was used before for a pull request that has since merged or closed and the branch holds only new work: that pull request's head commit is not in the branch's history, and every commit the branch adds was authored after it closed. `ship` then renames the local branch to one no pull request has used, says so in its report, and goes on as for a branch with no pull request. A branch that continues the earlier work, a rebased one included, or a gh-stack layer still stops and asks.
