---
review-cycle: patch
---

`/review-cycle:misses` no longer lists a refused command because of words in the command itself. The step a refusal asked about was read back out of its text, quoted command included, so a refused `gh pr comment` whose body said "ask for a merge" could be kept as a missed merge. Each refusal now carries its step.
