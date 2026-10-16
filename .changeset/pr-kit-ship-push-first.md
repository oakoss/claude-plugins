---
pr-kit: patch
---

`/pr-kit:ship` now pushes the branch before closing the beads it finishes. It used to close and sync them first, so a push the commit gate refused left items closed for work that had not shipped, and the report had to name them for you to reopen. Now a refused push stops the ship with nothing closed.
