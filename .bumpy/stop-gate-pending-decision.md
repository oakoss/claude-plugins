---
review-cycle: patch
---

The Stop gate's block message now names the pending-decision case, so the model waits for the user's answer instead of preempting it with a fan-out.

Measured failure: after a converged cycle, the model presented a small post-review delta with a review-or-accept recommendation and tried to end its turn; the gate's message ('only if the user explicitly asked to defer may you stop again') read as an instruction to launch the cycle immediately, three reviewers were spawned, and the user's /review-cycle:accept arrived seconds later — the spawned reviewers had to be killed mid-run. The gate already blocks once per state, so a second stop attempt passes by design; the message now says that stopping to await the user's pending review-or-accept decision is the right move, and launching the cycle over it preempts a choice that belongs to the user.

The accept skill gained the matching edge case: when an accept lands while a cycle is in flight, the accept supersedes it — accept-state already retires the cycle's in-progress marker, and the skill now says to stop the spawned reviewers and disregard reports arriving after the accept, instead of letting them run to completion for a report nobody needs.
