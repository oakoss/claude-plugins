---
review-cycle: minor
---

`mcp__review-cycle__codex_log` now also returns the Codex review's token usage as `tokens`: the input, cached input, output, reasoning and total counts, summed over every session the review ran in (`sessions`: Codex's review session, and any it started, such as its guardian), or `unavailable` with the reason, as for a review not yet finished. The review summary's Cost line reads the Codex leg's tokens from it, in place of a hand-run `grep` over `~/.codex/sessions` that reviews kept skipping and that missed the guardian's tokens: on one review here the guardian held 584,494 of 1,249,268. The tool finds Codex's sessions under `CODEX_HOME`, or `~/.codex` when that is unset or empty, and searches only the folders for the days the review ran, which took under a second here where the whole tree took 27.
