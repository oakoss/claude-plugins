---
review-cycle: minor
---

The review cycle's summary now says three more things. A `Convergence:` line counts, from the second round on, how many of a round's findings came from the cycle's own fixes, and when most did, says the loop is generating its own work, so you can choose between more patches, the structural fix, and cutting the fix that keeps drawing findings; the loop itself runs as before. A `Cost:` line gives each round's wall-clock, legs, subagent tokens and Codex tokens, and names any leg whose usage was not reported, such as a capped leg. Codex's tokens are read from the session log of the child session its review runs in, and kept apart from the subagents' because they count cached input. When anything was deferred or raised as a question, the summary is followed by a paste-ready `## Known issues` block, with `### Open questions`, for the pull request description; the agent never files it in a tracker, and puts it in the body of a pull request it opens itself.
