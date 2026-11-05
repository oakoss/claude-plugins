---
review-cycle: patch
---

A hold that names a step or pull request now takes it back. After "merge 62 and 63. Not yet for 63." the gate merges only 62, and "Not yet for linesmith#63" withdraws that pull request too. "Hold off on the commit", "Not yet on the PR", "Hold off on approving" and "Hold off on merging" each withdraw that step from the same message. What a hold waits on no longer counts as what it holds: "push it. Not yet, until I approve." and "Hold off until 3 reviews land." now hold the push instead of granting it. A sentence that only states something, such as "Not yet merged anywhere", takes nothing back.
