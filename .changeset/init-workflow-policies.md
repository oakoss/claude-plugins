---
review-cycle: patch
---

`/review-cycle:init` no longer offers to append review-cycle's comment policy to your `CLAUDE.md`; it offers only the fix-vs-defer and evidence policies, which are about how the agent works. Comment and style rules belong to each project, and the `comment-check` plugin flags comment slop as files are written. A comment policy init added before stays where it is.
