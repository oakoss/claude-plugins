---
pr-kit: patch
---

### Fixed

fix-ci no longer points at `/review-cycle:accept`, which is `disable-model-invocation: true` and exists for a human who reviewed the change themselves — instructing it both dead-ended the step and, if routed around, let the skill self-certify a fix it then pushed. The loop gains a hard cap of three rounds, or two on the same check: the previous same-check heuristic never fired when a fix for one check broke another, so an oscillation could write unbounded commits to a live PR. The merge-the-base guardrail now names its commands and uses the PR baseRefName instead of assuming main, and routes a conflict to /pr-kit:fix-merge-conflicts. The README no longer claims fix-ci stages and hands off; it commits and pushes each round by design, and now says so.
