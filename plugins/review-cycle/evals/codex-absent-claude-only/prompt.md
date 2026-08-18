---
name: codex-absent-claude-only
runs: 1
max_turns: 20
timeout_seconds: 900
allowed_tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Agent
  - SendMessage
  - Skill
---

/review-cycle:review
