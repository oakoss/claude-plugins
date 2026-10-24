---
pr-watch: patch
---

When a pull request turns ready to merge while workflows the merge does not wait on are still running, the toast and what Claude is told now name them and say they are not required ("#128 is ready to merge; Visual capture still running, not required"; Claude is told they were still running when pr-watch read it), so a merge state of `UNSTABLE` no longer needs working out by hand.
