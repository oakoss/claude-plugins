---
pr-kit: patch
---

The ship, merge and fix-ci skills ask their questions in the form review-cycle's gate now reads. fix-ci, before its first push, ends on the gate's own push question, where it used to ask "Should I commit and push the fixes?", a yes to which the gate no longer reads. Ship's stack path, before opening pull requests for layers that have none, names those layers and then ends on the gate's own stack question, where it used to ask "Ship those too?", a yes to which the gate no longer reads. The merge skill no longer says a note in parentheses holds a merge: any words beside the question now leave a yes granting nothing, so it tells the agent to keep the question whole and alone on the last line.
