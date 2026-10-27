---
review-cycle: minor
---

The comment policy now deletes a comment unless it is clearly worth keeping: one earns its place only when, without it, the next reader would get something wrong or have to run or search something to learn it. It also names three more kinds of noise: labels on test cases or inputs that already read clearly, narration of the assertion or call on the next line, and a summary of a function short enough to read. A rule is stated once, beside the code that enforces it, and named elsewhere rather than restated. Facts the code holds and will change (counts, lists presented as complete, positions such as "above", the ticket a measurement came from) give way to a pointer at the list or file; a measured version or number stays. The review skill, the cleanup agent and `reference/policies.md` carry the change; the cleanup agent rewrites a useful comment that carries such facts rather than removing it. Judged comment by comment over this repository's last 20 pull requests, the new test drops 21 of 116 added comments the old wording kept, and keeps none it dropped.

`/review-cycle:init` appends a policy only when its heading is missing, so a `CLAUDE.md` that already holds the comment policy keeps the old wording; copy the new block from `reference/policies.md` to update it.
