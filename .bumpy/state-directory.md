---
review-cycle: patch
---

The four machine-written state files moved from loose dotfiles under .claude/ into .claude/review-cycle/ — mark, in-progress, pr-in-progress, and stop-block.

User-facing paths are unchanged: the .claude/.no-review-gate opt-out, the .claude/review-cycle.json config, and the installed pre-commit helper stay where they were. A one-time migration in the SessionStart hook moves old-layout files into the directory, fail-open with a diagnostic; if hooks never fire, the gate sees a missing sentinel and blocks once, after which a review or accept re-establishes it. The sentinel's exclude lists and the paths subcommand collapse the four state entries to one .claude/review-cycle/** glob, and /review-cycle:init derives .gitignore entries from paths at runtime, so initialized projects pick up the new layout on their next init run. This directory is also the home for future cycle state.
