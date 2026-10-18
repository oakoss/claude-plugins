---
review-cycle: patch
---

Switching the commit gate off and back on in `/config` no longer forgets the reviews it had seen, so turning it off for a moment no longer costs a fresh review of work a reviewer already covered. A finished review still covers only the content its reviewer saw, so an edit made while the gate was off still needs one. What the gate kept true only by watching is still dropped: reviewer legs still running, the agent's last question, a step you held off, and the current message.
