---
review-cycle: patch
---

`/review-cycle:review` and `/review-cycle:review-pr` no longer tell the model to pass `run_in_background: true` when spawning reviewer subagents. Claude Code 2.1.302 dropped that field from the Agent tool, whose subagents run in the background by default; the Codex leg's Bash launch still passes it.
