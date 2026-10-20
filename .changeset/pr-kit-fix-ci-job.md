---
pr-kit: patch
---

`/pr-kit:fix-ci` no longer asks "Should I commit and push the fixes?" when review-cycle's gate already lets a push run (its status tool reports `mayPush`), as under a job started with "do epic <id>". Nobody is there to answer during a job, so the question stopped it. On a layer of a gh-stack stack it now pushes with `gh stack push`, rebasing the layers above first, since review-cycle's gate refuses a plain `git push` of a layer.
