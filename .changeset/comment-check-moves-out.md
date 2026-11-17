---
review-cycle: minor
---

The comment-slop check has moved out of review-cycle into its own plugin, `comment-check`. review-cycle no longer scans the files the agent writes for section markers, restate-the-code comments, hedge words and the rest, while its gate is on or off. To keep that check, install the new plugin: `claude plugin install comment-check@oakoss`. It works as it did here, and its notes now begin `comment-check:` rather than `review-cycle:`. The note review-cycle gives after a Bash command changes files still tells the agent to make file changes with Edit or Write.
