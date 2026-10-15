---
pr-watch: patch
---

A running line now says what its workflow still waits on. Once some of its jobs have finished, it names those left, as in `● CI: Windows ████████████████▉░░░░░░░ 3m29s / ~4m58s`, marking each that has not started `queued`, or counts them past two; a long job name is cut at 24 characters. A re-run now shows how long it has run, as in `● CI re-run: Tests 1m12s`, timed from its attempt's start, which pr-watch asks GitHub for once per attempt, again a minute later if that fails, and no more once GitHub refuses; it still draws no bar, since re-running the failed jobs takes less than the whole workflow. Workflow-length lookups now give up after 10 seconds, so a slow one no longer holds up a pull request's next read.
