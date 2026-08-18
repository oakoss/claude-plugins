---
"review-cycle": minor
---

The Codex review leg now receives the intent brief. `codex review`'s scope flags reject a prompt argument, so the brief is passed as a config override (`-c developer_instructions="<brief>"`) — verified additive to `AGENTS.md` on Codex v0.147.0, with no file written into the review target. Codex reviews now know what the change is trying to accomplish, closing the gap where the CLI leg reviewed blind while every Claude-side reviewer got the brief. On a Codex version that drops the undocumented key, the leg degrades to an unbriefed review instead of failing.
