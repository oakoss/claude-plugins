---
review-cycle: patch
---

The commit gate now recognises a GitHub lookup that times out. A real timeout says "aborted: still running after …", which the gate did not read as a timeout, so a slow lookup confirming a merge you asked for was not tried again for longer, and you were asked to approve it rather than told GitHub did not answer in time. Measured on Claude Code 2.1.319.
