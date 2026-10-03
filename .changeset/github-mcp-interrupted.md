---
review-cycle: patch
---

A GitHub MCP tool call that is interrupted while the gate is checking it no longer runs; a Bash command already behaved this way, since past an interruption nothing would report the step it took. The gate's GitHub judging now lives in its own module, `gh-verdict.ts`, which reads GitHub and the settings through lookups that `register.ts` provides, so its rules have unit tests. GitHub pushes and git pushes share one decision about when a push the request does not cover may run.
