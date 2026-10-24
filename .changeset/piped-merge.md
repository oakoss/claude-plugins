---
review-cycle: patch
---

A gh command piped into `tail` or `wc` at the very end, such as `gh pr merge 62 --squash 2>&1 | tail -4`, is now judged as if it ran on its own, as a commit or push piped the same way already was. Before, the pipe counted as another step that could change which pull request the merge reaches, so the merge was refused and had to be run again without it. The filters allowed are the commit path's: `tail` with at most one count, or `wc` with its counting flags, with no file, redirect or substitution. `head`, `grep` and anything else still count as another step. A merge that would end a standing "merge once ready" ask still has to run without the pipe, since the pipe reports the filter's exit status and a failed merge would read as one that succeeded.
