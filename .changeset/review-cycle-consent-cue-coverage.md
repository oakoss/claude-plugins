---
review-cycle: patch
---

"As soon as" now withholds a request the way "when", "once" and "if" do. Before, "merge it as soon as I say so, then release it" granted the release, and "commit it as soon as you can, then push it" granted the push, so the agent could release or push without waiting for the condition. Both now ask first, and a step asked for in the same sentence waits too: "commit and push as soon as checks pass" no longer grants the commit. "Merge it as soon as checks pass" still grants an auto-merge.

The consent spec also checks each cue word on its own, and `pnpm consent:diff` generates openers with hyphens, brackets and curly quotes, the inputs where reading raw text and reading words disagree.
