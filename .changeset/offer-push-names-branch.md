---
review-cycle: patch
---

A yes to the offer tool's push question, or its push-and-open-a-pull-request question, now counts as naming its branch, so "Push `main` to `origin`?" answered yes pushes to the default branch at once. It used to grant a push naming nothing, so the gate refused the push to `main` and asked "Push to `main`?" a second time. The name is matched without regard to case, as a typed one is. A force-push question still names nothing, so a force-push to the default branch still asks again.
