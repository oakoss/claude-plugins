---
review-cycle: patch
---

The consent grammar now reads more answers the way the user meant them, so fewer pushes and merges need the same answer typed twice.

- A yes to an offer that writes out the command, such as "May I run git push --force-with-lease origin fix/x?", grants the force push with a lease. Before, it granted nothing.
- "ok, push" or "yes, push it" in reply to a force-push offer takes the offer's force, as a bare yes does. Before, it granted only a plain push, the gate refused the force push, and the agent asked again. Any other wording is still read as the user's own request: "push it" without the yes, "ok, push to origin", or "yes, but don't force it". After an offer that also names a plain push ("…with a lease, or a plain push?"), "ok, push" picks the plain one.
- A bare yes to "Push to main?" now names `main` (or `master`) without backticks, so a default-branch push it agreed to is no longer refused. Any other branch name still needs backticks.
- "push to origin/main" names `main` as the push's target, as "push to main" does.
- A message typed into the running turn after a yes to several merges now replaces that grant when it holds after "but" ("yes, but not yet", "ok but not now") or takes one pull request back ("skip #4", "#4 can wait", "leave #4 for now"). Taking one back keeps the rest of what a yes would have granted: after "Should I merge #3, then #4?", "skip #4" merges #3 alone. After an offer a yes would not grant, such as one waiting on CI, it keeps none. Before, the declined merge stayed granted.
