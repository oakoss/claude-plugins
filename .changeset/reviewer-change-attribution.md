---
review-cycle: patch
---

A `reviewerChanges` entry in the status tool now says the repository changed "by it or by another agent", as the note sent to the reviewer already did. The gate compares the repository around a reviewer's command, so an edit the main session or another leg made while that command ran lands on the reviewer too; the entry read as the reviewer's own change, and a review summary could blame the wrong leg.
