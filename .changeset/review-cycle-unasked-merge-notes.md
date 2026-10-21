---
review-cycle: patch
---

A merge your stop-before setting lets through without asking is now noted as the step it is. At `never stop`, merging oakum's version pull request unasked tells the agent it ran a release, not a merge. After "release it", a merge of some other pull request is noted as a merge run without asking, where before the release request hid it. To name the step, a merge that runs unasked now reads its pull request's head branch with one `gh pr view`. When that read fails, or the gate cannot look the merge up (`GH_REPO=`, `GIT_DIR=` or `env -C` picks where it runs), the merge still runs and is noted as a merge.
