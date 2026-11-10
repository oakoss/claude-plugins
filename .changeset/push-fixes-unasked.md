---
review-cycle: patch
---

The review skill now pushes a fix to your own open, unapproved pull request without asking when your `prUpdates` setting is not `ask`, leaving the gate to run it or say why not. Before, it pushed unasked only when stop-before allowed every push, so under `push fixes` an agent that had committed a fix still asked "say push it", though the gate would have run the push.
