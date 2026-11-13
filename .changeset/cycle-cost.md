---
review-cycle: minor
---

The status tool reports what reviews cost. Each review summary's `Cost:` line (minutes, legs, subagent tokens and Codex tokens per iteration) is now kept with the cycle, where it used to be dropped. `cycles.cost` totals what the kept cycles spent, and `cycles.recent` lists the newest 5 cycles one by one with the commit each reviewed, its cost and its findings, so a change to the review loop can be compared before and after. Cycles kept before this release have no cost and are left out of the totals.
