---
review-cycle: patch
---

Reviewer legs now have a rule for actions outside the filesystem. Read-only remote calls such as `gh pr view`, `gh api` sent as a GET (a `-f` or `-F` field turns it into a POST unless `-X GET` is passed) or `git ls-remote` are allowed, and the leg's report lists each one; the project's own checks run in the leg's copy, never in your repository; and a leg never creates anything remote (a repository, pull request, release or push) or causes any other side effect. A leg that needs a remote fixture to settle a finding reports it as a question naming what it would test, and you decide from the summary, where legs used to choose between guessing and giving up.
