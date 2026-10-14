---
review-cycle: patch
---

The review skill loads less into the session. Its text is 61,056 characters across its files where the last release's was 75,831, and its description, which every session's skill listing carries, is less than half as long: the cut removes measurement history (which CLI version showed what, which cycle measured it), rationale, and rules stated twice, and every instruction stays. The skill body itself is now 39,099 characters: the Codex invocation, the fix-verification and loop decision, the post-loop audit and cleanup, and the summary template live in files beside it (`codex.md`, `loop.md`, `post-loop.md`, `summary.md`) that a review reads when it reaches them. A test holds the body under 40,000 characters and 500 lines. How a review runs does not change.
