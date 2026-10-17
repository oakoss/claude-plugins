---
review-cycle: patch
---

The commit gate now reads more of the ways a merge is asked for and offered. GitHub's merge methods count as a merge: "squash-merge 116", "squash merge it", "rebase and merge 116" and "squash and merge it when ready" grant what "merge 116", "merge it" and "merge it when ready" do, and a yes to "Should I squash-merge #116?" grants that merge. A merge names every pull request listed after it, so "merge 116, then 117", "merge 116, 117 and 118" and a yes to "Should I merge #116, then #117?" cover each, where only the first was covered before. A number that is not a pull request ("merge 116, 100%") and a pull request after another step ("merge 116 and review 117, then 118") are not added to the merge.
