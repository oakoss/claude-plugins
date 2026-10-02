---
review-cycle: patch
---

The review skill's canonicalize phase now reads each project check by its exit code. Run the check unpiped or record its exit status: a nonzero exit is never a pass, and output shortened by `tail` or `head` does not count as a clean run. That is how a lint run once hid three errors behind its last two lines. A check that ran and failed is a finding. Only a check that could not run at all, such as a missing tool or an unknown script, is noted and skipped; since both can exit 1, the output decides which case applies.
