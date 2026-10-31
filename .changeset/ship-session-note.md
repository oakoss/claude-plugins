---
pr-kit: patch
---

`/pr-kit:ship` notes on each bead it closes the pull request and the Claude Code session that shipped it ("shipped in #297 from session <id> (claude -r <id>)"), so a bead leads back to the session that did the work even when that session shipped several pull requests. The `/resume` picker links a session only to its last one. The note is skipped when the session ID is not set; `claude -r` works until Claude Code's cleanup deletes the session after `cleanupPeriodDays` without use.
