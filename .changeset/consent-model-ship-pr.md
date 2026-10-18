---
review-cycle: patch
---

When the consent grammar cannot read a "ship" request, the model check now grants the pull request along with the push, as the grammar's own "ship it" does, so a phrasing like "lets ship the react aria update" opens the PR instead of leaving it held. The model check also reads encouragement such as "push on" or "keep going" as "carry on" rather than a push, unless it answers the agent's offer to push: "Good, push on." grants nothing, while "yes, push on" after "Want me to push?" pushes. A re-measure before this change had read "Good, push on." as a push. Re-measured over the 169 messages the grammar refuses: no wrong yes, 5 of 142 labeled messages missed, p50 1.7 s, p95 3.2 s, about 840 tokens a call, now recorded with the replies.
