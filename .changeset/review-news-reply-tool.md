---
pr-watch: patch
---

When pr-watch tells Claude about a review that is not an approval, such as a bot's review with inline findings, the message now also says to answer the review's threads, once the fix is pushed, with review-cycle's `mcp__review-cycle__reply` tool when it exists, rather than with `gh`. Before, an agent woken by "@pullfrog reviewed #118" replied with `gh`, which asks you every time, though review-cycle's `push, reply and resolve` setting allowed the reply.
