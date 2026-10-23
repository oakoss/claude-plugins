---
review-cycle: patch
---

A "not yet" to an offered approval that also mentions a merge ("not yet, before we merge" after "Should I approve #12?") now records the declined approval rather than the mentioned merge. Both hold the same steps; the difference is that the model check stays off afterwards, as it does after any decline, and a refusal says the approval was put off.
