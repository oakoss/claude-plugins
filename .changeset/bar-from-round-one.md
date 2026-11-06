---
review-cycle: minor
---

The review cycle fixes only findings that matter from its first round, not its second: a finding rated important or above, a spec defect, or one showing a fix the cycle made is wrong. A suggestion, a Codex `medium` or `low`, or a test gap rated under 7 is deferred with the reason "below the bar" and recorded in the ledger instead of fixed; a deferral does not hold up the commit. Over 46 earlier cycles that ran past round 1, 43% of first-round severity markers were below this bar, and the cycles with the higher share drew about three times as many findings from their own fixes, a correlation rather than a measured cause. Expect more deferred items in the summary's Known issues; whether it cuts rounds per commit is what this change is measuring.
