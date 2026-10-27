---
review-cycle: none
---

Moves the commit gate's push judging out of `register.ts` into `push-judge.ts`, behind the same `Git` runner `git.ts` takes, so it can be tested without the hook kit. No behavior change.
