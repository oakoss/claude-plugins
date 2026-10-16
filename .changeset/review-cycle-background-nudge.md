---
review-cycle: minor
---

The review nudge no longer submits a visible prompt turn when a turn ends with changes no reviewer has seen. Instead a status line under the prompt says how many files are unreviewed, and your next message carries a reminder the agent reads but you do not see, telling it to run `/review-cycle:review` first unless that message says not to review or answers a question it asked. The reminder is built when you send, from what is still unreviewed then, so a review started in between leaves nothing to remind. A slash command, a message typed while the agent is working, or one another hook refuses leaves it for your next message. When git fails while checking a finished turn, the status line says so and your next message checks again; if git still cannot, the reminder says so. The review may now wait until you next write, rather than starting on its own. `review-cycle.nudge` in `/config` still turns both off, and turning it off clears the status line.
