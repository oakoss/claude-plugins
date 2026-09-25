---
review-cycle: patch
---

When the commit gate cannot build the tree a commit would record, its refusal now says why. It names the step that failed and git's own first error line, such as `git write-tree failed: fatal: …` or `git add failed: fatal: …`. When no error line is printed, it gives the exit code, and a step that timed out is named too. An amend whose parent commit can't be read says so, and a failed comparison names what it compared against. The status tool and the list of reviews that did not count give the same reasons, where they used to say only that the working tree could not be read. Until now the refusal said only "could not compute the tree this commit would record". That was puzzling after you picked Commit in the gate's question, since the check re-runs and the approval is used up with no reason given. (cpl-35t)
