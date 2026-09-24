---
review-cycle: minor
---

Reviewers can no longer quietly change the repository they are reviewing.

- **Edits are refused.** While a `review-cycle:*` reviewer runs, the gate refuses its Edit, Write and NotebookEdit calls on paths inside the repository. The refusal tells the reviewer to copy what it needs into a private `mktemp -d` directory. Scratch work outside the repository, in `/tmp` for example, is unaffected. So are `review-cycle:cleanup`, which edits by design, and the main session.
- **Bash changes are reported.** Before and after each reviewer command, the gate compares HEAD's commit and branch, the staged entries, the working tree, and the local and worktree git config. When one of them changed, the reviewer is asked to put back a change it made and to say so in its report, and the status tool lists the change under `reviewerChanges`. Until now, a reviewer that ran `sed -i` on a source file, switched branches or set a local `user.email` went unnoticed unless the review's own snapshot comparison caught it.

The status tool lists anything it could not check. A background command is compared only until it returns.
