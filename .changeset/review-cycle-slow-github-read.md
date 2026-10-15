---
review-cycle: patch
---

When you ask for a merge, the gate's GitHub lookup of the pull request (`gh pr view`, `gh repo view`) is tried again, for up to 10 seconds, when it times out after 5. When GitHub still does not answer, the refusal tells the agent GitHub was slow and to run the same command again, rather than asking you to confirm a merge you already asked for. Other GitHub lookups keep their single 5-second try, and a lookup that fails with an error rather than a timeout still asks.
