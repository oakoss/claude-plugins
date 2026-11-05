---
review-cycle: patch
---

`/review-cycle:misses` now adds the misses you label to the consent corpus in one step, through `pnpm consent:model add`, so the model check is scored against phrasing you actually typed. It marks the rows the grammar misses, asks the model only about the rows the grammar refuses, and adds nothing when one gets no reply, or when the grammar or the model grants a step your label does not allow. Outside the review-cycle repository it shows the rows for you to add.
