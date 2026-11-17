---
pr-watch: patch
---

pr-watch names more of what holds a pull request back. A check run GitHub gave up on, unfinished (`STALE`), now counts as failed and reads "stale" on the band, in the toast and in the news, where before the band showed ✗ while the news said nothing and a required one left the pull request "blocked" for good; a job that failed is named before one that went stale or was cancelled beside it. A failed required GitHub App check now shows on the band by name ("⚠ Vercel failed", or "stale") instead of "blocked". When several jobs fail, the news links the log of the job the band and toast name.
