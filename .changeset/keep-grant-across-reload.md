---
review-cycle: patch
---

What your latest message granted now survives a reload of review-cycle's hooks module. A reload used to drop it, so the next step asked again. In a working tree that loads review-cycle from source, a `git merge` from the default branch rewrote the hooks files mid-ship, the module reloaded between the push and the pull request, and "ship it" was refused the pull request it had already granted. The grant is kept with the rest of the gate's record until your next message replaces it; `/clear`, a resume and switching the gate off still drop it.
