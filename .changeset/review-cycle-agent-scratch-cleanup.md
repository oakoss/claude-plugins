---
review-cycle: patch
---

### Fixed

Review agents were told to work in a private `mktemp -d` directory and name it in their report, but only the report-only spawns were told to delete it, and none was told to clean up processes it started. The loop fan-out's prompt in `/review-cycle:review` and the fan-out prompt in `/review-cycle:review-pr` both lacked the deletion clause.

Phase 7 had been asserting otherwise. Its text reads "Carry the same containment clauses Phase 3's prompt carries", then lists "and delete it when you finish" — a clause Phase 3's prompt did not contain. The two have been out of step since the containment rule was introduced.

The cost is measured, not hypothetical. A `code-reviewer` agent built a differential harness in its scratch directory, fed the project's hooks through pipes it never closed, and exited. Every hook blocked on its payload read. Four hours and forty-three minutes later, 26 orphaned processes were still sleeping at 0:00.00 CPU with PPID 1 — six each of the commit and Stop gates, six of the repo-local version-bump gate, and four each of the session-init and post-tool hooks — and the scratch directory was still on disk. They were found by a different session on the same machine, not by the cycle that created them.

All three containment sentences now carry both clauses: delete the directory, and end every process you started before reporting, because one left blocked on a pipe you opened outlives both you and the directory.

This narrows the leak rather than closing it. An agent that stalls or dies mid-run still cleans up nothing, and no instruction can fix that — the cycle would have to sweep for the directories itself, which is filed separately.
