---
review-cycle: minor
---

A fix that adds a guard is now exercised against valid input too, not only against the case it was written for.

Testing a new check against the thing it should catch is instinctive; testing it against input that must still pass is not, and only the second finds a guard that rejects correct work. A guard added during one of this plugin's own review cycles caught its intended attack and was verified doing so, then turned out to fire on an accurate sentence describing the very step it protected — which would have made that section unwriteable and the guard the first thing a later author deleted rather than repaired. Phase 6's self-check now requires both directions whenever a fix adds a check, guard, assertion, or validation.
