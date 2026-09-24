---
review-cycle: patch
---

Review cycles converge sooner. From iteration 2, a finding reopens the loop only in two cases: it shows one of the cycle's own fixes is wrong (at any severity), or it rates important or above on its leg's scale. A finding with no rating counts as important. Any other finding is listed as deferred for you to decide on: a Codex `medium` or `low`, a Suggestion, or a test-gap rating under 7. Until now, each iteration's test-coverage leg could find one more unpinned guard, and pinning it bought another round. From iteration 2, that leg asks only about the guards the cycle's fixes added.

When a reviewer changed the repository, the summary now names who did it. The review reads the entries the gate's `reviewerChanges` record gained since that fan-out's snapshot. A change with no new entry most likely came from the Codex leg, which the gate does not watch.
