---
review-cycle: patch
---

A refusal caused by a hold now says why the steps are held: "the user held off (their message mentioned a merge without asking for one)" or "(they put off a push the agent offered)". Before, it said only that you had held off, and the agent could not tell which step held or what would lift it, since a question that mentions a step ("anything else before we merge?") holds that step too. The status tool reports the same reason as `stopBefore.heldBy`, the step plus `mentioned` or `declined`.
