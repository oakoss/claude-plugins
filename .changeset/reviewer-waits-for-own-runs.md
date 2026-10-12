---
review-cycle: patch
---

Each reviewer agent now waits for its own background runs before it reports. A reviewer that ended its turn while its mutation runs went on in the background sent an interim answer each time, and each one woke the review cycle as if the review had finished: one test-analyzer leg sent about fifteen before its real report. The agent bodies now say that ending the turn delivers the report, so a reviewer never ends it to wait: it waits for the commands it started with a foreground command, such as an `until` loop on their output (at most 10 minutes per call). Because a leg in a review cycle is stopped after 30 minutes and its report lost, a reviewer samples a long check such as a mutation suite rather than running all of it, and labels the rest inferred. When the cycle asks a reviewer for its findings now, it reports what it has and stops what is still running.
