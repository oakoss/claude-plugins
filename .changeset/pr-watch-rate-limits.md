---
pr-watch: patch
---

pr-watch pauses when GitHub rate-limits it, and stops polls that would never end. A rate-limited read pauses every watch on that host, whose lines say `rate limited until HH:MM` and are read again as the pause ends. When the last read left no quota, the pause waits for its reset; any other limit waits a minute, doubling each time it is hit again, up to 15 minutes. Other read failures are retried after 10 seconds, doubling up to 5 minutes. After 8 failed reads in a row, about 15 minutes, pr-watch stops watching, toasts why, and tells Claude, so nothing claims to be watching what it cannot read. A line that has shown the same state for half an hour while it waits on a person, such as a pull request waiting on review, conflicts or failed checks, or a failed merge, is read every 5 minutes instead of every minute. Comments and re-runs on it can therefore take up to 5 minutes to reach you.
