---
review-cycle: none
---

The commit gate's git reads move from `register.ts` into `git.ts`. They take a git runner the hook passes in, so they no longer need `$`. The nudge's per-message state becomes one record, and running reviewers are read from the recorded legs. No behavior changes.
