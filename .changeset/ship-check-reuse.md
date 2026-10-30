---
pr-kit: patch
---

`/pr-kit:ship` no longer re-runs the project's full checks when this conversation just saw them pass on the same tree: HEAD's tree matches the one recorded then, the working tree is clean, and bringing the branch current merged nothing. Verification then quotes that run and says it was reused; any other run, partial or on another tree, counts as none, a gh-stack stack never reuses one, and CI runs every check again after the push. A check the project runs only in CI is named in Verification as left to CI.
