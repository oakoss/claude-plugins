---
review-cycle: minor
---

Phase 7 now checks a diff's release-note file against the diff.

A changeset or bump file describes the change in the author's words, and release tooling publishes that text verbatim — so a description written before review is a claim about code that review then went on to alter. Nothing checked it: the evidence policy binds claims about what a command does, while here the claim and the code that settles it are both inside the diff. A description that had drifted this way shipped into a version PR and cost a separate branch, review, merge, and release regeneration to correct, after a cleanup pass reported that its claims matched the code without having compared them. Phase 7 now reads every release-note file in play — those the diff adds or modifies, plus any already staged before the cycle began, since a delta-scoped review narrows the diff — against the final post-fix state and corrects it in either cleanup mode, running last so that cleanup — which edits `.md` files itself — cannot rewrite the text after it was verified. The summary reports those corrections separately from wording changes, and the cleanup agent is told never to report that prose matches code it did not actually compare.
