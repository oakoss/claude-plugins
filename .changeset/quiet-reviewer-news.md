---
pr-watch: patch
---

An AI reviewer that finds nothing no longer wakes Claude. On a clean pull request Pullfrog woke it three times, each a turn with nothing to do: for its comment that it had started, for its review saying `✅ No new issues found.`, and for its check finishing. Now the start comment is told under no setting, like a release tool's plan comment, and the clean review and a check that passed wait for your next message, which carries them to Claude. A review with findings, and a check that ended any other way, wake Claude as before. Only a review that opens as Pullfrog's clean one does counts as clean: a bot's review with no inline comments still wakes Claude, since its findings may be in its body.
