---
pr-watch: minor
---

A merged pull request whose checks passed now leaves the band on its own: every run on the merge commit has to be done and 90 seconds past the merge, and the line goes 5 seconds after the band's next read sees both. Before, the `✓ main checks passed` line stayed until your next message.

A merge whose checks failed now stays until they pass. The band reads it once a minute, every 10 seconds while a re-run is going, and clears it the same way once a re-run passes. Your next message no longer clears it; the `×` still does.
