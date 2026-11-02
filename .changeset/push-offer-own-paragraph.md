---
review-cycle: patch
---

A push to the default branch or of a tag that the request did not name is refused with a question to ask, such as "Push to `develop`?". The refusal now gives the question unquoted and tells the agent to end its reply with it alone in the last paragraph, without quotation marks. A yes names the branch only when the question is the answer's whole last paragraph, so an agent that wrote "Done. Push to `develop`?" on one line got a yes that named nothing, and a default branch other than `main` or `master` stayed refused.
