---
review-cycle: minor
---

"Merge it when it's ready" now lets the agent turn on auto-merge. A merge asked for once the pull request is ready, or once CI or its checks pass or are green ("merge 116 once CI passes", "go ahead and merge it as soon as the checks are green"), covers `gh pr merge --auto`, which leaves the waiting to GitHub. Before, any condition made the request grant nothing, so the agent asked again.

- **Merging now is refused.** Under such a request, a merge without `--auto` is refused whatever your stop-before setting, and the refusal tells the agent to add `--auto`.
- **GitHub waits only on required checks.** A pull request whose failing checks are not required merges at once.
- **The rest of the sentence waits.** Anything else in the same sentence is not granted, since it may wait on the same condition: "merge it when it's ready, then release it" grants only the merge.
- **Other conditions still ask.** "merge it when I say so" or "commit when the tests pass" asks for nothing.
- **The version PR is still a release.** Merging oakum's version pull request needs its own request.

The status tool reports the request as `autoMergeRequested`.
