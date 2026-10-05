---
pr-watch: minor
---

A branch Claude pushes now gets a line in the band: `⟳ push feat/x · ● CI` with the same progress bar and marks, then `✓ checks passed` or the job that failed, with a toast. It follows the runs on the branch's newest commit and clears the way a merge does: a few seconds after its checks pass and 90 seconds have gone by since the push, or, when they fail, once a re-run passes. Pushing the branch again starts its line over. Before, a push to a branch with no pull request showed nothing.

A push to a branch that heads an open pull request shows that pull request's line instead, the upstream one when the branch is on a fork, adding it if the band was not already watching it. A branch is read from the push's output, `--porcelain` included, and counts when the push moved it, even if the same push had another branch rejected. A push that moved no branch (a delete, a tag, `Everything up-to-date`) adds no line, and `git push -q` prints nothing to read. A `--dry-run` prints what a push would, so it gets a line: a new branch leaves at its first read, and an existing one shows its current checks. A branch gone by the time it is read leaves at once, and one that cannot be read at all, such as on a host `gh` does not know, leaves after 90 seconds rather than staying as an error.
