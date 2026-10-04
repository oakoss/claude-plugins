---
review-cycle: patch
---

A reply to the agent's offer to delete a remote branch now allows the delete. When the agent named the branch ("Delete `fix/x` from `origin`?", "Should I delete feat/x from origin?"), no reply was read as asking for it, not even "yes", so the gate refused the delete again and again. Now "yes", "lets delete it" and "delete it" answer such an offer, and "delete the branch from origin" asks for one. A named path is still not a branch: "yes" to "Should I delete src/old.ts?" allows nothing. When the gate refuses a remote branch delete, it now suggests a question that a "yes" answers, and mentions that a merge you asked for already covers `gh pr merge --delete-branch`.
