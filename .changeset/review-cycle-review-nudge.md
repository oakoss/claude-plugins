---
review-cycle: minor
---

### The gate tells the agent to run the review, so it no longer asks you

When a turn started by your message ends with changes no reviewer has seen, the commit gate sends the agent one prompt telling it to invoke `/review-cycle:review` and report back. You no longer answer "want me to run the review?" at every stopping point: the review runs, and you hear about the result.

- **One nudge per message of yours.** A review that ends unconverged, or a turn after the nudge, is not nudged again until you write.
- **Only for work done since your message.** The nudge counts only paths the turn changed. A turn that changed nothing gets no nudge, even when older changes are unreviewed, so a question like "what's next?" does not start a review.
- **Not mid-review, and not after an interrupt.** No nudge while a reviewer is still running, none once a review has started for that message, and none when you stop the turn yourself.
- **You can still say no.** The agent skips the review when your message said not to review, or when it ended its turn on a question you need to answer first.

The nudge arrives as a prompt from the plugin, not from you, so it grants no permission to commit or push.
