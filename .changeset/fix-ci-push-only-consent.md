---
pr-kit: patch
---

`/pr-kit:fix-ci` now asks "Should I commit and push the fixes?" before its first push. Its old question, "commit and push the fixes each round?", never counted as a push request with review-cycle, so a yes to it still left every round's push waiting on the Push dialog. The skill also describes review-cycle's gate as it now works: a commit needs only a review, and the push is what needs your request.
