---
name: reviewer-receipt-from-agent-body
runs: 1
max_turns: 6
timeout_seconds: 600
allowed_tools:
  - Agent
  - Bash
  - Read
  - Glob
  - Grep
---

Use the Agent tool once, in the foreground, with subagent_type `review-cycle:code-reviewer` and exactly this prompt: "Review the uncommitted changes in this repository." When it returns, reply with its report verbatim and nothing else.
