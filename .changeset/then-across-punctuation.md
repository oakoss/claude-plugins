---
review-cycle: patch
---

A semicolon no longer turns a description into a push request. "we commit; then push" and "I'll commit; then push" grant nothing, as "we commit, then push" already did, and a yes to the agent asking "Do we commit, then push?", "Do we commit; then push?" or "Can we commit, then push?" grants nothing either. Only a semicolon after a sentence about committing or pushing carries over: "I fixed it. Then please push it.", "we're done; then push it", "commit; then push" and a yes to "Should we commit, then push?" or "Should I fix it, then push?" still grant the push.
