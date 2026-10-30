---
pr-kit: minor
---

`/pr-kit:ship` on "push it" for a branch with nothing new to push skips the push and still rewrites the pull request body from the branch, so a body that has drifted from the commits can be brought current without a new commit.
