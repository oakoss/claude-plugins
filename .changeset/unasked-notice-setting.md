---
review-cycle: minor
---

The line the gate logs when a push, pull request, merge or release runs without your asking, because your stop-before setting allows it ("ran a push without asking, since the stop-before setting is merge (/config)."), no longer shows on screen by default. The setting already says those steps need no asking, so the line repeated a choice you made once. The agent is still told, and can mention it. Turn the on-screen line back on with `review-cycle.unaskedNotice` in `/config`. A merge run now on a request to merge once the pull request is ready is always shown, since GitHub's state, not your setting, let it run.
