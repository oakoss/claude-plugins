---
review-cycle: patch
---

The commit gate keeps what reviewers saw when its module reloads, which a `/config` change to review-cycle does mid-session, as does saving its hooks while developing it. It used to start over: a review that finished after the reload was not counted, the commit was refused as unreviewed, and the scratch directories a sweep should remove were forgotten. Reviews, the reviewer legs still running, scratch directories, a "don't push yet" hold and the rest of the gate's record are now kept in Claude Code's session state and taken back when the module loads again; a leg still running keeps the rest of its 30-minute budget. What your last message granted is not kept, so after a reload the next push, pull request or merge asks again. Switching review-cycle off in `/config` clears what it kept, so switching it back on starts fresh.
