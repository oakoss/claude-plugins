---
pr-watch: patch
---

The `watches` tool says of each pull request whether pr-watch will wake Claude to ask about its merge. A skill that would ask the merge question itself, such as pr-kit's `ship`, can then leave it to pr-watch only where pr-watch will ask: for a pull request Claude opened in this session, with Wake Claude on, no wake asked through the `watch` tool, and review-cycle not letting Claude merge unasked. A release pull request is never asked about.
