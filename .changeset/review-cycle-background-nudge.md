---
review-cycle: minor
---

The review nudge no longer submits a visible prompt turn when a turn ends with changes no reviewer has seen. Instead your next message carries a reminder the agent reads but you do not see, telling it to run `/review-cycle:review` first unless that message says not to review or answers a question it asked; nothing shows on your screen. The reminder is built when you send, from what is still unreviewed then, so a review started in between leaves nothing to remind. A slash command, a message typed while the agent is working, or one another hook refuses leaves it for your next message. When git fails while checking a finished turn, your next message checks again; if git still cannot, the reminder says so. The review may now wait until you next write, rather than starting on its own. `review-cycle.nudge` in `/config` still turns it off.
