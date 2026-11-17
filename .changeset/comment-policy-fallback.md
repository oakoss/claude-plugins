---
review-cycle: patch
---

`/review-cycle:review` now reviews and cleans comments by your project's own rules first, from its `AGENTS.md` or `CLAUDE.md` and its linter. review-cycle's comment policy becomes the fallback for what those rules leave unsaid: the review skill reads it from `reference/policies.md` instead of carrying it inline, and where your rules differ from it, yours win, in the review and in its cleanup pass. A project whose comment rules match review-cycle's sees no change. The review skill loads about 1,200 characters less on every review.
