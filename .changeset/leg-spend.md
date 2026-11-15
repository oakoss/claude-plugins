---
review-cycle: minor
---

The review cycle now measures what its reviewer legs spend. The `Cost:` line's subagent tokens were each leg's final context size, as its notification reports it, not its spend: measured on Claude Code 2.1.325, a code-reviewer leg that reported 77,355 tokens made 29 model calls that read 1,601,897 tokens from the prompt cache and generated 16,199 output tokens. review-cycle now sums each leg's per-call usage as the engine reports it, the status tool lists it as `legSpend` by agent id (steps, input, cache-write, cache-read and output tokens), and the summary's `Cost:` line carries those counts beside the old figure, so a change meant to cut review cost can be measured. The counts are kept across a reload, and the cycle totals in the status tool add them up for the cycles that state them.
