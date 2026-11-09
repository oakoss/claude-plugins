---
pr-kit: patch
---

Merge now offers "push it", from a checkout of the pull request's branch, when that branch is behind the default branch, since ship's update merges the default branch in and pushes; for a stack layer it names ship's `gh stack sync` or `gh stack rebase --no-trunk`, and for any other base it says ship does not merge it. Before, it offered fix-ci or fix-merge-conflicts, neither of which brings a branch up to date. Fix merge conflicts, during a rebase, now tells you how to check the result once the rebase finishes: `git range-diff --creation-factor=100 <upstream> ORIG_HEAD HEAD` compares each commit before and after it was replayed, so you can read every commit that changed or was dropped and confirm it still does what it meant to.
