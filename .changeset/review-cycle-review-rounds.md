---
review-cycle: patch
---

The gate now records how many review rounds each commit took, counting the distinct trees reviewers were given since the previous commit, and the status tool shows the count so far as `roundsSinceCommit` and the last 10 commits as `rounds`. A change to the review loop can now be measured by rounds to converge instead of judged from one session.
