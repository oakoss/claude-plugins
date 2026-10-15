---
pr-watch: patch
---

A prompt with no news kept for it no longer writes pr-watch's kept-news store, so a store that refuses writes no longer shows "could not add its news to your prompt" on every message. When a prompt can neither re-read a pull request's ready line nor put back the news it took, pr-watch now says both: the toast about your prompt keeps the error that stopped it, and a second toast says the news was lost.
